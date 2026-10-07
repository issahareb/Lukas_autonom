import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { Request, Response } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { db, telefonAnrufe, telefonNummern, type TelefonAnruf } from "@workspace/db";
import { eq } from "drizzle-orm";
import { pruefeMithoerTicket } from "./telnyx";
import { logger } from "./logger";

const beendet = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);
type Format = { type: "format"; codec: "PCMU" | "PCMA"; streamId: string };
type Audio = { type: "audio"; streamId: string; track: "inbound" | "outbound"; timestamp: number; chunk: number; payload: string };
type Event = Format | Audio | { type: "waiting"; message?: string } | { type: "end"; message: string };
type Kanal = { id: number; context: string; provider?: WebSocket; format?: Format; listeners: Set<(event: Event) => void>; lastAudio: number; openedAt: number; frames: { inbound: number; outbound: number } };
// The deployed API has one replica. Audio stays in memory, never in database or logs.
// Horizontal scaling requires a transient broker/shared stream routing first.
const kanaele = new Map<string, Kanal>();
const MAX_KANAELE = 32;
let stopping = false;

const browserTickets = new Map<string, { id: number; expires: number }>();
/** One-use capability issued only behind owner bearer authentication. */
export async function mithoerenTicketAntwort(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Ungültige Anruf-ID." }); return; }
  try {
    if (stopping || !await erlaubterMithoerAnruf(id)) { res.status(409).json({ error: "Kein laufender Anruf mit gültiger Zustimmung zum Mithören." }); return; }
    for (const [key, value] of browserTickets) if (value.expires < Date.now()) browserTickets.delete(key);
    if (browserTickets.size >= 128) { res.status(429).json({ error: "Bitte kurz warten." }); return; }
    const ticket = randomBytes(32).toString("hex");
    browserTickets.set(ticket, { id, expires: Date.now() + 30000 });
    res.set("Cache-Control", "no-store").json({ ticket });
  } catch { res.status(503).json({ error: "Mithören ist gerade nicht verfügbar." }); }
}

export async function erlaubterMithoerAnruf(id: number | string): Promise<TelefonAnruf | null> {
  const [call] = await db.select().from(telefonAnrufe).where(typeof id === "number"
    ? eq(telefonAnrufe.id, id) : eq(telefonAnrufe.kontextId, id)).limit(1);
  if (!call?.kontextId || call.richtung !== "ausgehend" || !call.mithoerenZustimmung || !call.mithoerenBestaetigtAm ||
    beendet.has(call.zielStatus) || beendet.has(call.sipStatus)) return null;
  const contacts = await db.select().from(telefonNummern).where(eq(telefonNummern.nummer, call.nummer)).limit(2);
  const contact = contacts[0];
  if (contacts.length !== 1 || !contact.mithoerenZustimmung || contact.stufe === "gesperrt" ||
    contact.mithoerenBestaetigtAm?.getTime() !== call.mithoerenBestaetigtAm.getTime()) return null;
  return call;
}
function kanal(call: TelefonAnruf): Kanal {
  let k = kanaele.get(call.kontextId!);
  if (!k) {
    if (kanaele.size >= MAX_KANAELE) throw new Error("capacity");
    k = { id: call.id, context: call.kontextId!, listeners: new Set(), lastAudio: 0, openedAt: Date.now(), frames: { inbound: 0, outbound: 0 } };
    kanaele.set(k.context, k);
  }
  return k;
}
function senden(k: Kanal, event: Event) { for (const fn of [...k.listeners]) fn(event); }
function warten(k: Kanal): Event {
  return { type: "waiting", message: k.lastAudio ? "Gesprächsaudio unterbrochen. Warte auf neue Audiodaten …" :
    Date.now() - k.openedAt > 10000 ? "Noch kein Gesprächsaudio vom Anbieter empfangen. Der Anruf läuft weiter." :
    k.provider ? "Audiostream verbunden. Warte auf Gesprächsaudio …" : "Verbinde mit dem Audiostream …" };
}
function beenden(k: Kanal, message: string) {
  kanaele.delete(k.context);
  senden(k, { type: "end", message });
  k.listeners.clear();
  k.provider?.close(1000, "monitor stopped");
}

/** Dashboard-authenticated HTTP stream. Never accepts or forwards microphone audio. */
export async function mithoerenAntwort(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Ungültige Anruf-ID." }); return; }
  try {
    const call = await erlaubterMithoerAnruf(id);
    if (!call || stopping) { res.status(409).json({ error: "Mithören ist nur bei laufenden Anrufen mit zuvor hinterlegter schriftlicher Zustimmung möglich." }); return; }
    if (res.destroyed) return;
    const k = kanal(call);
    if (k.listeners.size >= 3) { res.status(429).json({ error: "Für diesen Anruf hören bereits drei Geräte mit." }); return; }
    let framesForwarded = 0;
    logger.info({ callId: k.id, phase: "listener_connected", providerConnected: Boolean(k.provider), frames: { ...k.frames } }, "Telefon-Live-Audioweg");
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const listener = (event: Event) => {
      if (res.destroyed) return;
      if (res.writableLength > 65536) { res.destroy(); return; }
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === "audio") framesForwarded++;
      if (event.type === "end") res.end();
    };
    k.listeners.add(listener);
    res.on("close", () => {
      logger.info({ callId: k.id, phase: "listener_closed", framesForwarded }, "Telefon-Live-Audioweg");
      k.listeners.delete(listener); if (!k.provider && k.listeners.size === 0) kanaele.delete(k.context);
    });
    listener(k.format ?? warten(k));
  } catch {
    if (!res.headersSent) res.status(503).json({ error: "Mithören ist gerade nicht verfügbar. Bitte erneut versuchen." });
    else res.end();
  }
}

export function streamFormat(message: Record<string, any>): Format | null {
  const start = message.start;
  const format = start?.media_format ?? start?.mediaFormat;
  const codec = format?.encoding === "audio/x-mulaw" ? "PCMU" : format?.encoding === "audio/x-alaw" ? "PCMA" : format?.encoding;
  const streamId = message.stream_id ?? message.streamSid ?? start?.streamSid;
  if (!["PCMU", "PCMA"].includes(codec) || Number(format?.sample_rate ?? format?.sampleRate) !== 8000 ||
    Number(format?.channels) !== 1 || typeof streamId !== "string" || streamId.length > 128 || !streamId) return null;
  return { type: "format", codec, streamId };
}
export type MediaRejectReason = "stream_id" | "track" | "timestamp" | "chunk" | "payload_envelope" | "payload_size" | "payload_base64";
export function streamAudio(message: Record<string, any>, format: Format, onReject?: (reason: MediaRejectReason) => void): Audio | null {
  const reject = (reason: MediaRejectReason): null => { onReject?.(reason); return null; };
  const m = message.media;
  // Telnyx documents chunk/timestamp as numeric strings and explicitly says
  // media events may arrive out of order. Validate the envelope, not packet order/size.
  const rawTrack = m?.track;
  const track = rawTrack === "inbound_track" ? "inbound" : rawTrack === "outbound_track" ? "outbound" : rawTrack;
  const timestamp = Number(m?.timestamp), chunk = Number(m?.chunk);
  const payload = m?.payload;
  if ((message.stream_id ?? message.streamSid) !== format.streamId) return reject("stream_id");
  if (!["inbound", "outbound"].includes(track)) return reject("track");
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 43200000) return reject("timestamp");
  if (!Number.isSafeInteger(chunk) || chunk < 0) return reject("chunk");
  if (typeof payload !== "string" || payload.length < 4 || payload.length > 12288 || payload.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return reject("payload_envelope");
  // Reject malformed base64 without assuming a fixed Telnyx packet duration.
  const decoded = Buffer.from(payload, "base64");
  if (!decoded.length || decoded.length > 8192) return reject("payload_size");
  if (decoded.toString("base64") !== payload) return reject("payload_base64");
  return { type: "audio", streamId: format.streamId, track, timestamp, chunk, payload };
}

/** The provider socket is ingestion-only and uses a signed, call-bound capability. */
export function starteTelefonMithoeren(server: Server): () => void {
  stopping = false;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
  const browsers = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  let pending = 0, checking = false;
  const upgrade: Parameters<Server["on"]>[1] = async (req: any, socket: any, head: any) => {
    let context: string | null = null;
    try {
      const url = new URL(req.url, "https://localhost");
      if (url.pathname === "/api/telefon/live-player") {
        const ticket = url.searchParams.get("ticket") ?? "";
        const grant = browserTickets.get(ticket); browserTickets.delete(ticket);
        if (!grant || grant.expires < Date.now() || stopping || browsers.clients.size >= 24 || pending >= 8) { socket.destroy(); return; }
        pending++;
        try {
          const call = await erlaubterMithoerAnruf(grant.id);
          if (!call || socket.destroyed || stopping) { socket.destroy(); return; }
          const k = kanal(call);
          if (k.listeners.size >= 3) { socket.destroy(); return; }
          browsers.handleUpgrade(req, socket, head, ws => {
            let frames = 0;
            const listener = (event: Event) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              if (ws.bufferedAmount > 65536) { ws.close(1008, "slow listener"); return; }
              ws.send(JSON.stringify(event));
              if (event.type === "audio") frames++;
              if (event.type === "end") ws.close(1000);
            };
            k.listeners.add(listener);
            ws.on("error", () => ws.terminate());
            ws.on("message", () => ws.close(1008, "receive only"));
            ws.on("close", () => {
              k.listeners.delete(listener);
              if (!k.provider && !k.listeners.size) kanaele.delete(k.context);
              logger.info({ callId: k.id, phase: "browser_closed", framesForwarded: frames }, "Telefon-Live-Audioweg");
            });
            listener(k.format ?? warten(k));
          });
        } finally { pending--; }
        return;
      }
      if (url.pathname !== "/api/telefon/telnyx/live") { socket.destroy(); return; }
      context = pruefeMithoerTicket(url.searchParams.get("ticket") ?? "");
    } catch { /* Fail closed; never log the URL/capability. */ }
    if (!context || stopping || pending >= 8 || wss.clients.size >= MAX_KANAELE) { socket.destroy(); return; }
    pending++;
    const deadline = setTimeout(() => socket.destroy(), 10000);
    try {
      const call = await erlaubterMithoerAnruf(context);
      if (!call || socket.destroyed || stopping) { socket.destroy(); return; }
      const k = kanal(call);
      wss.handleUpgrade(req, socket, head, ws => {
        logger.info({ callId: k.id, phase: "provider_connected" }, "Telefon-Live-Audioweg");
        let format: Format | null = null, starting = false, windowStart = Date.now(), bytes = 0;
        // Count fixed reasons only. Provider values and audio must never reach logs.
        const rejectedFrames: Partial<Record<MediaRejectReason, number>> = {};
        const rejected = (reason: MediaRejectReason) => {
          const count = (rejectedFrames[reason] ?? 0) + 1;
          rejectedFrames[reason] = count;
          if (count === 1) logger.warn({ callId: k.id, phase: "invalid_media_dropped", reason }, "Telefon-Live-Audioweg");
        };
        const startDeadline = setTimeout(() => ws.close(1008, "start required"), 7000);
        const finish = (code: number) => {
          logger.info({ callId: k.id, phase: "provider_closed", code, formatAccepted: Boolean(format), frames: { ...k.frames }, rejectedFrames: { ...rejectedFrames } }, "Telefon-Live-Audioweg");
          clearTimeout(startDeadline);
          if (k.provider === ws) {
            k.provider = undefined; k.format = undefined;
            senden(k, warten(k));
          }
          if (!k.provider && k.listeners.size === 0 && kanaele.get(k.context) === k) {
            kanaele.delete(k.context);
          }
        };
        ws.on("close", finish);
        ws.on("error", () => ws.terminate());
        ws.on("message", (data, binary) => {
          if (binary || stopping) { ws.close(1008, "invalid event"); return; }
          if (Date.now() - windowStart > 1000) { windowStart = Date.now(); bytes = 0; }
          bytes += data.toString().length;
          if (bytes > 80000) { ws.close(1008, "rate exceeded"); return; }
          let msg: Record<string, any>;
          try { msg = JSON.parse(data.toString()); if (!msg || typeof msg !== "object") throw new Error(); }
          catch { ws.close(1008, "invalid event"); return; }
          if (msg.event === "connected") return;
          if (msg.event === "start" && !format && !starting) {
            starting = true;
            const candidate = streamFormat(msg);
            if (!candidate) { logger.warn({ callId: k.id, phase: "unsupported_format" }, "Telefon-Live-Audioweg"); beenden(k, "Das Audioformat dieses Anrufs wird nicht unterstützt."); ws.close(1003, "unsupported codec"); return; }
            const callSid = msg.start?.call_control_id ?? msg.start?.callSid;
            void (async () => {
              // The provider can answer before the dial response has reached our DB.
              for (let attempt = 0; attempt < 5 && ws.readyState === WebSocket.OPEN; attempt++) {
                const current = await erlaubterMithoerAnruf(k.context);
                if (!current) break;
                if (current.providerSid && current.providerSid === callSid) {
                  clearTimeout(startDeadline);
                  const previous = k.provider;
                  k.provider = ws; format = candidate; k.format = candidate;
                  previous?.close(1000, "stream replaced");
                  logger.info({ callId: k.id, phase: "format_accepted", codec: candidate.codec }, "Telefon-Live-Audioweg");
                  senden(k, candidate);
                  return;
                }
                if (current.providerSid) break;
                await new Promise(resolve => setTimeout(resolve, 500));
              }
              logger.warn({ callId: k.id, phase: "call_mismatch" }, "Telefon-Live-Audioweg");
              ws.close(1008, "call mismatch");
            })().catch(() => ws.close(1011, "unavailable"));
            return;
          }
          if (!format || k.provider !== ws) return; // Drop early frames; never queue unverified audio.
          if (msg.event === "stop") { beenden(k, "Mithören beendet."); return; }
          if (msg.event === "media") {
            const frame = streamAudio(msg, format, rejected);
            // Keep monitoring after a malformed frame; log once per fixed reason.
            if (!frame) return;
            if (k.frames[frame.track]++ === 0) logger.info({ callId: k.id, phase: "first_audio", track: frame.track }, "Telefon-Live-Audioweg");
            k.lastAudio = Date.now(); senden(k, frame);
          }
        });
      });
    } catch { socket.destroy(); }
    finally { clearTimeout(deadline); pending--; }
  };
  server.on("upgrade", upgrade);
  // Consent revocations, deleted contacts and call completion close monitors, never calls.
  const timer = setInterval(() => {
    if (checking || stopping) return;
    checking = true;
    void Promise.all([...kanaele.values()].map(async k => {
      try {
        if (!await erlaubterMithoerAnruf(k.id)) beenden(k, "Anruf beendet oder Zustimmung zum Mithören nicht mehr gültig.");
        else if (Date.now() - k.lastAudio > 5000) senden(k, warten(k));
      } catch { beenden(k, "Verbindung zum Mithören unterbrochen. Bitte erneut verbinden."); }
    })).finally(() => { checking = false; });
  }, 1000);
  timer.unref();
  return () => {
    stopping = true; browserTickets.clear(); clearInterval(timer); server.off("upgrade", upgrade);
    for (const k of kanaele.values()) beenden(k, "Server wird neu gestartet. Bitte erneut verbinden.");
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    for (const ws of browsers.clients) ws.terminate();
    browsers.close();
  };
}
