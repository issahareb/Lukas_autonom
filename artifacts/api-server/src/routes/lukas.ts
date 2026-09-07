import { Router } from "express";
import { db } from "@workspace/db";
import {
  memoriesTable,
  goalsTable,
  diaryTable,
  mediaJobsTable,
  emotionsTable,
  claimsTable,
} from "@workspace/db";
import { eq, desc, ilike, and, ne } from "drizzle-orm";
import { getLukasStatus, DEFAULT_STATUS } from "../lib/lukas-status";
import { getCharacter } from "../lib/emotion-engine";
import { runReflection } from "../lib/reflection";
import { getDebugLog, recordDebugEvent } from "../lib/debug-log";
import { listeMeldungen, beantworteMeldung } from "../lib/melden";
import { kennzahlen } from "../lib/kennzahlen";
import { wartendes } from "../lib/wartet";
import { listeZugaenge, setzeZugang, loescheZugang } from "../lib/zugaenge";
import { tresorBereit } from "../lib/tresor";
import { baueGehirn, gehirnVault } from "../lib/gehirn";
import { packeZip } from "../lib/zip";
import { buildSystemPrompt } from "../lib/system-prompt";
import { openai } from "@workspace/integrations-openai-ai";
import { logger } from "../lib/logger";

const router = Router();

// ── STATUS ─────────────────────────────────────────────────────────────────
router.get("/lukas/status", async (req, res) => {
  try {
    const statusRow = await getLukasStatus();

    const memoriesCount = await db.$count(memoriesTable);
    const activeGoals = await db
      .select()
      .from(goalsTable)
      .where(eq(goalsTable.status, "active"));

    const status = statusRow ?? { ...DEFAULT_STATUS, updatedAt: new Date() };

    res.json({
      mood: status.mood,
      energy: status.energy,
      obsession: status.obsession,
      note: status.note,
      lastActive: status.updatedAt.toISOString(),
      activeGoalsCount: activeGoals.length,
      memoriesCount: Number(memoriesCount),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get status" });
  }
});

// ── DASHBOARD ──────────────────────────────────────────────────────────────
router.get("/lukas/dashboard", async (req, res) => {
  try {
    const statusRow = await getLukasStatus();

    const memoriesCount = await db.$count(memoriesTable);
    const activeGoals = await db
      .select()
      .from(goalsTable)
      .where(eq(goalsTable.status, "active"))
      .orderBy(desc(goalsTable.createdAt))
      .limit(5);

    const recentDiary = await db
      .select()
      .from(diaryTable)
      .orderBy(desc(diaryTable.createdAt))
      .limit(3);

    const recentMemories = await db
      .select()
      .from(memoriesTable)
      .orderBy(desc(memoriesTable.createdAt))
      .limit(5);

    const mediaJobs = await db
      .select()
      .from(mediaJobsTable)
      .orderBy(desc(mediaJobsTable.createdAt))
      .limit(5);

    const recentEmotions = await db
      .select()
      .from(emotionsTable)
      .orderBy(desc(emotionsTable.createdAt))
      .limit(10);

    const character = await getCharacter();

    const status = statusRow ?? { ...DEFAULT_STATUS, updatedAt: new Date() };

    res.json({
      status: {
        mood: status.mood,
        energy: status.energy,
        obsession: status.obsession,
        note: status.note,
        lastActive: status.updatedAt.toISOString(),
        activeGoalsCount: activeGoals.length,
        memoriesCount: Number(memoriesCount),
      },
      recentDiary: recentDiary.map((d) => ({
        ...d,
        createdAt: d.createdAt.toISOString(),
      })),
      activeGoals: activeGoals.map((g) => ({
        ...g,
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
      })),
      recentMemories: recentMemories.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      })),
      mediaJobs: mediaJobs.map((j) => ({
        ...j,
        createdAt: j.createdAt.toISOString(),
        updatedAt: j.updatedAt.toISOString(),
      })),
      recentEmotions: recentEmotions.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
      })),
      character: character
        ? {
            traits: character.traits,
            selfImage: character.selfImage,
            updatedAt: character.updatedAt.toISOString(),
          }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get dashboard" });
  }
});

// ── EMOTIONS ───────────────────────────────────────────────────────────────
router.get("/lukas/emotions", async (req, res) => {
  try {
    const { limit = "20" } = req.query as Record<string, string>;
    const rows = await db
      .select()
      .from(emotionsTable)
      .orderBy(desc(emotionsTable.createdAt))
      .limit(parseInt(limit) || 20);

    res.json(rows.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })));
  } catch (err) {
    res.status(500).json({ error: "Failed to get emotions" });
  }
});

// ── MEMORIES ───────────────────────────────────────────────────────────────
router.get("/lukas/memories", async (req, res) => {
  try {
    const { category, search, limit = "50", exclude } = req.query as Record<string, string>;

    const conditions = [];
    if (category) conditions.push(eq(memoriesTable.category, category));
    /*
     * Eine Kategorie ausschliessen.
     *
     * Jede Chatnachricht wird als niedrig gewichtete "conversation"-Erinnerung
     * abgelegt, damit Lukas alte Formulierungen wiederfindet. Fuer die Suche
     * ist das richtig, fuer die Uebersicht nicht: ohne diesen Filter besteht
     * eine Seite mit 100 Eintraegen fast nur aus Gespraechsschnipseln, und die
     * kuratierten Fakten sind nicht mehr zu finden.
     */
    if (exclude) conditions.push(ne(memoriesTable.category, exclude));
    if (search) conditions.push(ilike(memoriesTable.content, `%${search}%`));

    const rows = await db
      .select()
      .from(memoriesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(memoriesTable.createdAt))
      .limit(parseInt(limit) || 50);

    res.json(
      rows.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to get memories" });
  }
});

router.post("/lukas/memories", async (req, res) => {
  try {
    const { content, category = "personal", importance = 5, tags = [] } = req.body;
    if (!content) return void res.status(400).json({ error: "content required" });

    const [row] = await db
      .insert(memoriesTable)
      .values({ content, category, importance, tags })
      .returning();

    res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: "Failed to create memory" });
  }
});

router.delete("/lukas/memories/:id", async (req, res) => {
  try {
    await db.delete(memoriesTable).where(eq(memoriesTable.id, parseInt(req.params.id)));
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete memory" });
  }
});

// ── GOALS ──────────────────────────────────────────────────────────────────
router.get("/lukas/goals", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(goalsTable)
      .orderBy(desc(goalsTable.createdAt));

    res.json(
      rows.map((g) => ({
        ...g,
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to get goals" });
  }
});

router.post("/lukas/goals", async (req, res) => {
  try {
    const { title, description, priority = "medium" } = req.body;
    if (!title || !description)
      return void res.status(400).json({ error: "title and description required" });

    const [row] = await db
      .insert(goalsTable)
      .values({ title, description, priority, status: "active", progress: "just started" })
      .returning();

    res.status(201).json({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to create goal" });
  }
});

router.patch("/lukas/goals/:id", async (req, res) => {
  try {
    const { progress, status, note } = req.body;
    const id = parseInt(req.params.id);

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (progress !== undefined) updates.progress = progress;
    if (status !== undefined) updates.status = status;

    const [row] = await db
      .update(goalsTable)
      .set(updates)
      .where(eq(goalsTable.id, id))
      .returning();

    if (!row) return void res.status(404).json({ error: "Goal not found" });

    res.json({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to update goal" });
  }
});

router.delete("/lukas/goals/:id", async (req, res) => {
  try {
    await db.delete(goalsTable).where(eq(goalsTable.id, parseInt(req.params.id)));
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete goal" });
  }
});

// ── DIARY ──────────────────────────────────────────────────────────────────
router.get("/lukas/diary", async (req, res) => {
  try {
    const { limit = "20" } = req.query as Record<string, string>;

    const rows = await db
      .select()
      .from(diaryTable)
      .orderBy(desc(diaryTable.createdAt))
      .limit(parseInt(limit) || 20);

    res.json(rows.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })));
  } catch (err) {
    res.status(500).json({ error: "Failed to get diary" });
  }
});

router.post("/lukas/diary", async (req, res) => {
  try {
    const { content, mood = "neutral", energy = "normal" } = req.body;
    if (!content) return void res.status(400).json({ error: "content required" });

    const [row] = await db
      .insert(diaryTable)
      .values({ content, mood, energy })
      .returning();

    res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: "Failed to create diary entry" });
  }
});

// ── CLAIMS ─────────────────────────────────────────────────────────────────
router.get("/lukas/claims", async (req, res) => {
  try {
    const { limit = "50" } = req.query as Record<string, string>;
    const rows = await db
      .select()
      .from(claimsTable)
      .orderBy(desc(claimsTable.observedAt))
      .limit(parseInt(limit) || 50);

    res.json(
      rows.map((c) => ({
        id: c.id,
        subject: c.subject,
        predicate: c.predicate,
        value: c.value,
        confidence: c.confidence,
        evidenceLevel: c.evidenceLevel,
        sourceType: c.sourceType,
        status: c.status,
        corroborations: c.corroborations,
        observedAt: c.observedAt.toISOString(),
      })),
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to get claims" });
  }
});

// ── REFLECT ────────────────────────────────────────────────────────────────
// Löst eine echte Selbstreflexion aus: Lukas schreibt einen Tagebucheintrag
// über die letzten Gespräche/Ziele und aktualisiert seinen Status.
router.post("/lukas/reflect", async (req, res) => {
  try {
    const entry = await runReflection(true);
    if (!entry) return void res.status(500).json({ error: "Reflection produced no entry" });
    res.status(201).json({ ...entry, createdAt: entry.createdAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: "Failed to reflect" });
  }
});

// ── DEBUG-LOG ──────────────────────────────────────────────────────────────
// Letzte Fehler aus Chat/Public-Chat/Custom-LLM/TTS/Voice-Session — im
// Dashboard einsehbar, damit Fehlerursachen (z.B. beim ElevenLabs-Test) ohne
// Railway-Log-Zugriff sichtbar sind. Liegt in der DB, ueberlebt Neustarts.
router.get("/lukas/debug-log", async (req, res) => {
  try {
    res.json(await getDebugLog());
  } catch (err) {
    res.status(500).json({ error: "Failed to get debug log" });
  }
});

/*
 * Was auf Issa wartet — für die Startseite.
 *
 * DER ANLASS: Lukas meldet sich, wenn er allein nicht weiterkommt, und bleibt
 * dann stehen. Diese Meldung lag in einem eigenen Tab, die offenen Freigaben
 * in einem zweiten. Beides sah man nur, wenn man ohnehin schon wusste, dass
 * etwas ansteht — und wenn man das wusste, brauchte man die Ansicht nicht
 * mehr. Die Startseite ist die Seite, die man aufmacht, ohne etwas zu wissen.
 *
 * EIN EIGENER ENDPUNKT und nicht ein Feld in /dashboard: eine Freigabe
 * entsteht, während Lukas arbeitet, und ist nach Minuten wieder weg. Das
 * gehört häufiger nachgeladen als sein Tagebuch — und die restliche Übersicht
 * dafür alle zehn Sekunden neu zu berechnen wäre Verschwendung.
 *
 * ABGELAUFENE FREIGABEN WERDEN HIER AUSSORTIERT, nicht erst in der Ansicht.
 * Der Server weiß, wann eine abgelaufen ist; wer das der Oberfläche
 * überlässt, hat dieselbe Regel an zwei Stellen und irgendwann in einer davon
 * falsch. Was hier herauskommt, ist ausnahmslos etwas, das Issa jetzt
 * entscheiden KANN — sonst drückt er auf "Erlauben", sieht keinen Fehler und
 * hält für erledigt, was weiter offen ist.
 */
router.get("/lukas/wartet", async (_req, res) => {
  try {
    res.json(await wartendes());
  } catch (err) {
    logger.error({ err }, "Wartendes konnte nicht gelesen werden");
    res.status(500).json({ error: "Failed to load pending items" });
  }
});

/*
 * Zugänge: Anmeldedaten, die Lukas benutzt und nie sieht.
 *
 * DIE LISTE GIBT KEINE WERTE ZURUECK — und das ist keine Bequemlichkeit,
 * sondern der Zweck. Waere sie auslesbar, waere der API-Token nicht mehr nur
 * der Schluessel zu Lukas, sondern zu jedem Konto, das Lukas benutzt. Aendern
 * heisst deshalb ueberschreiben, nicht bearbeiten.
 */
router.get("/lukas/zugaenge", async (_req, res) => {
  try {
    res.json({ bereit: tresorBereit(), zugaenge: await listeZugaenge() });
  } catch (err) {
    logger.error({ err }, "Zugänge konnten nicht gelesen werden");
    res.status(500).json({ error: "Failed to list credentials" });
  }
});

router.put("/lukas/zugaenge", async (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    res.json(
      await setzeZugang({
        sitzung: String(b.sitzung ?? ""),
        feld: String(b.feld ?? ""),
        wert: String(b.wert ?? ""),
        host: typeof b.host === "string" ? b.host : undefined,
        notiz: typeof b.notiz === "string" ? b.notiz : undefined,
      }),
    );
  } catch (err) {
    /*
     * Der Fehlertext geht an die Oberflaeche. Er darf sagen, WAS fehlt
     * (Schluessel, Feldname, Wert) — aber nie den Wert selbst enthalten,
     * deshalb wird hier nichts aus dem Rumpf zurueckgespiegelt.
     */
    const grund = err instanceof Error ? err.message : "Fehler";
    logger.warn({ err }, "Zugang konnte nicht hinterlegt werden");
    res.status(400).json({ error: grund });
  }
});

router.delete("/lukas/zugaenge/:sitzung/:feld", async (req, res) => {
  try {
    const weg = await loescheZugang(String(req.params.sitzung), String(req.params.feld));
    if (!weg) return void res.status(404).json({ error: "Nicht gefunden" });
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Zugang konnte nicht gelöscht werden");
    res.status(500).json({ error: "Failed to delete credential" });
  }
});

/*
 * Kennzahlen.
 *
 * Bewusst OHNE Parameter fuer den Zeitraum: vierzehn Tage sind lang genug,
 * dass ein Median etwas bedeutet, und kurz genug, dass die Rohdaten in einem
 * Zug lesbar bleiben. Ein frei waehlbares Fenster laedt dazu ein, so lange
 * zu schieben, bis die Zahl gefaellt.
 */
router.get("/lukas/kennzahlen", async (_req, res) => {
  try {
    res.json(await kennzahlen(14));
  } catch (err) {
    logger.error({ err }, "Kennzahlen konnten nicht berechnet werden");
    res.status(500).json({ error: "Failed to compute metrics" });
  }
});

/*
 * Meldungen: was Lukas von Issa braucht.
 *
 * Bewusst eine eigene Liste und kein Chat-Verlauf — eine Meldung hat einen
 * Zustand. Sie ist offen, bis Issa geantwortet hat, und genau das soll man
 * sehen koennen, ohne zu suchen.
 */
router.get("/lukas/meldungen", async (_req, res) => {
  try {
    const rows = await listeMeldungen();
    res.json(
      rows.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
        erledigtAt: m.erledigtAt?.toISOString() ?? null,
      })),
    );
  } catch (err) {
    logger.error({ err }, "Meldungen konnten nicht gelesen werden");
    res.status(500).json({ error: "Failed to get meldungen" });
  }
});

router.post("/lukas/meldungen/:id/antwort", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return void res.status(400).json({ error: "id ungültig" });
    const row = await beantworteMeldung(id, String(req.body?.antwort ?? ""));
    res.json({
      ...row,
      createdAt: row.createdAt.toISOString(),
      erledigtAt: row.erledigtAt?.toISOString() ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Meldung konnte nicht beantwortet werden");
    res.status(500).json({ error: message });
  }
});

/*
 * Gehirn-Snapshot: Knoten und Kanten.
 *
 * Zwei Ausgaenge auf dieselbe Momentaufnahme — der Graph als JSON fuer die
 * Ansicht im Dashboard, und derselbe Graph als Obsidian-Vault zum Mitnehmen.
 * Auf Railway liegt der Vault sonst in einem Container, der beim naechsten
 * Deploy weg ist; als ZIP ist er eine Datei, die Issa behalten kann.
 */
router.get("/lukas/gehirn", async (_req, res) => {
  try {
    const gehirn = await baueGehirn();
    res.json({
      ...gehirn,
      // Der Fließtext einer Erinnerung kann lang sein. Fuers Bild reicht ein
      // Anriss; wer alles will, laedt den Vault.
      knoten: gehirn.knoten.map((k) => ({ ...k, text: k.text.slice(0, 600) })),
    });
  } catch (err) {
    logger.error({ err }, "Gehirn-Graph konnte nicht gebaut werden");
    recordDebugEvent("gehirn", err);
    res.status(500).json({ error: "Failed to build brain graph" });
  }
});

router.get("/lukas/gehirn/vault.zip", async (_req, res) => {
  try {
    const gehirn = await baueGehirn();
    const zip = packeZip(gehirnVault(gehirn));
    const name = `lukas-gehirn-${gehirn.stand.slice(0, 10)}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Content-Length", String(zip.length));
    res.end(zip);
  } catch (err) {
    logger.error({ err }, "Gehirn-Vault konnte nicht gepackt werden");
    recordDebugEvent("gehirn", err);
    res.status(500).json({ error: "Failed to build vault" });
  }
});

// ── REALTIME-SESSION (privater Sprachkanal, OpenAI Realtime) ────────────────
// Erzeugt ein kurzlebiges Client-Secret fuer OpenAIs Realtime API (Speech-to-
// Speech, gpt-realtime-2.1) MIT Lukas' vollem privaten Kontext (Erinnerungen,
// Ziele, Tagebuch, Emotion) als serverseitig hinterlegte Session-Instructions.
// Der echte OpenAI-Key bleibt auf dem Server; der Browser bekommt nur das
// kurzlebige Secret (ek_...) und verbindet direkt per WebRTC zu OpenAI --
// dadurch entfaellt der Umweg ueber unseren Server waehrend des Gesprächs,
// was fuer echtes Conversational-Tempo (wie ChatGPTs Sprachmodus) noetig ist.
// Diese Route liegt unter /api (nicht /public/*) und ist damit durch
// LUKAS_API_TOKEN geschuetzt -- anders als der oeffentliche Custom-LLM-Pfad
// bekommt dieser Kanal Lukas' VOLLES privates Wissen zu hoeren.
router.post("/lukas/realtime-session", async (req, res) => {
  try {
    const basePrompt = await buildSystemPrompt();
    // Sprachspezifischer Zusatz: die Realtime-Stimmen sind primär auf Englisch
    // trainiert und färben deutsche Wörter sonst mit englischer Aussprache/
    // Betonung ein — das hier gilt nur fürs Sprechen, nicht für den Text-Chat
    // (dort keine Aussprache). Ganz oben platziert (nicht nur angehängt),
    // damit das Modell es als wichtigste Verhaltensregel gewichtet.
    const instructions = `SPRACHAUSGABE (WICHTIGSTE REGEL): Du sprichst AUSSCHLIESSLICH mit nativer, akzentfreier
deutscher Aussprache — jedes Wort so, wie ein deutscher Muttersprachler es sagen würde,
auch Namen und Fremdwörter. Keine englische Betonung, keine englische Klangfärbung.
Ruhiger, männlicher, conversational-natürlicher Tonfall.

${basePrompt}`;
    const clientSecret = await openai.realtime.clientSecrets.create({
      session: {
        type: "realtime",
        model: process.env.LUKAS_REALTIME_MODEL ?? "gpt-realtime-2.1",
        instructions,
        audio: {
          output: { voice: process.env.LUKAS_REALTIME_VOICE ?? "ash" },
          input: {
            // near_field statt far_field — siehe public.ts für Details: far_field
            // ist für Konferenz-Mikros aus der Distanz gedacht, nicht für ein
            // Handy/Laptop dicht am Nutzer, und hat dabei echte Sprache
            // mit-weggefiltert ("antwortet manchmal nicht").
            noise_reduction: { type: "near_field" },
            // Expliziter Sprach-Hinweis für die Eingabe-Transkription. model
            // ist in den TS-Typen optional, die echte API verlangt es aber
            // zwingend sobald `transcription` gesetzt ist (sonst 400).
            transcription: { model: "gpt-4o-mini-transcribe", language: "de" },
            // semantic_vad statt fixem Stille-Timer — siehe public.ts für Details.
            turn_detection: { type: "semantic_vad", eagerness: "auto" },
          },
        },
      },
      expires_after: { anchor: "created_at", seconds: 600 },
    });
    res.json({ value: clientSecret.value, expiresAt: clientSecret.expires_at });
  } catch (err) {
    logger.error({ err }, "Realtime-Session error");
    recordDebugEvent("realtime-session", err);
    const detail = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Realtime session failed", detail });
  }
});

export default router;
