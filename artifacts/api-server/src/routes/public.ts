import { Router } from "express";
import type { Request, Response } from "express";
import type OpenAI from "openai";
import { db } from "@workspace/db";
import { memoriesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai";
import { buildPublicSystemPrompt } from "../lib/public-prompt";
import { anfrageVonWebsite } from "../lib/melden";
import { logger } from "../lib/logger";
import { gleicherToken } from "../middlewares/schutz";
import { recordDebugEvent } from "../lib/debug-log";
import { sprachAudio, sprachModell } from "../lib/ai/sprach-sitzung";

const router = Router();

// Schnelles Modell für den öffentlichen Widget (Portfolio-Besucher erwarten
// Antworten in Sekundenbruchteilen); per Env auf ein anderes Modell umstellbar.
const PUBLIC_MODEL = process.env.LUKAS_PUBLIC_MODEL ?? "gpt-4o-mini";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

// ── Simple in-memory rate limiter (per IP) ─────────────────────────────────
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(req: Request, limit: number, windowMs: number): boolean {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "?";
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count++;
  if (buckets.size > 10000) buckets.clear();
  return bucket.count <= limit;
}

// ── ORIGIN-PRÜFUNG (nur fürs Browser-Widget, nicht für den ElevenLabs-Custom-
// LLM-Endpoint — der wird server-seitig von ElevenLabs aufgerufen und hat
// keinen Browser-Origin; der ist stattdessen über ELEVENLABS_LLM_TOKEN
// geschützt) ─────────────────────────────────────────────────────────────
// Origin/Referer sind von einem nicht-Browser-Client fälschbar — das stoppt
// also keinen gezielten Angreifer mit curl, aber verhindert das versehentliche
// oder böswillige Einbetten des Widgets auf einer fremden Webseite (der
// Hauptfall, den ein Origin-Check abdecken soll). Zusammen mit dem Rate-Limit
// oben ergibt das einen sinnvollen Kostenschutz.
const ALLOWED_WIDGET_HOSTS = ["issahareb.me", "www.issahareb.me", "localhost", "127.0.0.1"];

function isAllowedWidgetOrigin(req: Request): boolean {
  const originHeader = req.headers.origin;
  const refererHeader = req.headers.referer;
  const candidate = originHeader || refererHeader;
  if (!candidate) return false;
  try {
    const host = new URL(candidate).hostname;
    return ALLOWED_WIDGET_HOSTS.includes(host);
  } catch {
    return false;
  }
}

function requireWidgetOrigin(req: Request, res: Response): boolean {
  if (isAllowedWidgetOrigin(req)) return true;
  res.status(403).json({ error: "Origin nicht erlaubt" });
  return false;
}

// ── TOKEN-CHECK (Diagnose, kein Login noetig) ──────────────────────────────
// Zeigt NIE den echten Wert, nur einen Fingerabdruck (Laenge, erstes/letztes
// Zeichen, Leerzeichen/Anfuehrungszeichen-Warnung) -- damit man im Browser
// vergleichen kann, was der Server tatsaechlich als Wert sieht, ohne
// Railway-Logs zu brauchen. Deckt beide Tokens ab, da Railways
// Variablen-Editor bei beiden schon einen Zeilenumbruch angehaengt hat.
function tokenFingerprint(token: string | undefined) {
  if (!token) return { set: false as const };
  return {
    set: true as const,
    length: token.length,
    firstChar: token[0],
    lastChar: token[token.length - 1],
    hasLeadingWhitespace: token !== token.trimStart(),
    hasTrailingWhitespace: token !== token.trimEnd(),
    hasSurroundingQuotes: /^["']/.test(token) || /["']$/.test(token),
  };
}

router.get("/public/token-check", (req, res) => {
  res.json({
    LUKAS_API_TOKEN: tokenFingerprint(process.env.LUKAS_API_TOKEN),
    ELEVENLABS_LLM_TOKEN: tokenFingerprint(process.env.ELEVENLABS_LLM_TOKEN),
  });
});

// Kurzer, günstiger Zusatz-Call NACH der eigentlichen Antwort: schlägt EINE
// natürliche Folgefrage vor, passend zum gerade geführten Austausch — nicht
// generisch, sondern spezifisch auf das an, was Lukas gerade beantwortet hat.
// Fehler hier dürfen den Chat nie kaputt machen (siehe .catch am Call-Ort).
async function suggestFollowUp(
  convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  answer: string,
): Promise<string | null> {
  const lastUser = convo[convo.length - 1];
  const resp = await openai.chat.completions.create({
    model: PUBLIC_MODEL,
    max_completion_tokens: 40,
    messages: [
      {
        role: "system",
        content:
          "Du schlägst EINE kurze, natürliche Folgefrage vor (max. 12 Wörter), die ein Website-Besucher als " +
          "Nächstes an Lukas stellen könnte — passend zum gerade geführten Austausch, nicht generisch. " +
          "Antworte NUR mit der Frage selbst (keine Anführungszeichen, kein Präfix), in derselben Sprache " +
          "wie das Gespräch (Deutsch oder Englisch).",
      },
      { role: "user", content: `Besucher fragte: "${lastUser?.content ?? ""}"` },
      { role: "assistant", content: answer.slice(0, 800) },
    ],
  });
  const suggestion = resp.choices[0]?.message?.content?.trim() ?? "";
  return suggestion.length > 0 && suggestion.length < 160 ? suggestion : null;
}

// ── PUBLIC CHAT (SSE) ──────────────────────────────────────────────────────
// Stateless: der Client schickt die bisherige Konversation mit.
router.post("/public/chat", async (req, res) => {
  try {
    if (!requireWidgetOrigin(req, res)) return;
    if (!rateLimit(req, 20, 5 * 60 * 1000)) {
      return void res.status(429).json({ error: "Zu viele Anfragen — kurz warten." });
    }

    const raw = Array.isArray(req.body?.messages) ? req.body.messages : null;
    if (!raw || raw.length === 0) {
      return void res.status(400).json({ error: "messages required" });
    }

    const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = raw
      .slice(-20)
      .filter(
        (m: unknown): m is { role: string; content: string } =>
          !!m &&
          typeof m === "object" &&
          ((m as { role?: unknown }).role === "user" ||
            (m as { role?: unknown }).role === "assistant") &&
          typeof (m as { content?: unknown }).content === "string",
      )
      .map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content.slice(0, 2000),
      }));
    if (convo.length === 0 || convo[convo.length - 1].role !== "user") {
      return void res.status(400).json({ error: "last message must be from user" });
    }

    const systemPrompt = await buildPublicSystemPrompt();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const stream = await openai.chat.completions.create({
      model: PUBLIC_MODEL,
      max_completion_tokens: 400,
      messages: [{ role: "system", content: systemPrompt }, ...convo],
      stream: true,
    });

    let full = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        full += delta;
        res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
      }
    }

    if (full.trim()) {
      const suggestion = await suggestFollowUp(convo, full).catch(() => null);
      if (suggestion) res.write(`data: ${JSON.stringify({ suggestion })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    logger.error({ err }, "Public chat error");
    recordDebugEvent("public/chat", err);
    const detail = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Chat failed", detail });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Stream failed", detail })}\n\n`);
      res.end();
    }
  }
});

// ── PUBLIC TTS (ElevenLabs proxy, Streaming) ───────────────────────────────
// Der Key bleibt auf dem Server; der Browser bekommt nur den Audio-Stream.
// GET-Variante erlaubt `new Audio(url)` → progressives Abspielen während des
// Downloads (erster Ton deutlich früher als beim Blob-Download).
async function streamTts(text: string, res: Response): Promise<void> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return void res.status(503).json({ error: "TTS nicht konfiguriert (ELEVENLABS_API_KEY fehlt)" });
  }
  if (!text.trim()) return void res.status(400).json({ error: "text required" });

  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";
  const upstream = await fetch(
    `${ELEVENLABS_BASE}/text-to-speech/${voiceId}/stream?optimize_streaming_latency=3&output_format=mp3_22050_32`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        // Flash v2.5: ~75ms Modell-Latenz — die schnellste natürliche Stimme
        model_id: process.env.ELEVENLABS_MODEL_ID ?? "eleven_flash_v2_5",
      }),
      signal: AbortSignal.timeout(30000),
    },
  );

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    logger.warn({ status: upstream.status, errText: errText.slice(0, 300) }, "ElevenLabs error");
    return void res.status(502).json({ error: "TTS fehlgeschlagen" });
  }

  res.setHeader("Content-Type", "audio/mpeg");
  const reader = upstream.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

router.post("/public/tts", async (req, res) => {
  try {
    if (!requireWidgetOrigin(req, res)) return;
    if (!rateLimit(req, 40, 5 * 60 * 1000)) {
      return void res.status(429).json({ error: "Zu viele Anfragen — kurz warten." });
    }
    const text = typeof req.body?.text === "string" ? req.body.text.slice(0, 1000) : "";
    await streamTts(text, res);
  } catch (err) {
    logger.error({ err }, "TTS error");
    recordDebugEvent("public/tts", err);
    if (!res.headersSent) res.status(500).json({ error: "TTS failed" });
    else res.end();
  }
});

router.get("/public/tts", async (req, res) => {
  try {
    if (!requireWidgetOrigin(req, res)) return;
    if (!rateLimit(req, 40, 5 * 60 * 1000)) {
      return void res.status(429).json({ error: "Zu viele Anfragen — kurz warten." });
    }
    const text = typeof req.query.text === "string" ? req.query.text.slice(0, 1000) : "";
    await streamTts(text, res);
  } catch (err) {
    logger.error({ err }, "TTS error");
    recordDebugEvent("public/tts", err);
    if (!res.headersSent) res.status(500).json({ error: "TTS failed" });
    else res.end();
  }
});

// ── VOICE-SESSION (ElevenLabs Agents, Legacy) ──────────────────────────────
// widget.js ruft das seit der Umstellung auf OpenAI Realtime (siehe
// /public/realtime-session unten) nicht mehr auf. Bleibt bestehen, falls
// ElevenLabs Agents als Stimme später wieder gebraucht werden.
// Liefert dem Widget eine signed_url für private Agents (Key bleibt hier).
router.get("/public/voice-session", async (req, res) => {
  try {
    if (!requireWidgetOrigin(req, res)) return;
    if (!rateLimit(req, 20, 5 * 60 * 1000)) {
      return void res.status(429).json({ error: "Zu viele Anfragen — kurz warten." });
    }
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agentId =
      (typeof req.query.agent_id === "string" ? req.query.agent_id : undefined) ??
      process.env.ELEVENLABS_AGENT_ID;
    if (!apiKey || !agentId) {
      return void res.status(404).json({ error: "Voice-Session nicht konfiguriert" });
    }
    const upstream = await fetch(
      `${ELEVENLABS_BASE}/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(15000) },
    );
    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      logger.warn({ status: upstream.status, errText: errText.slice(0, 200) }, "Signed-URL fehlgeschlagen");
      return void res.status(502).json({ error: "Voice-Session fehlgeschlagen" });
    }
    const data = (await upstream.json()) as { signed_url?: string };
    res.json({ signedUrl: data.signed_url ?? null, agentId });
  } catch (err) {
    logger.error({ err }, "Voice-Session error");
    recordDebugEvent("public/voice-session", err);
    res.status(500).json({ error: "Voice-Session failed" });
  }
});

// ── REALTIME-SESSION (OpenAI Realtime, öffentliches Widget) ────────────────
// Liefert dem Widget ein kurzlebiges Client-Secret für echtes Speech-to-
// Speech (Millisekunden-Latenz statt ElevenLabs' Cloud-Turnaround). Nur der
// ÖFFENTLICHE System-Prompt (kuratierte public-Memories) wandert in die
// Session-Konfiguration — nie der private Kontext. Das Secret selbst läuft
// nach wenigen Minuten ab; die eigentliche Gesprächsdauer deckelt zusätzlich
// das Widget selbst (siehe widget.js, harte Kappung nach ein paar Minuten),
// da ein einmal verbundenes Realtime-Gespräch sonst beliebig lang und damit
// beliebig teuer laufen könnte.
router.post("/public/realtime-session", async (req, res) => {
  try {
    if (!requireWidgetOrigin(req, res)) return;
    if (!rateLimit(req, 15, 5 * 60 * 1000)) {
      return void res.status(429).json({ error: "Zu viele Anfragen — kurz warten." });
    }
    const basePrompt = await buildPublicSystemPrompt();
    // Sprachspezifischer Zusatz (nur fürs Sprechen, siehe lukas.ts): die
    // Realtime-Stimmen sind primär auf Englisch trainiert und färben
    // deutsche Wörter sonst mit englischer Aussprache/Betonung ein. Ganz
    // oben platziert (nicht nur angehängt), damit das Modell es als
    // wichtigste Verhaltensregel gewichtet.
    const instructions = `SPRACHAUSGABE (WICHTIGSTE REGEL): Du sprichst AUSSCHLIESSLICH mit nativer, akzentfreier
deutscher Aussprache — jedes Wort so, wie ein deutscher Muttersprachler es sagen würde,
auch Namen und Fremdwörter. Keine englische Betonung, keine englische Klangfärbung.

${basePrompt}`;
    const model = sprachModell();
    const clientSecret = await openai.realtime.clientSecrets.create({
      session: {
        type: "realtime",
        model,
        instructions,
        // Stimme, Rauschfilter, Transkription und Sprecherkennung stehen
        // gemeinsam in ai/sprach-sitzung.ts — siehe dort fuer die Begruendungen.
        audio: sprachAudio(),
      },
      expires_after: { anchor: "created_at", seconds: 300 },
    });
    res.json({ value: clientSecret.value, expiresAt: clientSecret.expires_at, model });
  } catch (err) {
    logger.error({ err }, "Public-Realtime-Session error");
    recordDebugEvent("public/realtime-session", err);
    const detail = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Realtime session failed", detail });
  }
});

// ── ANFRAGEN VON DER WEBSITE ───────────────────────────────────────────────
// issahareb.me/anfrage schickt das ausgefuellte Formular hierher, und es
// erscheint im Dashboard unter "Meldungen".
//
// Warum ueberhaupt hierher und nicht per E-Mail: eine Mail hat keinen Zustand.
// Sie ist gelesen oder ungelesen, sie geht im Postfach unter, und ob eine
// Anfrage noch unbeantwortet ist, sieht man ihr nicht an. Eine Meldung ist
// OFFEN, bis Issa geantwortet hat — genau die Eigenschaft, die eine Anfrage
// braucht.
//
// Auth: Bearer ANFRAGE_TOKEN. Kein Origin-Check, denn der Aufrufer ist die
// Server-Route des Portfolios, nicht der Browser des Besuchers — es gibt also
// gar keinen Origin. Der Token liegt auf beiden Seiten als Env-Variable und
// erreicht den Browser nie.
const PROJEKTARTEN = [
  "Komplett neue Website",
  "Bestehende Website überarbeiten",
  "Automatisierung",
  "Sichtbarkeit erhöhen",
] as const;

router.post("/public/anfrage", async (req, res) => {
  try {
    const token = process.env.ANFRAGE_TOKEN?.trim();
    if (!token) {
      recordDebugEvent("public/anfrage", "ANFRAGE_TOKEN fehlt — 503 an Aufrufer");
      return void res.status(503).json({ error: "Anfrage-Eingang nicht konfiguriert (ANFRAGE_TOKEN fehlt)" });
    }
    const header = req.headers.authorization;
    const provided = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
    if (!gleicherToken(provided, token)) {
      recordDebugEvent(
        "public/anfrage",
        `401 Unauthorized — Bearer-Header ${header ? "vorhanden, aber falscher Token" : "fehlt komplett"}`,
      );
      return void res.status(401).json({ error: "Unauthorized" });
    }

    // Grosszuegig: das Portfolio drosselt bereits pro Besucher-IP, und die
    // Anfragen kommen hier alle von derselben Server-Adresse an. Die Grenze
    // faengt nur den Fall ab, dass dort etwas kaputtgeht und im Kreis sendet.
    if (!rateLimit(req, 60, 60 * 60 * 1000)) {
      return void res.status(429).json({ error: "Rate limit" });
    }

    const body = req.body ?? {};
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const name = str(body.name, 120);
    const email = str(body.email, 200);
    const nachricht = str(body.nachricht ?? body.message, 5000);
    const firma = str(body.firma ?? body.company, 160);
    const quelle = str(body.quelle ?? body.source, 200);
    const projektartRoh = str(body.projektart ?? body.projectType, 120);

    if (!name || !email || !nachricht) {
      return void res.status(422).json({ error: "name, email und nachricht sind Pflicht" });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
      return void res.status(422).json({ error: "E-Mail ungültig" });
    }

    // Auf die bekannte Liste zurueckfuehren, statt Freitext zu uebernehmen:
    // der Betreff wird daraus gebaut, und ein fremder String darin macht die
    // Meldungsliste unlesbar.
    const projektart =
      PROJEKTARTEN.find((p) => p.toLowerCase() === projektartRoh.toLowerCase()) ?? "Anfrage ohne Projektart";

    const row = await anfrageVonWebsite({ name, email, projektart, firma, nachricht, quelle });
    res.status(201).json({ ok: true, id: row.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Anfrage konnte nicht gespeichert werden");
    recordDebugEvent("public/anfrage", message);
    res.status(500).json({ error: "Anfrage konnte nicht gespeichert werden" });
  }
});

// ── CUSTOM LLM für ElevenLabs Agents (OpenAI-kompatibel) ───────────────────
// Der ElevenLabs-Agent nutzt diesen Endpoint als Gehirn → er spricht mit
// Lukas' Persona, Stimmung und kuratierten public-Memories.
// Auth: Bearer ELEVENLABS_LLM_TOKEN (in der ElevenLabs-Konsole als API-Key
// des Custom LLM eintragen).
router.post("/public/llm/v1/chat/completions", async (req, res) => {
  try {
    // .trim(): Railways Variablen-Editor haengt beim Speichern manchmal einen
    // Zeilenumbruch an (siehe LUKAS_API_TOKEN-Fix) — hier aus demselben Grund
    // toleriert.
    const token = process.env.ELEVENLABS_LLM_TOKEN?.trim();
    if (!token) {
      recordDebugEvent("public/llm", "ELEVENLABS_LLM_TOKEN fehlt — 503 an Aufrufer");
      return void res.status(503).json({ error: "Custom LLM nicht konfiguriert (ELEVENLABS_LLM_TOKEN fehlt)" });
    }
    const header = req.headers.authorization;
    const provided = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
    if (!gleicherToken(provided, token)) {
      recordDebugEvent(
        "public/llm",
        `401 Unauthorized — Bearer-Header ${header ? "vorhanden, aber falscher Token" : "fehlt komplett"}`,
      );
      return void res.status(401).json({ error: "Unauthorized" });
    }

    if (!rateLimit(req, 60, 5 * 60 * 1000)) {
      return void res.status(429).json({ error: "Rate limit" });
    }

    const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const contentToString = (c: unknown): string => {
      if (typeof c === "string") return c;
      if (Array.isArray(c)) {
        return c
          .map((part) =>
            part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
              ? (part as { text: string }).text
              : "",
          )
          .join(" ");
      }
      return "";
    };

    // Fremde System-Prompts (Agent-Konfiguration) als Zusatzkontext, Rest als Verlauf
    const extraSystem = rawMessages
      .filter((m: { role?: string }) => m?.role === "system")
      .map((m: { content?: unknown }) => contentToString(m.content))
      .join("\n")
      .slice(0, 2000);

    const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = rawMessages
      .filter((m: { role?: string }) => m?.role === "user" || m?.role === "assistant")
      .slice(-20)
      .map((m: { role: string; content?: unknown }) => ({
        role: m.role as "user" | "assistant",
        content: contentToString(m.content).slice(0, 2000) || "...",
      }));
    if (convo.length === 0 || convo[convo.length - 1].role !== "user") {
      convo.push({ role: "user", content: "Hallo" });
    }

    const basePrompt = await buildPublicSystemPrompt();
    const systemPrompt = `${basePrompt}

DU SPRICHST GERADE (Sprach-Konversation über ElevenLabs):
- Antworte SEHR kurz: 1-2 gesprochene Sätze. Keine Listen, kein Markdown, keine Emojis.
- Natürliche gesprochene Sprache, wie am Telefon.
${extraSystem ? `\nZUSATZKONTEXT DES VOICE-AGENTEN:\n${extraSystem}` : ""}`;

    const messagesForModel: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...convo,
    ];

    const id = `chatcmpl-lukas-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const model = "lukas";
    const wantsStream = req.body?.stream !== false;

    if (!wantsStream) {
      const response = await openai.chat.completions.create({
        model: PUBLIC_MODEL,
        max_completion_tokens: 300,
        messages: messagesForModel,
      });
      const text = response.choices[0]?.message?.content ?? "";
      if (!text.trim()) {
        const lastUserMsg = String(convo[convo.length - 1]?.content ?? "").slice(0, 200);
        recordDebugEvent(
          "public/llm",
          `Leere Antwort von OpenAI (model=${PUBLIC_MODEL}, finish_reason=${response.choices[0]?.finish_reason}, ` +
            `nachrichten=${messagesForModel.length}, letzte_user_message="${lastUserMsg}")`,
        );
      }
      return void res.json({
        id,
        object: "chat.completion",
        created,
        model,
        choices: [
          { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
        ],
        usage: {
          prompt_tokens: response.usage?.prompt_tokens ?? 0,
          completion_tokens: response.usage?.completion_tokens ?? 0,
          total_tokens: response.usage?.total_tokens ?? 0,
        },
      });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`,
      );

    chunk({ role: "assistant" });

    const stream = await openai.chat.completions.create({
      model: PUBLIC_MODEL,
      max_completion_tokens: 300,
      messages: messagesForModel,
      stream: true,
    });

    let receivedAnyContent = false;
    let lastFinishReason: string | null | undefined;
    for await (const ev of stream) {
      const delta = ev.choices[0]?.delta?.content;
      if (delta) {
        receivedAnyContent = true;
        chunk({ content: delta });
      }
      if (ev.choices[0]?.finish_reason) lastFinishReason = ev.choices[0].finish_reason;
    }

    if (!receivedAnyContent) {
      const lastUserMsg = String(convo[convo.length - 1]?.content ?? "").slice(0, 200);
      recordDebugEvent(
        "public/llm",
        `Leerer Stream von OpenAI (model=${PUBLIC_MODEL}, finish_reason=${lastFinishReason}, ` +
          `nachrichten=${messagesForModel.length}, letzte_user_message="${lastUserMsg}")`,
      );
    }

    chunk({}, "stop");
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    logger.error({ err }, "Custom LLM error");
    const rawMessage = err instanceof Error ? err.message : String(err);
    const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "(Standard: https://api.openai.com/v1)";
    recordDebugEvent("public/llm", `${rawMessage} (model="${PUBLIC_MODEL}", baseURL="${baseUrl}")`);
    if (!res.headersSent) {
      res.status(500).json({ error: "LLM failed", detail: rawMessage });
    } else {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
});

export default router;
