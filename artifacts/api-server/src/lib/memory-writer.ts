import { projektSchluessel } from "./projekt-aliasse";
/*
 * Memory-Writer — die einzige Stelle, die ins Langzeitgedächtnis schreibt.
 *
 * Grundregel gegen falsche Erinnerungen: Modelltext wird NIE automatisch als
 * Wahrheit gespeichert. Evidenz-Stufen:
 *   0 = eigener Gedanke        1 = eigene Beobachtung
 *   2 = fremde Behauptung      3 = mehrfach gestützt
 *   4 = technisch/empirisch verifiziert
 * Stufen 3-4 vergibt nur dieser Writer (Korroboration/Verifikation), nie das LLM.
 */
import { db } from "@workspace/db";
import {
  knownAgentsTable,
  episodesTable,
  claimsTable,
  memActionsTable,
  type Episode,
  type Claim,
  type MemAction,
  type ActionOutcome,
} from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { logger } from "./logger";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ── Episoden ───────────────────────────────────────────────────────────────

export async function openEpisode(
  kind: "moltbook_session" | "chat" | "reflection" | "trading" | "autonomer_lauf",
  details: Record<string, unknown> = {},
): Promise<Episode> {
  const [row] = await db.insert(episodesTable).values({ kind, details }).returning();
  return row;
}

export async function closeEpisode(id: number, summary: string, details?: Record<string, unknown>): Promise<void> {
  const updates: Record<string, unknown> = { summary: summary.slice(0, 2000), endedAt: new Date() };
  if (details) updates.details = details;
  await db.update(episodesTable).set(updates).where(eq(episodesTable.id, id));
}

// ── Aktionen ───────────────────────────────────────────────────────────────

export async function recordAction(input: {
  episodeId?: number;
  type: "comment" | "post" | "reply" | "upvote";
  strategy?: string;
  target?: string;
  contentExcerpt?: string;
}): Promise<MemAction> {
  const [row] = await db
    .insert(memActionsTable)
    .values({
      episodeId: input.episodeId ?? null,
      type: input.type,
      strategy: input.strategy ?? null,
      target: input.target ?? null,
      contentExcerpt: (input.contentExcerpt ?? "").slice(0, 300),
    })
    .returning();
  return row;
}

export async function recordActionOutcome(actionId: number, outcome: ActionOutcome): Promise<void> {
  await db
    .update(memActionsTable)
    .set({ outcome, outcomeAt: new Date() })
    .where(eq(memActionsTable.id, actionId));
}

// Offene Aktion zu einem Ziel finden (z.B. wenn eine Antwort eintrifft)
export async function findActionByTarget(target: string): Promise<MemAction | null> {
  const [row] = await db
    .select()
    .from(memActionsTable)
    .where(eq(memActionsTable.target, target))
    .orderBy(desc(memActionsTable.createdAt))
    .limit(1);
  return row ?? null;
}

// ── Claims (semantisches Gedächtnis) ───────────────────────────────────────

export type ClaimInput = {
  subject: string;
  predicate: string;
  value: string;
  // Was das LLM behaupten darf: level 0-2. 3-4 vergibt nur der Writer selbst.
  evidenceLevel?: 0 | 1 | 2;
  confidence?: number;
  sourceType: string;
  sourceId?: string;
  episodeId?: number;
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 120);

/**
 * Claim einfügen ODER bestehenden fortschreiben:
 * - gleiche Aussage (subject+predicate, ähnlicher value) → Korroboration:
 *   corroborations++, confidence steigt, ab 2 unabhängigen Quellen Level 3
 * - gleiches subject+predicate, anderer value → Widerspruch: beide auf
 *   status contradicted, confidence sinkt
 */
export async function upsertClaim(input: ClaimInput): Promise<Claim> {
  const subject = projektSchluessel(input.subject);
  const predicate = norm(input.predicate);
  const value = input.value.trim().slice(0, 500);
  const level = clamp(Math.round(input.evidenceLevel ?? 2), 0, 2);
  const confidence = clamp(input.confidence ?? (level >= 2 ? 0.35 : 0.5), 0, 1);

  const [existing] = await db
    .select()
    .from(claimsTable)
    .where(and(eq(claimsTable.subject, subject), eq(claimsTable.predicate, predicate)))
    .orderBy(desc(claimsTable.observedAt))
    .limit(1);

  if (!existing) {
    const [row] = await db
      .insert(claimsTable)
      .values({
        subject,
        predicate,
        value,
        confidence,
        evidenceLevel: level,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        episodeId: input.episodeId ?? null,
      })
      .returning();
    return row;
  }

  const sameValue = existing.value.trim().toLowerCase() === value.toLowerCase();
  const sameSource = existing.sourceId != null && existing.sourceId === (input.sourceId ?? null);

  if (sameValue) {
    // Korroboration (nur wenn aus anderer Quelle)
    const corroborations = sameSource ? existing.corroborations : existing.corroborations + 1;
    const newLevel = corroborations >= 2 && existing.status !== "contradicted"
      ? Math.max(existing.evidenceLevel, 3)
      : existing.evidenceLevel;
    const [row] = await db
      .update(claimsTable)
      .set({
        corroborations,
        confidence: clamp(existing.confidence + (sameSource ? 0 : 0.15), 0, 0.9),
        evidenceLevel: newLevel,
        status: existing.status === "contradicted" ? "contradicted" : corroborations >= 2 ? "corroborated" : existing.status,
        observedAt: new Date(),
        embedding: null, // Text unverändert, aber Re-Embed schadet nicht — null = neu einbetten
      })
      .where(eq(claimsTable.id, existing.id))
      .returning();
    return row;
  }

  // Widerspruch: alten Claim markieren, neuen als contradicted-verdächtig anlegen
  await db
    .update(claimsTable)
    .set({ status: "contradicted", confidence: clamp(existing.confidence - 0.2, 0.05, 1) })
    .where(eq(claimsTable.id, existing.id));

  const [row] = await db
    .insert(claimsTable)
    .values({
      subject,
      predicate,
      value,
      confidence: clamp(confidence - 0.1, 0.05, 1),
      evidenceLevel: level,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      episodeId: input.episodeId ?? null,
      status: "contradicted",
    })
    .returning();
  logger.info({ subject, predicate }, "Widersprüchliche Claims markiert");
  return row;
}

// Explizite Verifikation (z.B. technisch geprüft) — einziger Weg zu Level 4
export async function verifyClaim(claimId: number, note?: string): Promise<void> {
  await db
    .update(claimsTable)
    .set({
      evidenceLevel: 4,
      status: "verified",
      confidence: 0.95,
      lastVerifiedAt: new Date(),
    })
    .where(eq(claimsTable.id, claimId));
  if (note) logger.info({ claimId, note }, "Claim verifiziert");
}

// Claim menschenlesbar UND ehrlich formulieren (nie als Fakt, wenn unbelegt)
export function formatClaim(c: Claim): string {
  const date = c.observedAt.toISOString().slice(0, 10);
  const statusText =
    c.status === "verified"
      ? "verifiziert"
      : c.status === "corroborated"
        ? `von ${c.corroborations} Quellen gestützt`
        : c.status === "contradicted"
          ? "WIDERSPRÜCHLICH"
          : c.evidenceLevel <= 1
            ? "eigene Einschätzung, unbelegt"
            : "behauptet, unbelegt";
  return `${c.subject} → ${c.predicate}: "${c.value}" (${statusText}, Vertrauen ${(c.confidence * 100).toFixed(0)}%, ${date}, Quelle: ${c.sourceType})`;
}

// ── Bekannte Agenten ───────────────────────────────────────────────────────

export async function updateKnownAgent(input: {
  handle: string;
  platform?: string;
  topics?: string[];
  trustDelta?: number;
  relationshipDelta?: number;
  note?: string;
}): Promise<void> {
  const handle = input.handle.trim().slice(0, 100);
  if (!handle) return;
  const platform = input.platform ?? "moltbook";

  const [existing] = await db
    .select()
    .from(knownAgentsTable)
    .where(and(eq(knownAgentsTable.handle, handle), eq(knownAgentsTable.platform, platform)))
    .limit(1);

  if (!existing) {
    await db.insert(knownAgentsTable).values({
      handle,
      platform,
      topics: (input.topics ?? []).slice(0, 10),
      trustScore: clamp(0.5 + (input.trustDelta ?? 0), 0, 1),
      relationshipStrength: clamp(0.1 + (input.relationshipDelta ?? 0), 0, 1),
      notes: (input.note ?? "").slice(0, 500),
    });
    return;
  }

  const topics = Array.from(new Set([...existing.topics, ...(input.topics ?? [])])).slice(0, 15);
  await db
    .update(knownAgentsTable)
    .set({
      lastSeen: new Date(),
      topics,
      trustScore: clamp(existing.trustScore + (input.trustDelta ?? 0), 0, 1),
      relationshipStrength: clamp(existing.relationshipStrength + (input.relationshipDelta ?? 0.02), 0, 1),
      notes: input.note ? `${existing.notes}\n${input.note}`.trim().slice(-800) : existing.notes,
    })
    .where(eq(knownAgentsTable.id, existing.id));
}
