import { backgroundPaused } from "./background-pause";
/*
 * Konsolidierungs-Worker — der "nächtliche" Gedächtnispfleger.
 *
 * Täglich: Confidence-Verfall unbestätigter Claims, Strategie-Auswertung aus
 * gemessenen Aktions-Resultaten, Embedding-Backfill, Obsidian-Vault-Sync und
 * (falls installiert) Graphify-Update über den Vault.
 */
import { execFile } from "node:child_process";
import { db } from "@workspace/db";
import { claimsTable, memActionsTable, strategiesTable, debugLogTable } from "@workspace/db";
import { and, eq, lt, isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { syncObsidianVault } from "./obsidian-sync";
import { embedNewRows } from "./memory-retrieval";
import { logger } from "./logger";
import { mitSperre } from "./lauf-sperre";

const CYCLE_MS = 24 * 60 * 60 * 1000;

// 1. Verfall: unbestätigte Claims älter als 14 Tage verlieren täglich Vertrauen
async function decayUnverifiedClaims(): Promise<number> {
  const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const result = await db
    .update(claimsTable)
    .set({ confidence: sql`GREATEST(${claimsTable.confidence} * 0.98, 0.05)` })
    .where(and(eq(claimsTable.status, "unverified"), lt(claimsTable.observedAt, cutoff)))
    .returning({ id: claimsTable.id });
  return result.length;
}

// 2. Strategie-Auswertung: Erfolgsraten aus lukas_actions.outcome
async function evaluateStrategies(): Promise<void> {
  const actions = await db
    .select()
    .from(memActionsTable)
    .where(and(isNotNull(memActionsTable.strategy), isNotNull(memActionsTable.outcome)))
    .limit(1000);

  const byStrategy = new Map<string, { n: number; success: number }>();
  for (const a of actions) {
    if (!a.strategy || !a.outcome) continue;
    const agg = byStrategy.get(a.strategy) ?? { n: 0, success: 0 };
    agg.n++;
    // Erfolg = Antwort erhalten, gewichtet mit Engagement/Informationsgewinn
    const score =
      (a.outcome.responseReceived ? 0.6 : 0) +
      Math.min(0.2, (a.outcome.engagementScore ?? 0) / 20) +
      Math.min(0.2, a.outcome.informationGain ?? 0);
    agg.success += score;
    byStrategy.set(a.strategy, agg);
  }

  for (const [name, agg] of byStrategy) {
    const successScore = agg.n > 0 ? agg.success / agg.n : 0.5;
    const [existing] = await db.select().from(strategiesTable).where(eq(strategiesTable.name, name)).limit(1);
    if (existing) {
      await db
        .update(strategiesTable)
        .set({ successScore, sampleSize: agg.n, updatedAt: new Date() })
        .where(eq(strategiesTable.id, existing.id));
    } else {
      await db.insert(strategiesTable).values({ name, rule: "", successScore, sampleSize: agg.n });
    }
  }
}

// 3. Debug-Log begrenzt halten: nur die letzten 30 Tage aufheben
async function pruneDebugLog(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const result = await db
    .delete(debugLogTable)
    .where(lt(debugLogTable.createdAt, cutoff))
    .returning({ id: debugLogTable.id });
  return result.length;
}

// 4. Graphify optional über den Vault laufen lassen (nur wenn installiert)
function runGraphifyIfAvailable(vaultDir: string): void {
  execFile("graphify", ["update", vaultDir, "--no-cluster"], { timeout: 5 * 60 * 1000 }, (err, stdout) => {
    if (err) {
      logger.debug({ err: err.message }, "Graphify nicht verfügbar oder fehlgeschlagen — übersprungen");
    } else {
      logger.info({ out: stdout.slice(-200) }, "Graphify über memory-vault aktualisiert");
    }
  });
}

export async function runConsolidation(): Promise<void> {
  if (backgroundPaused()) return;
  const decayed = await decayUnverifiedClaims();
  await evaluateStrategies();
  const embedded = await embedNewRows();
  const prunedDebugLogs = await pruneDebugLog();
  const vaultDir = await syncObsidianVault();
  runGraphifyIfAvailable(vaultDir);
  logger.info({ decayed, embedded, prunedDebugLogs }, "Gedächtnis-Konsolidierung abgeschlossen");
}

let timer: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

export function startConsolidationWorker(): void {
  if (backgroundPaused()) {
    logger.info("startConsolidationWorker: pausiert (LUKAS_BACKGROUND_PAUSED=true)");
    return;
  }
  if (timer || startupTimer) return;
  // Unter Sperre: die Konsolidierung fasst Erinnerungen zusammen und loescht
  // dabei. Zwei Laeufe gleichzeitig wuerden dieselbe Zusammenfassung doppelt
  // anlegen.
  const safeRun = () =>
    mitSperre("konsolidierung", runConsolidation).catch((err) =>
      logger.warn({ err }, "Konsolidierung fehlgeschlagen"),
    );
  // Erster Lauf 5 min nach Boot, danach täglich
  startupTimer = setTimeout(() => { startupTimer = null; safeRun(); }, 5 * 60 * 1000);
  timer = setInterval(safeRun, CYCLE_MS);
  logger.info("Konsolidierungs-Worker gestartet (täglich)");
}

export function stopConsolidationWorker(): void {
  if (startupTimer) clearTimeout(startupTimer);
  startupTimer = null;
  if (timer) clearInterval(timer);
  timer = null;
}
