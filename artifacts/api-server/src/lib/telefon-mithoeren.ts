import type { Server } from "node:http";
import type { Request, Response } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { db, telefonAnrufe, telefonNummern, type TelefonAnruf } from "@workspace/db";
import { eq } from "drizzle-orm";
import { pruefeMithoerTicket } from "./telnyx";

const beendet = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);
type Format = { type: "format"; codec: "PCMU" | "PCMA"; streamId: string };
type Audio = { type: "audio"; streamId: string; track: "inbound" | "outbound"; timestamp: number; chunk: number; payload: string };
type Event = Format | Audio | { type: "waiting" } | { type: "end"; message: string };
type Kanal = { id: number; context: string; provider?: WebSocket; format?: Format; listeners: Set<(event: Event) => void>; lastAudio: number };
// The deployed API has one replica. Audio stays in memory, never in database or logs.
// Horizontal scaling requires a transient broker/shared stream routing first.
const kanaele = new Map<string, Kanal>();
const MAX_KANAELE = 32;
let stopping = false;

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
    k = { id: call.id, context: call.kontextId!, listeners: new Set(), lastAudio: 0 };
    kanaele.set(k.context, k);
  }
  return k;
}
function senden(k: Kanal, event: Event) { for (const fn of [...k.listeners]) fn(event); }
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
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const listener = (event: Event) => {
      if (res.destroyed) return;
      if (res.writableLength > 65536) { res.destroy(); return; }
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === "end") res.end();
    };
    k.listeners.add(listener);
    res.on("close", () => { k.listeners.delete(listener); if (!k.provider && k.listeners.size === 0) kanaele.delete(k.context); });
    listener(k.format ?? { type: "waiting" });
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
export function streamAudio(message: Record<string, any>, format: Format): Audio | null {
  const m = message.media;
  const track = m?.track;
  const timestamp = Number(m?.timestamp), chunk = Number(m?.chunk);
  if ((message.stream_id ?? message.streamSid) !== format.streamId || !["inbound", "outbound"].includes(track) ||
    !Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 43200000 || !Number.isSafeInteger(chunk) || chunk < 0 ||
    typeof m?.payload !== "string" || !/^[A-Za-z0-9+/]{4,2732}={0,2}$/.test(m.payload) || m.payload.length % 4 !== 0) return null;
  return { type: "audio", streamId: format.streamId, track, timestamp, chunk, payload: m.payload };
}

/** The provider socket is ingestion-only and uses a signed, call-bound capability. */
export function starteTelefonMithoeren(server: Server): () => void {
  stopping = false;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
  let pending = 0, checking = false;
  const upgrade: Parameters<Server["on"]>[1] = async (req: any, socket: any, head: any) => {
    let context: string | null = null;
    try {
      const url = new URL(req.url, "https://localhost");
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
        let format: Format | null = null, starting = false, windowStart = Date.now(), bytes = 0;
        const startDeadline = setTimeout(() => ws.close(1008, "start required"), 7000);
        const finish = () => {
          clearTimeout(startDeadline);
          if (k.provider === ws) {
            k.provider = undefined; k.format = undefined;
            senden(k, { type: "waiting" });
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
            if (!candidate) { beenden(k, "Das Audioformat dieses Anrufs wird nicht unterstützt."); ws.close(1003, "unsupported codec"); return; }
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
                  senden(k, candidate);
                  return;
                }
                if (current.providerSid) break;
                await new Promise(resolve => setTimeout(resolve, 500));
              }
              ws.close(1008, "call mismatch");
            })().catch(() => ws.close(1011, "unavailable"));
            return;
          }
          if (!format || k.provider !== ws) return; // Drop early frames; never queue unverified audio.
          if (msg.event === "stop") { beenden(k, "Mithören beendet."); return; }
          if (msg.event === "media") {
            const frame = streamAudio(msg, format);
            if (!frame) { ws.close(1008, "invalid media"); return; }
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
        else if (Date.now() - k.lastAudio > 5000) senden(k, { type: "waiting" });
      } catch { beenden(k, "Verbindung zum Mithören unterbrochen. Bitte erneut verbinden."); }
    })).finally(() => { checking = false; });
  }, 1000);
  timer.unref();
  return () => {
    stopping = true; clearInterval(timer); server.off("upgrade", upgrade);
    for (const k of kanaele.values()) beenden(k, "Server wird neu gestartet. Bitte erneut verbinden.");
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  };
}
