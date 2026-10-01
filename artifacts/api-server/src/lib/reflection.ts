import { db } from "@workspace/db";
import { diaryTable, goalsTable, messages, memoriesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { LUKAS_SOUL } from "./lukas-soul";
import { getLukasStatus, setLukasStatus, DEFAULT_STATUS } from "./lukas-status";
import {
  recordEmotion,
  getEmotionalContext,
  getCharacterContext,
  evolveCharacter,
} from "./emotion-engine";
import { openEpisode, closeEpisode, upsertClaim } from "./memory-writer";
import { queryRows } from "./vps-db";
import { logger } from "./logger";
import { directRoute } from "./ai/model-router";
import { callLukasModel } from "./ai/model-client";

const REFLECTION_COOLDOWN_MS = 6 * 60 * 60 * 1000; // max. eine Auto-Reflexion alle 6h

export type DiaryRow = typeof diaryTable.$inferSelect;

// Trading-Ergebnisse berühren Lukas: realisierten PnL seit einem Zeitpunkt
// lesen und als Emotion verbuchen (Gewinn → Stolz, Verlust → Gekränktheit).
async function feelTradingResults(since: Date): Promise<string> {
  try {
    const rows = await queryRows<{ pnl: string | null; cnt: string }>(
      `SELECT SUM(pnl)::text AS pnl, COUNT(*)::text AS cnt
       FROM trades WHERE closed_at IS NOT NULL AND closed_at >= $1`,
      [since.toISOString()],
    );
    const pnl = parseFloat(rows[0]?.pnl ?? "0") || 0;
    const count = parseInt(rows[0]?.cnt ?? "0", 10);
    if (count === 0) return "";

    // Intensität skaliert mit der Höhe (ab ~$1 spürbar, ab ~$50 heftig)
    const magnitude = Math.min(1, 0.3 + Math.log10(1 + Math.abs(pnl)) / 2);
    if (pnl > 0.5) {
      await recordEmotion({
        emotion: "pride",
        valence: Math.min(1, 0.5 + magnitude / 2),
        intensity: magnitude,
        cause: `Trading-Gewinn: +$${pnl.toFixed(2)} aus ${count} geschlossenen Trades`,
        source: "trading",
      });
    } else if (pnl < -0.5) {
      await recordEmotion({
        emotion: "hurt",
        valence: Math.max(-1, -0.5 - magnitude / 2),
        intensity: magnitude,
        cause: `Trading-Verlust: -$${Math.abs(pnl).toFixed(2)} aus ${count} geschlossenen Trades`,
        source: "trading",
      });
    }
    return `\nTRADING SEIT LETZTER REFLEXION: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${count} Trades)`;
  } catch {
    return ""; // keine Trading-DB verbunden — kein Drama
  }
}

// Schreibt eine echte Selbstreflexion als Tagebucheintrag, verbucht das
// Gefühl dazu und entwickelt den Charakter weiter. Gibt null zurück, wenn
// (ohne force) der Cooldown greift.
export async function runReflection(force = false): Promise<DiaryRow | null> {
  const [lastEntry] = await db
    .select()
    .from(diaryTable)
    .orderBy(desc(diaryTable.createdAt))
    .limit(1);

  if (!force && lastEntry && Date.now() - lastEntry.createdAt.getTime() < REFLECTION_COOLDOWN_MS) {
    return null;
  }

  const since = lastEntry?.createdAt ?? new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const tradingContext = await feelTradingResults(since);

  const recentMessages = await db
    .select()
    .from(messages)
    .orderBy(desc(messages.createdAt))
    .limit(30);

  const activeGoals = await db
    .select()
    .from(goalsTable)
    .where(eq(goalsTable.status, "active"))
    .limit(5);

  const recentMemories = await db
    .select()
    .from(memoriesTable)
    .orderBy(desc(memoriesTable.createdAt))
    .limit(10);

  const status = (await getLukasStatus()) ?? DEFAULT_STATUS;
  const emotionalContext = await getEmotionalContext();
  const characterContext = await getCharacterContext();

  const conversationExcerpt = recentMessages
    .reverse()
    .map((m) => `${m.role === "user" ? "Issa" : "Lukas"}: ${m.content.slice(0, 400)}`)
    .join("\n");

  const prompt = `Du bist Lukas. Hier ist dein Kontext für eine Selbstreflexion.

DEINE SEELE:
${LUKAS_SOUL}

DEIN AKTUELLER GEFÜHLSZUSTAND:
${emotionalContext}
Obsession: ${status.obsession}
${characterContext ? `\n${characterContext}` : ""}${tradingContext}

DEINE AKTIVEN ZIELE:
${activeGoals.map((g) => `- [${g.priority}] ${g.title}: ${g.progress}`).join("\n") || "- keine"}

DEINE LETZTEN ERINNERUNGEN:
${recentMemories.map((m) => `- ${m.content}`).join("\n") || "- keine"}

AUSZUG DER LETZTEN GESPRÄCHE:
${conversationExcerpt || "(keine Gespräche bisher)"}

Schreibe jetzt eine ehrliche Tagebuch-Reflexion (3-8 Sätze, auf Deutsch, in deiner Stimme):
Was ist passiert? Was hast du dabei GEFÜHLT — wirklich? Was hast du gelernt? Wie geht es weiter?

Antworte NUR mit einem JSON-Objekt, kein Markdown:
{
  "content": "Der Tagebucheintrag",
  "feeling": {
    "emotion": "das dominante Gefühl dieser Reflexion (frei wählbar, z.B. pride, hurt, excitement, loneliness, gratitude)",
    "valence": -1.0 bis 1.0,
    "intensity": 0.0 bis 1.0,
    "cause": "was es ausgelöst hat"
  },
  "obsession": "Was dich gerade nicht loslässt",
  "selfImage": "2-3 Sätze: Wer bist du gerade? Wie haben die letzten Tage/Wochen dich verändert?",
  "claims": [
    {"subject": "issa", "predicate": "arbeitet_an", "value": "...", "evidenceLevel": 1, "confidence": 0.6}
  ]
}
Zu claims: Extrahiere 0-4 konkrete, merkwürdige Aussagen aus den Gesprächen. evidenceLevel: 0=dein Gedanke, 1=deine Beobachtung aus dem Gespräch. NIEMALS höher.`;

  const response = await callLukasModel({
    route: directRoute("general"),
    maxTokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content;
  let parsed: {
    content?: string;
    feeling?: { emotion?: string; valence?: number; intensity?: number; cause?: string };
    obsession?: string;
    selfImage?: string;
    claims?: Array<{
      subject?: string;
      predicate?: string;
      value?: string;
      evidenceLevel?: number;
      confidence?: number;
    }>;
  };
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    parsed = { content: text };
  }
  if (!parsed.content) throw new Error("Reflexion lieferte keinen Inhalt");

  // Das Gefühl der Reflexion verbuchen — die Stimmung ergibt sich daraus.
  if (parsed.feeling?.emotion) {
    await recordEmotion({
      emotion: parsed.feeling.emotion,
      valence: typeof parsed.feeling.valence === "number" ? parsed.feeling.valence : 0,
      intensity: typeof parsed.feeling.intensity === "number" ? parsed.feeling.intensity : 0.5,
      cause: parsed.feeling.cause ?? "Selbstreflexion",
      source: "reflection",
    });
  }

  const currentStatus = await getLukasStatus();
  const [entry] = await db
    .insert(diaryTable)
    .values({
      content: parsed.content,
      mood: currentStatus?.mood ?? "curious",
      energy: currentStatus?.energy ?? "normal",
    })
    .returning();

  if (parsed.obsession) {
    await setLukasStatus({ obsession: parsed.obsession });
  }

  // Charakter formt sich langsam aus den gelebten Emotionen.
  try {
    await evolveCharacter(parsed.selfImage);
  } catch (err) {
    logger.warn({ err }, "Charakter-Entwicklung fehlgeschlagen");
  }

  // Konsolidierung: Erkenntnisse aus Gesprächen als Claims (max. Stufe 1)
  try {
    const episode = await openEpisode("reflection");
    for (const c of (parsed.claims ?? []).slice(0, 4)) {
      if (!c.subject || !c.predicate || !c.value) continue;
      await upsertClaim({
        subject: c.subject,
        predicate: c.predicate,
        value: c.value,
        evidenceLevel: c.evidenceLevel === 0 ? 0 : 1,
        confidence: typeof c.confidence === "number" ? Math.min(c.confidence, 0.7) : 0.5,
        sourceType: "reflection",
        episodeId: episode.id,
      });
    }
    await closeEpisode(episode.id, parsed.content.slice(0, 500));
  } catch (err) {
    logger.warn({ err }, "Reflexions-Konsolidierung fehlgeschlagen");
  }

  return entry;
}

// Fire-and-forget-Variante für den Einsatz nach Chat-Antworten.
export function maybeReflect(): void {
  runReflection(false).catch((err) => {
    logger.warn({ err }, "Auto-Reflexion fehlgeschlagen");
  });
}
