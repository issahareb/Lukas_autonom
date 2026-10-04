/*
 * Telefon: der Webhook fuer Anrufe und die Verwaltung der Nummern.
 *
 * Der Webhook liegt bewusst in einem eigenen Router. Er wird — wie der
 * WhatsApp-Webhook, aus demselben Grund — VOR lukasAuth gemountet: OpenAI ruft
 * ihn auf und kann keinen privaten Bearer-Token mitschicken. Abgesichert ist er
 * stattdessen durch die signierte Zustellung; ohne gueltige Signatur passiert
 * hier gar nichts.
 */
import multer from "multer";
import { toFile } from "openai";
import { telefonHinweis, hinweisAnruf } from "../lib/telefon-hinweis";
import { Router } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { istTelnyx, telnyxBereit, telnyxSignatur, telnyxXml, telnyxStand, pruefeTelefonKontext } from "../lib/telnyx";
import { z } from "zod";
import { db } from "@workspace/db";
import { telefonNummern } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai";
import {
  nimmAn, weiseAb, nummerAusSip, normalisiere, letzteAnrufe, protokolliere, twilioZugang,
  twilioStand, twilioEinrichten, starteAnruf,
} from "../lib/telefon";
import { logger } from "../lib/logger";
import { LiveSessionError } from "../lib/ai/live-error";
import { sendeSms, letzteSms, zugangVorhanden, nimmSmsEntgegen } from "../lib/sms";
import { meldeDichBeiIssa } from "../lib/melden";
import { recordDebugEvent } from "../lib/debug-log";
import { telnyxStatusEingang, aktualisiereAnruf } from "../lib/telefon-status";
import { telnyxAufnahmeEingang, ladeTelefonAufnahme, TelefonAufnahmeFehler } from "../lib/telefon-aufnahme";

import { mithoerenAntwort, mithoerenTicketAntwort } from "../lib/telefon-mithoeren";

export const telefonWebhookRouter = Router();

telefonWebhookRouter.post("/telefon/telnyx/aufnahme", async (req, res) => {
  const raw = (req as typeof req & { rawBody?: Buffer }).rawBody;
  if (!istTelnyx() || !telnyxSignatur(raw, req.get("telnyx-timestamp") ?? "", req.get("telnyx-signature-ed25519") ?? "")) {
    return void res.status(401).send("ungültige Signatur");
  }
  const id = typeof req.query.anruf === "string" ? req.query.anruf : "";
  if (!/^[a-f0-9-]{36}$/.test(id)) return void res.status(400).send("ungültige Anruf-ID");
  try {
    await telnyxAufnahmeEingang(req.body ?? {}, id);
    res.status(200).send("ok");
  } catch {
    logger.warn({ route: "telnyx/aufnahme" }, "Aufnahmezustellung noch nicht verarbeitet");
    res.status(503).send("Zustellung wiederholen");
  }
});

telefonWebhookRouter.post("/telefon/telnyx/status", async (req, res) => {
  const raw = (req as typeof req & { rawBody?: Buffer }).rawBody;
  if (!istTelnyx() || !telnyxSignatur(raw, req.get("telnyx-timestamp") ?? "", req.get("telnyx-signature-ed25519") ?? "")) {
    return void res.status(401).send("ungültige Signatur");
  }
  const id = typeof req.query.anruf === "string" ? req.query.anruf : undefined;
  if (id && !/^[a-f0-9-]{36}$/.test(id)) return void res.status(400).send("ungültige Anruf-ID");
  try {
    const tracked = await telnyxStatusEingang(req.body ?? {}, id);
    logger.info({ route: "telnyx/status", tracked }, "Telnyx-Anrufstatus verarbeitet");
    res.status(200).send("ok");
  } catch (err) {
    logger.warn({ err, route: "telnyx/status" }, "Telnyx-Anrufstatus noch nicht verarbeitet");
    res.status(503).send("Statuszustellung wiederholen");
  }
});

telefonWebhookRouter.post("/telefon/telnyx/texml", async (req, res) => {
  const raw = (req as typeof req & { rawBody?: Buffer }).rawBody;
  if (!telnyxSignatur(raw, req.get("telnyx-timestamp") ?? "", req.get("telnyx-signature-ed25519") ?? "")) {
    logger.warn({ route: "telnyx/texml", outcome: "rejected", reason: "invalid_signature", httpStatus: 401 }, "Telnyx-TeXML-Eingang abgewiesen");
    return void res.status(401).send("ungültige Signatur");
  }
  // A valid signature from another application in this account is not enough.
  const checks = {
    providerSelected: istTelnyx(), configured: telnyxBereit(),
    connectionMatches: req.body?.ConnectionId === process.env.TELNYX_APP_ID,
    destinationMatches: req.body?.To === process.env.TELNYX_NUMMER,
  };
  if (!checks.providerSelected || !checks.configured || !checks.connectionMatches || !checks.destinationMatches) {
    logger.warn({ route: "telnyx/texml", outcome: "rejected", reason: "configuration_mismatch", httpStatus: 403, ...checks }, "Telnyx-TeXML-Eingang abgewiesen");
    return void res.status(403).type("text/xml").send('<Response><Reject/></Response>');
  }
  try {
    const from = typeof req.body.From === "string" && /^\+[1-9]\d{5,14}$/.test(req.body.From) ? req.body.From : "";
    res.setHeader("Cache-Control", "no-store");
    res.type("text/xml").send(telnyxXml(from, "eingehend"));
    logger.info({ route: "telnyx/texml", outcome: "xml_returned", httpStatus: 200 }, "Telnyx-TeXML für SIP-Weiterleitung ausgeliefert");
  } catch {
    logger.warn({ route: "telnyx/texml", outcome: "rejected", reason: "xml_generation_failed", httpStatus: 503 }, "Telnyx-TeXML konnte nicht erstellt werden");
    res.status(503).type("text/xml").send('<Response><Reject/></Response>');
  }
});

// Provider retries must not accept the same OpenAI call twice.
const bearbeiteteAnrufe = new Map<string, number>();
const laufendeAnrufe = new Map<string, Promise<void>>();
const LiveIncoming = z.object({
  type: z.literal("live.transport.incoming"),
  data: z.object({
    type: z.literal("sip"),
    session_id: z.string().min(1).max(256).regex(/^[^\x00-\x20\x7f]+$/),
    sip_headers: z.array(z.object({
      name: z.string().max(256), value: z.string().max(8192),
    })).max(128),
  }),
});

/*
 * Eingehende SMS von ClickSend.
 *
 * Oeffentlich erreichbar wie die anderen Webhooks — und deshalb bewusst
 * WIRKUNGSLOS: die Nachricht wird abgelegt und Issa gemeldet, sie loest kein
 * Werkzeug aus und gibt nichts frei. Eine SMS ist nicht authentifiziert, die
 * Absendernummer behauptet das Netz. Wer hier etwas ausloesen koennte, haette
 * einen Weg, Lukas von aussen zu steuern.
 *
 * Wenn LUKAS_CLICKSEND_WEBHOOK_TOKEN gesetzt ist, muss es als ?token=… in der
 * Adresse stehen — ClickSend kann keine Kopfzeilen mitschicken. Das ist kein
 * Ersatz fuer eine Signatur, aber es haelt zufaellige Anfragen fern.
 */
telefonWebhookRouter.post("/sms/eingehend", async (req, res) => {
  const erwartet = process.env.LUKAS_CLICKSEND_WEBHOOK_TOKEN?.trim();
  if (erwartet && String(req.query.token ?? "") !== erwartet) {
    return void res.status(401).send("nein");
  }

  // Immer 200: ein Fehler unsererseits soll ClickSend nicht zu endlosen
  // Wiederholungen derselben Nachricht bringen.
  res.status(200).send("ok");

  try {
    const eingang = await nimmSmsEntgegen((req.body ?? {}) as Record<string, unknown>);
    /*
     * `angenommen`, nicht `gespeichert`: ob wir die Nachricht ablegen konnten,
     * ist unser Problem. Angekommen ist sie so oder so, und Issa soll sie
     * sehen — bei einer Datenbankstoerung erst recht, denn dann ist die
     * Meldung die einzige Spur.
     */
    if (eingang.angenommen && eingang.stufe !== "gesperrt") {
      await meldeDichBeiIssa({
        betreff: `SMS von ${eingang.nummer}`,
        text: eingang.text,
      }).catch(() => {});
    }
  } catch (err) {
    recordDebugEvent("sms/eingehend", err);
  }
});

telefonWebhookRouter.post("/telefon/eingehend", async (req, res) => {
  const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
  if (!rawBody) return void res.status(400).send("kein Body");
  let ereignis: unknown;
  try {
    // unwrap ist asynchron: erst nach gültiger Signatur und Zeitstempel weiter.
    ereignis = await openai.webhooks.unwrap(rawBody.toString("utf8"), req.headers as Record<string, string>);
  } catch (err) {
    recordDebugEvent("telefon/webhook", err);
    return void res.status(401).send("ungültige Signatur");
  }
  if (!ereignis || typeof ereignis !== "object" ||
      (ereignis as { type?: unknown }).type !== "live.transport.incoming") {
    // Derselbe SIP-Anruf kann zusätzlich ein Realtime-Ereignis erzeugen.
    // Nur Live annehmen; der erste Accept entscheidet über das Protokoll.
    return void res.status(200).send("ignoriert");
  }
  const parsed = LiveIncoming.safeParse(ereignis);
  if (!parsed.success) return void res.status(400).send("ungültiges Live-Ereignis");
  const { session_id: sessionId, sip_headers: headers } = parsed.data.data;
  const jetzt = Date.now();
  for (const [id, zeit] of bearbeiteteAnrufe) {
    if (jetzt - zeit > 600_000) bearbeiteteAnrufe.delete(id);
  }
  if (bearbeiteteAnrufe.has(sessionId)) return void res.status(200).send("bereits bearbeitet");

  let arbeit = laufendeAnrufe.get(sessionId);
  if (!arbeit) {
    if (laufendeAnrufe.size >= 100) return void res.status(503).send("kurz erneut versuchen");
    arbeit = (async () => {
      const from = headers.find(h => h.name.toLowerCase() === "from")?.value ?? "";
      const contextHeader = headers.find(h => h.name.toLowerCase() === "x-lukas-context")?.value ?? "";
      const kontext = pruefeTelefonKontext(contextHeader);
      if (istTelnyx() && !kontext) {
        await weiseAb(sessionId, "Telnyx-Anruf ohne gültigen Gesprächskontext");
        return;
      }
      const nummer = kontext?.nummer ?? nummerAusSip(from);
      try {
        const stufe = await nimmAn(sessionId, nummer, kontext ?? undefined);
        logger.info({ sessionId, stufe }, "Live-Anruf angenommen");
      } catch (err) {
        recordDebugEvent("telefon/annehmen", err);
        await protokolliere({
          richtung: kontext?.richtung ?? "eingehend", nummer, ergebnis: "fehlgeschlagen",
          detail: "Live-Annahme oder Verbindung zum Sprach-Backend fehlgeschlagen.",
        });
        // Nach erfolgreichem Accept beendet der Manager bei Anschlussfehlern.
        // Dieser bereits angenommene Anruf darf nicht erneut gestartet werden.
        if (err instanceof LiveSessionError && err.accepted) {
          if (kontext?.richtung === "ausgehend") await aktualisiereAnruf(kontext.id, { sipStatus: "failed" });
          return;
        }
        // Ein Timeout beweist nicht, dass OpenAI nicht angenommen hat.
        // Deshalb keinen möglicherweise bereits laufenden Anruf abweisen.
        throw err;
      }
    })();
    laufendeAnrufe.set(sessionId, arbeit);
  }
  try {
    // Erst die Annahme sichern, dann bestätigen. Gleichzeitige Wiederholungen
    // warten auf dieselbe Arbeit und lösen keinen zweiten Accept aus.
    await arbeit;
    bearbeiteteAnrufe.set(sessionId, Date.now());
    if (bearbeiteteAnrufe.size > 2000) {
      bearbeiteteAnrufe.delete(bearbeiteteAnrufe.keys().next().value!);
    }
    res.status(200).send("ok");
  } catch (err) {
    logger.error({ err, sessionId }, "Live-Annahme fehlgeschlagen");
    res.status(503).send("Annahme fehlgeschlagen; Zustellung wiederholen");
  } finally {
    if (laufendeAnrufe.get(sessionId) === arbeit) laufendeAnrufe.delete(sessionId);
  }
});

// ── Verwaltung (hinter LUKAS_API_TOKEN) ────────────────────────────────────

const router = Router();

const serialize = (r: typeof telefonNummern.$inferSelect) => ({
  id: r.id,
  nummer: r.nummer,
  name: r.name,
  stufe: r.stufe,
  darfAngerufenWerden: r.darfAngerufenWerden,
  mithoerenZustimmung: r.mithoerenZustimmung,
  mithoerenQuelle: r.mithoerenQuelle,
  mithoerenBestaetigtAm: r.mithoerenBestaetigtAm?.toISOString() ?? null,
  aufnahmeZustimmung: r.aufnahmeZustimmung,
  aufnahmeQuelle: r.aufnahmeQuelle,
  aufnahmeBestaetigtAm: r.aufnahmeBestaetigtAm?.toISOString() ?? null,
  notiz: r.notiz,
  zuletztGesehen: r.zuletztGesehen?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

router.get("/lukas/telefon", async (_req, res) => {
  try {
    const [nummern, anrufe] = await Promise.all([
      db.select().from(telefonNummern).orderBy(desc(telefonNummern.createdAt)),
      letzteAnrufe(30),
    ]);
    res.json({
      nummern: nummern.map(serialize),
      anrufe: anrufe.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      // Damit das Dashboard sagen kann, was noch fehlt, statt still nichts zu tun.
      anbieter: istTelnyx() ? "telnyx" : "twilio",
      bereit: {
        webhook: Boolean(process.env.OPENAI_WEBHOOK_SECRET),
        anrufen: istTelnyx() ? telnyxBereit() : Boolean(twilioZugang() && process.env.TWILIO_NUMMER && process.env.OPENAI_PROJECT_ID),
      },
    });
  } catch (err) {
    logger.error({ err }, "Telefonnummern laden fehlgeschlagen");
    res.status(500).json({ error: "Failed to load phone numbers" });
  }
});

router.get("/lukas/telefon/anrufe/:id/live", mithoerenAntwort);
router.post("/lukas/telefon/anrufe/:id/live-ticket", mithoerenTicketAntwort);
router.post("/lukas/telefon/anrufe/:id/hinweis", async (req, res) => {
  try {
    const parsed = z.object({ text: z.string().trim().min(1).max(2000) }).parse(req.body);
    res.json({ message: await telefonHinweis(Number(req.params.id), parsed.text) });
  } catch (err) { res.status(409).json({ error: err instanceof Error ? err.message : "Hinweis nicht übermittelt." }); }
});
const whisperUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
const whisperBusy = new Set<number>();
router.post("/lukas/telefon/anrufe/:id/einfluestern", (req, res, next) => {
  whisperUpload.single("audio")(req, res, err => err ? res.status(400).json({ error: "Die Sprachaufnahme ist zu groß oder ungültig." }) : next());
}, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0 || !req.file || req.file.size < 100 || !/^(audio|video)\/(mp4|mpeg|webm|ogg|wav|x-wav)(;|$)/i.test(req.file.mimetype)) {
    return void res.status(400).json({ error: "Bitte einen kurzen Sprachhinweis aufnehmen." });
  }
  if (whisperBusy.has(id) || whisperBusy.size >= 4) return void res.status(429).json({ error: "Ein Sprachhinweis wird noch verarbeitet." });
  whisperBusy.add(id);
  try {
    await hinweisAnruf(id);
    const file = await toFile(req.file.buffer, req.file.mimetype.includes("mp4") ? "hinweis.mp4" : req.file.mimetype.includes("webm") ? "hinweis.webm" : "hinweis.wav", { type: req.file.mimetype });
    const result = await openai.audio.transcriptions.create({ model: "gpt-4o-mini-transcribe", file, language: "de" }, { timeout: 30000, maxRetries: 0 });
    const text = result.text.trim();
    res.json({ text, message: await telefonHinweis(id, text) });
  } catch { res.status(409).json({ error: "Sprachhinweis nicht übermittelt. Bitte erneut versuchen oder den Hinweis eintippen." }); }
  finally { whisperBusy.delete(id); }
});


router.get("/lukas/telefon/anrufe/:id/aufnahme", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return void res.status(400).json({ error: "Ungültige Anruf-ID" });
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const media = await ladeTelefonAufnahme(id);
    if (!media) return void res.status(404).json({ error: "Noch keine Aufnahme verfügbar." });
    const type = media.headers.get("content-type")?.split(";")[0];
    res.setHeader("Content-Type", type?.startsWith("audio/") ? type : "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename="anruf-${id}.${type?.includes("wav") ? "wav" : "mp3"}"`);
    await pipeline(Readable.fromWeb(media.body! as import("node:stream/web").ReadableStream), res);
  } catch (err) {
    logger.warn({ anrufId: id, code: err instanceof TelefonAufnahmeFehler ? err.code : "stream_failed",
      httpStatus: err instanceof TelefonAufnahmeFehler ? err.httpStatus : undefined }, "Telefonaufnahme laden fehlgeschlagen");
    if (!res.headersSent) res.status(502).json({ error: "Aufnahme konnte nicht geladen werden. Bitte erneut versuchen." });
    else res.destroy();
  }
});

/*
 * Twilio-Einrichtung aus dem Dashboard.
 *
 * Dieselben drei Aufrufe wie im Skript, nur ohne Kommandozeile — und ohne dass
 * die Zugangsdaten irgendwo landen, wo sie nicht hingehoeren: der Server hat
 * sie als Umgebungsvariablen ohnehin.
 */
router.get("/lukas/telefon/telnyx", async (_req, res) => {
  try { res.json(await telnyxStand()); }
  catch (err) { res.status(502).json({ error: err instanceof Error ? err.message : "Telnyx nicht erreichbar" }); }
});

router.get("/lukas/telefon/twilio", async (_req, res) => {
  try {
    res.json(await twilioStand());
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Fehler" });
  }
});

router.post("/lukas/telefon/einrichten", async (req, res) => {
  const nummer = String((req.body ?? {}).nummer ?? "").trim();
  if (!nummer.startsWith("+")) {
    return void res.status(400).json({ error: "Nummer in der Form +49… angeben." });
  }
  try {
    res.json({ schritte: await twilioEinrichten(nummer) });
  } catch (err) {
    logger.error({ err }, "Twilio-Einrichtung fehlgeschlagen");
    res.status(400).json({ error: err instanceof Error ? err.message : "Fehler" });
  }
});

/*
 * Testanruf. Umgeht bewusst die Freigabe-Liste NICHT — wer hier anrufen will,
 * muss die Nummer vorher freigeschaltet haben. Sonst waere das Dashboard ein
 * Weg, die Sperre zu umgehen, die es selbst verwaltet.
 */
/*
 * SMS.
 *
 * Bewusst hier und nicht in einer eigenen Datei: es ist dieselbe Sache wie das
 * Telefon — eine Nummer, ein Kontakt, dieselbe Sperrliste. Wer am Telefon
 * abgewiesen wird, bekommt auch keine SMS; das prueft lib/sms.ts.
 */
router.get("/lukas/sms", async (_req, res) => {
  try {
    const zeilen = await letzteSms(50);
    res.json({
      bereit: zugangVorhanden(),
      nachrichten: zeilen.map((z) => ({ ...z, createdAt: z.createdAt.toISOString() })),
    });
  } catch (err) {
    logger.error({ err }, "SMS-Liste konnte nicht gelesen werden");
    res.status(500).json({ error: "SMS konnten nicht geladen werden" });
  }
});

router.post("/lukas/sms", async (req, res) => {
  try {
    const ergebnis = await sendeSms({
      an: String(req.body?.an ?? ""),
      text: String(req.body?.text ?? ""),
      // Aus dem Dashboard hat Issa selbst getippt — das ist seine eigene
      // Nachricht, keine von Lukas formulierte.
      quelle: "dashboard",
    });
    res.status(ergebnis.ok ? 200 : 502).json(ergebnis);
  } catch (err) {
    const grund = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "SMS aus dem Dashboard fehlgeschlagen");
    res.status(400).json({ error: grund });
  }
});

router.post("/lukas/telefon/testanruf", async (req, res) => {
  const nummer = String((req.body ?? {}).nummer ?? "").trim();
  if (!nummer) return void res.status(400).json({ error: "Nummer fehlt." });
  try {
    res.json({ meldung: await starteAnruf(nummer, "Testanruf aus dem Dashboard") });
  } catch (err) {
    logger.error({ err }, "Testanruf fehlgeschlagen");
    res.status(400).json({ error: err instanceof Error ? err.message : "Fehler" });
  }
});

const NummerBody = z.object({
  nummer: z.string().min(4).max(32),
  name: z.string().max(80).optional(),
  stufe: z.enum(["privat", "oeffentlich", "gesperrt"]).optional(),
  darfAngerufenWerden: z.boolean().optional(),
  mithoerenZustimmung: z.boolean().optional(),
  mithoerenQuelle: z.enum(["", "email", "homepage", "schriftlich"]).optional(),
  aufnahmeZustimmung: z.boolean().optional(),
  aufnahmeQuelle: z.enum(["", "email", "homepage", "bestaetigt"]).optional(),
  notiz: z.string().max(300).optional(),
});

function mithoerenWerte(data: Partial<z.infer<typeof NummerBody>>) {
  if (data.mithoerenZustimmung === undefined) return {};
  return { mithoerenZustimmung: data.mithoerenZustimmung,
    mithoerenQuelle: data.mithoerenZustimmung ? data.mithoerenQuelle || "schriftlich" : "",
    mithoerenBestaetigtAm: data.mithoerenZustimmung ? new Date() : null };
}

function aufnahmeWerte(data: z.infer<typeof NummerBody> | Partial<z.infer<typeof NummerBody>>) {
  if (data.aufnahmeZustimmung === undefined) return {};
  return { aufnahmeZustimmung: data.aufnahmeZustimmung,
    aufnahmeQuelle: data.aufnahmeZustimmung ? data.aufnahmeQuelle || "bestaetigt" : "",
    aufnahmeBestaetigtAm: data.aufnahmeZustimmung ? new Date() : null };
}

router.post("/lukas/telefon", async (req, res) => {
  const parsed = NummerBody.safeParse(req.body ?? {});
  if (!parsed.success) return void res.status(400).json({ error: "Nummer ist nötig." });

  const nummer = normalisiere(parsed.data.nummer);
  if (nummer.length < 6) {
    return void res.status(400).json({ error: "Das sieht nicht nach einer Telefonnummer aus." });
  }

  try {
    // Zweimal dieselbe Nummer mit verschiedenen Stufen waere ein Zufallsergebnis.
    const [vorhanden] = await db
      .select()
      .from(telefonNummern)
      .where(eq(telefonNummern.nummer, nummer))
      .limit(1);
    if (vorhanden) {
      return void res.status(409).json({ error: "Diese Nummer steht schon in der Liste." });
    }

    const [row] = await db
      .insert(telefonNummern)
      .values({
        nummer,
        name: parsed.data.name ?? "",
        stufe: parsed.data.stufe ?? "oeffentlich",
        darfAngerufenWerden: parsed.data.darfAngerufenWerden ?? false,
        ...aufnahmeWerte(parsed.data), ...mithoerenWerte(parsed.data),
        notiz: parsed.data.notiz ?? "",
      })
      .returning();
    res.status(201).json(serialize(row));
  } catch (err) {
    logger.error({ err }, "Telefonnummer anlegen fehlgeschlagen");
    res.status(500).json({ error: "Failed to create" });
  }
});

router.patch("/lukas/telefon/:id", async (req, res) => {
  const id = Number.parseInt(String(req.params.id), 10);
  const parsed = NummerBody.partial().safeParse(req.body ?? {});
  if (!Number.isInteger(id) || !parsed.success) {
    return void res.status(400).json({ error: "Ungültige Eingabe" });
  }
  try {
    const { aufnahmeQuelle: _quelle, mithoerenQuelle: _mithoerenQuelle, ...rest } = parsed.data;
    const werte: Record<string, unknown> = { ...rest, ...aufnahmeWerte(parsed.data), ...mithoerenWerte(parsed.data) };
    if (typeof parsed.data.nummer === "string") {
      const nummer = normalisiere(parsed.data.nummer);
      if (!/^[1-9]\d{5,14}$/.test(nummer)) return void res.status(400).json({ error: "Nummer mit Ländervorwahl nötig." });
      const [bisher] = await db.select().from(telefonNummern).where(eq(telefonNummern.id, id)).limit(1);
      const [doppelt] = await db.select().from(telefonNummern).where(eq(telefonNummern.nummer, nummer)).limit(1);
      if (doppelt && doppelt.id !== id) return void res.status(409).json({ error: "Diese Nummer steht schon in der Liste." });
      werte.nummer = nummer;
      if (nummer !== bisher?.nummer && parsed.data.mithoerenZustimmung === undefined) Object.assign(werte, mithoerenWerte({ mithoerenZustimmung: false }));
      if (nummer !== bisher?.nummer && parsed.data.aufnahmeZustimmung === undefined) Object.assign(werte, aufnahmeWerte({ aufnahmeZustimmung: false }));
    }
    const [row] = await db
      .update(telefonNummern)
      .set(werte)
      .where(eq(telefonNummern.id, id))
      .returning();
    if (!row) return void res.status(404).json({ error: "Nicht gefunden" });
    res.json(serialize(row));
  } catch (err) {
    logger.error({ err }, "Telefonnummer ändern fehlgeschlagen");
    res.status(500).json({ error: "Failed to update" });
  }
});

router.delete("/lukas/telefon/:id", async (req, res) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id)) return void res.status(400).json({ error: "Ungültige ID" });
  try {
    await db.delete(telefonNummern).where(eq(telefonNummern.id, id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Telefonnummer löschen fehlgeschlagen");
    res.status(500).json({ error: "Failed to delete" });
  }
});

export default router;
