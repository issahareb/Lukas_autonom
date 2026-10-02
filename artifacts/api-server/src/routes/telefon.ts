/*
 * Telefon: der Webhook fuer Anrufe und die Verwaltung der Nummern.
 *
 * Der Webhook liegt bewusst in einem eigenen Router. Er wird — wie der
 * WhatsApp-Webhook, aus demselben Grund — VOR lukasAuth gemountet: OpenAI ruft
 * ihn auf und kann keinen privaten Bearer-Token mitschicken. Abgesichert ist er
 * stattdessen durch die signierte Zustellung; ohne gueltige Signatur passiert
 * hier gar nichts.
 */
import { Router } from "express";
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
import { sendeSms, letzteSms, zugangVorhanden, nimmSmsEntgegen } from "../lib/sms";
import { meldeDichBeiIssa } from "../lib/melden";
import { recordDebugEvent } from "../lib/debug-log";

export const telefonWebhookRouter = Router();

telefonWebhookRouter.post("/telefon/telnyx/texml", async (req, res) => {
  const raw = (req as typeof req & { rawBody?: Buffer }).rawBody;
  if (!telnyxSignatur(raw, req.get("telnyx-timestamp") ?? "", req.get("telnyx-signature-ed25519") ?? "")) {
    return void res.status(401).send("ungültige Signatur");
  }
  // A valid signature from another application in this account is not enough.
  if (!istTelnyx() || !telnyxBereit() || req.body?.ConnectionId !== process.env.TELNYX_APP_ID ||
    req.body?.To !== process.env.TELNYX_NUMMER) {
    return void res.status(403).type("text/xml").send('<Response><Reject/></Response>');
  }
  try {
    const from = typeof req.body.From === "string" && /^\+[1-9]\d{5,14}$/.test(req.body.From) ? req.body.From : "";
    res.setHeader("Cache-Control", "no-store");
    res.type("text/xml").send(telnyxXml(from, "eingehend"));
  } catch {
    res.status(503).type("text/xml").send('<Response><Reject/></Response>');
  }
});

// Provider retries must not accept the same OpenAI call twice.
const bearbeiteteAnrufe = new Map<string, number>();

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
  if (!rawBody) {
    return void res.status(400).send("kein Body");
  }

  let ereignis: { type?: string; data?: { call_id?: string; sip_headers?: Array<{ name: string; value: string }> } };
  try {
    /*
     * unwrap() prueft die Signatur UND den Zeitstempel und wirft, wenn etwas
     * nicht stimmt. Ohne OPENAI_WEBHOOK_SECRET wirft es ebenfalls — genau
     * richtig: ein ungeprueft angenommener Anruf waere ein offenes Mikrofon
     * in Issas Wohnung.
     */
    ereignis = openai.webhooks.unwrap(rawBody.toString("utf8"), req.headers as Record<string, string>) as typeof ereignis;
  } catch (err) {
    recordDebugEvent("telefon/webhook", err);
    return void res.status(401).send("ungültige Signatur");
  }

  if (ereignis.type !== "realtime.call.incoming") {
    // Andere Ereignisse bestaetigen wir, statt sie als Fehler zu melden —
    // sonst versucht OpenAI sie endlos erneut zuzustellen.
    return void res.status(200).send("ignoriert");
  }

  const callId = ereignis.data?.call_id;
  if (!callId) return void res.status(400).send("call_id fehlt");

  const from = ereignis.data?.sip_headers?.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
  const contextHeader = ereignis.data?.sip_headers?.find(h => h.name.toLowerCase() === "x-lukas-context")?.value ?? "";
  const kontext = pruefeTelefonKontext(contextHeader);
  if (istTelnyx() && !kontext) {
    await weiseAb(callId, "Telnyx-Anruf ohne gültigen Gesprächskontext");
    return void res.status(200).send("abgewiesen");
  }
  const nummer = kontext?.nummer ?? nummerAusSip(from);
  const jetzt = Date.now();
  for (const [id, zeit] of bearbeiteteAnrufe) if (jetzt - zeit > 600000) bearbeiteteAnrufe.delete(id);
  if (bearbeiteteAnrufe.has(callId)) return void res.status(200).send("bereits bearbeitet");
  bearbeiteteAnrufe.set(callId, jetzt);

  /*
   * Sofort bestaetigen, dann annehmen.
   *
   * Das Annehmen holt Erinnerungen aus der Datenbank und baut den Prompt —
   * das dauert. Wer solange mit der Webhook-Antwort wartet, riskiert, dass
   * OpenAI die Zustellung fuer gescheitert haelt und ein zweites Mal
   * zustellt: derselbe Anruf wuerde zweimal angenommen.
   */
  res.status(200).send("ok");

  try {
    const stufe = await nimmAn(callId, nummer, kontext ?? undefined);
    logger.info({ nummer, stufe }, "Anruf angenommen");
  } catch (err) {
    logger.error({ err, nummer }, "Anruf annehmen fehlgeschlagen");
    recordDebugEvent("telefon/annehmen", err);
    await protokolliere({
      richtung: "eingehend",
      nummer,
      ergebnis: "fehlgeschlagen",
      detail: err instanceof Error ? err.message : String(err),
    });
    await weiseAb(callId, "Annehmen fehlgeschlagen");
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
  notiz: z.string().max(300).optional(),
});

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
    const werte: Record<string, unknown> = { ...parsed.data };
    if (typeof parsed.data.nummer === "string") werte.nummer = normalisiere(parsed.data.nummer);
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
