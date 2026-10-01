import { logger } from "../logger";

export type LukasProvider = "openai" | "anthropic" | "google" | "local";
export type ModelProfile = "fast" | "general" | "reasoning" | "code" | "vision" | "long_context";
export type ModelRoute = { provider: LukasProvider; model: string; profile: ModelProfile; reason: string };
export type RouteInput = {
  userText: string;
  hasAttachments?: boolean;
  attachmentKinds?: string[];
  usedTools?: string[];
  iteration?: number;
  /** Auftrag fuer kurze Fortsetzungen, ohne zusaetzlichen Klassifikationsaufruf. */
  previousUserText?: string;
};
const PROFILES: ModelProfile[] = ["fast", "general", "reasoning", "code", "vision", "long_context"];
// Offizielle SDK-IDs; die Freischaltung ist weiterhin accountabhaengig.
// Astra ist kein Standard, aber per LUKAS_MODEL_REASONING explizit waehlbar.
export const MODEL_DEFAULTS: Record<ModelProfile, string> = {
  fast: "openai:gpt-6-luna",
  general: "openai:gpt-5.6-terra",
  vision: "openai:gpt-5.6-terra",
  reasoning: "openai:gpt-6-sol",
  code: "openai:gpt-6.1-sol",
  long_context: "openai:gpt-6.1-sol",
};
function nonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((v) => v?.trim())?.trim();
}
function parseModelSpec(spec: string, profile: ModelProfile, reason: string): ModelRoute {
  const match = /^(openai|anthropic|google|local):(.+)$/i.exec(spec.trim());
  return match
    ? { provider: match[1].toLowerCase() as LukasProvider, model: match[2].trim(), profile, reason }
    : { provider: "openai", model: spec.trim(), profile, reason };
}
function configured(profile: ModelProfile, reason: string): ModelRoute {
  const core = nonEmpty(process.env.LUKAS_CORE_MODEL);
  const explicit = nonEmpty(process.env["LUKAS_MODEL_" + profile.toUpperCase()]);
  // LUKAS_PUBLIC_MODEL gehoert allein dem oeffentlichen Portfolio-Widget.
  const legacyFast = profile === "fast" ? nonEmpty(process.env.LUKAS_FAST_MODEL) : undefined;
  const inherited = core && profile !== "fast"
    ? nonEmpty(
        (profile === "code" || profile === "long_context") ? process.env.LUKAS_MODEL_REASONING : undefined,
        process.env.LUKAS_MODEL_GENERAL, core,
      ) : undefined;
  return parseModelSpec(explicit ?? legacyFast ?? inherited ?? MODEL_DEFAULTS[profile], profile, reason);
}
export function localBaseUrl(): string | undefined {
  return nonEmpty(process.env.LUKAS_LOCAL_BASE_URL);
}
export function providerAvailable(provider: LukasProvider): boolean {
  if (provider === "openai") return true;
  if (provider === "anthropic") return Boolean(nonEmpty(process.env.ANTHROPIC_API_KEY));
  if (provider === "local") return Boolean(localBaseUrl());
  return Boolean(nonEmpty(process.env.GEMINI_API_KEY, process.env.GOOGLE_GENERATIVE_AI_API_KEY, process.env.GOOGLE_API_KEY));
}
/** Profiltreuer, begrenzter Ersatz. Billige Pfade eskalieren nicht automatisch auf Core/Astra. */
export function fallbackRoutes(route: ModelRoute): ModelRoute[] {
  const cheap = ["fast", "general", "vision"].includes(route.profile);
  const explicit = nonEmpty(process.env["LUKAS_MODEL_FALLBACK_" + route.profile.toUpperCase()]);
  const specs = explicit ? [explicit] : [
    ...(cheap ? [] : [nonEmpty(process.env.LUKAS_CORE_MODEL)].filter((s): s is string => Boolean(s))),
    cheap ? "openai:gpt-4.1-mini" : "openai:gpt-4.1",
  ];
  const seen = new Set([route.provider + ":" + route.model]);
  return specs.map((spec) => parseModelSpec(spec, route.profile, "Ersatz fuer " + route.provider + ":" + route.model))
    .filter((r) => {
      const key = r.provider + ":" + r.model;
      if (seen.has(key) || !providerAvailable(r.provider)) return false;
      seen.add(key);
      return true;
    });
}
function resolve(route: ModelRoute): ModelRoute {
  return providerAvailable(route.provider) ? route : fallbackRoutes(route)[0] ?? route;
}
const TECH = /\b(typescript|javascript|python|react|npm|pnpm|github|repository|docker|stacktrace|nginx|caddy|systemd|ssh|sql|commit|pull request|merge|refactor|regex|json|yaml|bash|shell|cli|migration|cron|async|await|webpack|vite|eslint|tsc|code|api|endpoint|bug|fehler|build|deploy|server|vps|funktion|klasse|datei|branch|repo|git|node|test|tests|skript|script|logik|spalte|tabelle|container|job)\b/i;
const CODE_ACTION = /\b(schreib|schreibe|baue?|bauen|implementier|programmier|debugg?e?|fix|behebe?|beheben|analysier|prüf|pruef|teste?n?|ändere?|aendere?|refactor|deploye?|installier|erstell|setz|konfigurier|mock|erklär|erklaer|indexier|optimier)\w*/i;
const CODE_PROBLEM = /\b(stacktrace|konflikt|conflict|error|exception|rejection|failed|fehlschlag)\b|schlägt fehl|schlaegt fehl|schlagen fehl|wirft|(?:startet|läuft|laeuft|funktioniert) nicht/i;
const CODE_SYNTAX = /(=>|;\s*$|\{\s*$|\bconst\b|\blet\b|\bfunction\b|\bimport\b|\bexport\b|\breturn\b|`{3}|\bSELECT\b.*\bFROM\b|\.(ts|tsx|js|jsx|mjs|py|sh|sql|go|rs|java|css|html)\b|[A-Za-z]+Error\b|\bexit code\b|\bmodule not found\b)/im;
const COMPLEX = /(\b(analysier|analyse|begründ|begruend|vergleich|plan|beweis|research|reason|debug|ursach)\w*|\w*(strategie|architektur|konzept|analyse)\b|\btrade-?offs?\b|\bkomplex\w*|\bwarum genau\b|\bzerlege\b|\babwäg\w*)/i;
const CONTINUATION = /^(?:ja[, ]+)?(?:bitte[, ]+)?(?:weiter|mach(?:e)? (?:das|weiter)|mach mal|umsetzen|setz(?:e)? (?:das )?um|ja bitte|und jetzt|passt das)(?: bitte)?[.!?]*$/i;
// Eng begrenzte Definitionsfragen. "Was ist die Ursache fuer den Ausfall?" bleibt Analyse.
const DEFINITION = /^(?:(?:kurz|einfach)[,:]?\s*)?(?:was (?:ist|sind|bedeutet|heißt|heisst)|wofür steht|what (?:is|are)|define|erklär(?:e)? mir(?: kurz)?|erklaer(?:e)? mir(?: kurz)?)\s+(?:(?:ein|eine|einen|der|die|das)\s+)?(?:python|typescript|javascript|json|yaml|react|docker|github|sql|ssh|api|regex|commit|merge|repository|plan|strategie|architektur|konzept)\s*[?.!]*$/i;
function profileFor(text: string): ModelProfile {
  if (text.length > 12000) return "long_context";
  if (DEFINITION.test(text.trim())) return "fast";
  if (text.length < 160 && /^(?:vielen\s+)?dank(?:e)?(?:\s|[,.!]|$)/i.test(text.trim()) && !CODE_ACTION.test(text) && !text.includes("?")) return "fast";
  if (CODE_SYNTAX.test(text) || (TECH.test(text) && (CODE_ACTION.test(text) || CODE_PROBLEM.test(text)))) return "code";
  if (text.length > 1200 || COMPLEX.test(text)) return "reasoning";
  return text.length < 260 && !/[?].*[?]/s.test(text) ? "fast" : "general";
}
export function routeLukasModel(input: RouteInput): ModelRoute {
  const text = input.userText ?? "";
  const tools = new Set(input.usedTools ?? []);
  const continuation = CONTINUATION.test(text.trim()) && input.previousUserText;
  let profile = profileFor(continuation ? input.previousUserText! : text);
  let reason = continuation ? "Fortsetzung des bisherigen Auftrags" : "Aufwand der aktuellen Aufgabe";
  if (tools.has("execute_command") || tools.has("github_read_path") || tools.has("github_search_code")) {
    if (profile !== "long_context") profile = "code";
    reason = "laufende Code-/Repo-Arbeit";
  }
  const kinds = input.attachmentKinds ?? [];
  const visual = kinds.some((k) => /image|video|pdf|bild|dokument/i.test(k)) || (input.hasAttachments && kinds.length === 0);
  if (visual) { profile = "vision"; reason = "Bild/Video/PDF im aktuellen Kontext"; }
  const route = resolve(configured(profile, reason));
  logger.info({ ...route, iteration: input.iteration ?? 0 }, "Lukas model route");
  return route;
}
export function routeLukasVoiceModel(): ModelRoute {
  return resolve(parseModelSpec(nonEmpty(process.env.LUKAS_MODEL_VOICE) ?? MODEL_DEFAULTS.fast, "fast", "optionale Ausgabepolitur"));
}
export function directRoute(profile: ModelProfile): ModelRoute {
  return resolve(configured(profile, "feste Rolle: " + profile));
}
export function modelRoutingSnapshot(): ModelRoute[] {
  return PROFILES.map((profile) => configured(profile, "konfiguriertes Profil"));
}
/** Kompatibilitaet fuer externe Nutzer; intern directRoute/callLukasModel verwenden. */
export function directModel(profile: ModelProfile = "general"): string {
  const route = directRoute(profile);
  if (route.provider !== "openai") throw new Error("directModel unterstuetzt nur OpenAI; directRoute/callLukasModel verwenden");
  return route.model;
}
