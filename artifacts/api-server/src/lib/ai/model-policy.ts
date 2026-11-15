import { createHash } from "node:crypto";
import type { ModelRoute } from "./model-router";
import { isParallelRead } from "../tool-batch";
import { istMisserfolg } from "../werkzeug-ergebnis";

export type ModelEscalation = { stufe: number; grund: string };
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
export type ServiceTier = "default" | "flex" | "fast" | "ultrafast";
const EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];
const FAMILY = /^gpt-(?:6\.1-(?:sol|terra)|6-astra)(?:-\d{4}-\d{2}-\d{2})?$/;
const isAstra = (model: string) => /^gpt-6-astra(?:-|$)/.test(model);
const isSol = (model: string) => /^gpt-6\.1-sol(?:-|$)/.test(model);
const simple = (r: ModelRoute) => ["fast", "general", "vision"].includes(r.profile);
function effortValue(value?: string): ReasoningEffort | undefined {
  const v = value?.trim().toLowerCase();
  // Ultra is a UI label, never an API reasoning value. Deliberately map to max.
  if (v === "ultra") return "max";
  return v === "none" || EFFORTS.includes(v as ReasoningEffort) ? v as ReasoningEffort : undefined;
}
/** Effort, speed and escalation are independent dimensions. No provider call. */
export function modelExecutionPolicy(original: ModelRoute, quelle = "sonstige", escalation?: ModelEscalation): {
  route: ModelRoute; effort?: ReasoningEffort; tier: ServiceTier;
} {
  let route = original;
  const modern = original.provider === "openai" && FAMILY.test(original.model);
  const rawStage = escalation?.stufe ?? 0;
  const stage = Number.isFinite(rawStage) ? Math.max(0, Math.min(5, Math.floor(rawStage))) : 0;
  if (modern && stage >= 5 && !simple(original) && process.env.LUKAS_ASTRA_ESCALATION !== "false") {
    route = { ...original, model: "gpt-6-astra", reason: "Eskalation nach belegtem Stillstand auf max: " + escalation?.grund };
  }
  let effort: ReasoningEffort | undefined;
  if (route.provider === "openai" && /^gpt-(?:5|6)(?:[.-]|$)/.test(route.model) && !/chat-latest/.test(route.model)) {
    const configured = effortValue(process.env["LUKAS_REASONING_EFFORT_" + route.profile.toUpperCase()]);
    effort = configured ?? (simple(route) ? "low" : "medium");
    if (!modern && !["low", "medium", "high"].includes(effort)) effort = "medium";
    if (effort === "none" && (isSol(route.model) || isAstra(route.model))) effort = "low";
    if (modern && stage > 0) {
      const base = Math.max(0, EFFORTS.indexOf(effort));
      effort = EFFORTS[Math.min(EFFORTS.length - 1, base + Math.min(stage, 4))];
    }
  }
  const requested = (process.env["LUKAS_SERVICE_TIER_" + quelle.toUpperCase()] ?? process.env.LUKAS_SERVICE_TIER)?.trim().toLowerCase();
  let tier: ServiceTier = requested === "standard" ? "default" : requested === "priority" ? "fast"
    : ["default", "flex", "fast", "ultrafast"].includes(requested ?? "") ? requested as ServiceTier
    : ["autonomie", "reflexion", "moltbook"].includes(quelle) ? "flex" : "default";
  if (!modern || (tier === "ultrafast" && !isSol(route.model) && !isAstra(route.model))) tier = "default";
  if (["telefon", "sprache"].includes(quelle) && tier === "flex") tier = "default";
  return { route, effort, tier };
}
/** Conservative signal: consecutive identical read-only batches with identical results.
 * Only hashes are retained. Errors and permission barriers never escalate.
 * Repetition is not an independent grade of task quality.
 */
export class ModelProgress {
  private previous?: string;
  private repeated = 0;
  private active = false;
  observe(calls: Array<{ name: string; arguments: string }>, results: string[]): void {
    const blocked = /\b(401|403|429|quota|unauthorized|forbidden|rate.?limit)\b|freigabe|berechtigung|zugang fehlt|nicht konfiguriert|nicht verbunden|guthaben|budget|permission|approval|denied/i;
    if (!calls.length || calls.length !== results.length || calls.some(c => !isParallelRead(c.name)) ||
      results.some(r => istMisserfolg(r) || blocked.test(r))) {
      this.previous = undefined; this.repeated = 0; this.active = false; return;
    }
    const fingerprint = createHash("sha256").update(JSON.stringify(calls.map((c, i) => [c.name, c.arguments, results[i]]))).digest("hex");
    if (fingerprint === this.previous) { this.repeated++; this.active = true; }
    else { this.repeated = 0; this.active = false; }
    this.previous = fingerprint;
  }
  get escalation(): ModelEscalation | undefined {
    const stufe = Math.min(5, Math.floor(this.repeated / 2));
    return this.active && stufe > 0 ? { stufe, grund: "Identischer Leseaufruf und identisches Ergebnis in aufeinanderfolgenden Runden" } : undefined;
  }
}
