import { db, telefonAnrufe } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { telnyxAnfrage } from "./telnyx";
import { sicherFetch } from "./netzschutz";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Called only after signature verification; never accept a callback media URL. */
export async function telnyxAufnahmeEingang(body: Record<string, unknown>, id: string): Promise<void> {
  if (body.ConnectionId && body.ConnectionId !== process.env.TELNYX_APP_ID) throw new Error("Falsche Anwendung");
  const status = body.RecordingStatus;
  if (status !== "in-progress" && status !== "completed" && status !== "absent") throw new Error("Unbekannter Aufnahmestatus");
  const sid = typeof body.RecordingSid === "string" ? body.RecordingSid : "";
  const account = typeof body.AccountSid === "string" ? body.AccountSid : "";
  if (!uuid.test(sid) || !uuid.test(account)) throw new Error("Aufnahme-ID fehlt");
  await db.transaction(async tx => {
    const [call] = await tx.select().from(telefonAnrufe).where(eq(telefonAnrufe.kontextId, id)).for("update");
    if (!call?.aufnahmeZustimmung || !call.providerSid) throw new Error("Aufnahme nicht zugeordnet");
    if (body.CallSid !== call.providerSid && (!call.sipSid || body.CallSid !== call.sipSid)) throw new Error("Falscher Anruf");
    if (call.aufnahmeSid && (call.aufnahmeSid !== sid || call.aufnahmeAccountSid !== account)) throw new Error("Falsche Aufnahme");
    // A delayed start/absent event must not replace a completed recording.
    if (call.aufnahmeStatus === "completed" || (call.aufnahmeStatus === "absent" && status === "in-progress")) return;
    const duration = body.RecordingDuration == null ? NaN : Number(body.RecordingDuration);
    await tx.update(telefonAnrufe).set({ aufnahmeSid: sid, aufnahmeAccountSid: account, aufnahmeStatus: status,
      ...(Number.isInteger(duration) && duration >= 0 && duration <= 86400 ? { aufnahmeDauer: duration } : {}),
      updatedAt: new Date(),
    }).where(eq(telefonAnrufe.id, call.id));
  });
}

export class TelefonAufnahmeFehler extends Error {
  constructor(public readonly code: string, public readonly httpStatus?: number) {
    super(code);
  }
}

/** Follow storage redirects without ever forwarding the Telnyx API key. */
async function ladeMedium(rohUrl: string, probe: boolean): Promise<Response> {
  let url: URL;
  try { url = new URL(rohUrl); } catch { throw new TelefonAufnahmeFehler("media_url_missing"); }
  for (let hop = 0; hop <= 3; hop++) {
    if (url.protocol !== "https:" || url.username || url.password) throw new TelefonAufnahmeFehler("media_url_invalid");
    const headers: Record<string, string> = {};
    if (probe) headers.Range = "bytes=0-0";
    // TeXML media_url may point at Telnyx's authenticated media endpoint.
    // Rebuild headers for every hop: signed storage URLs never receive this key.
    if (url.origin === "https://api.telnyx.com") headers.Authorization = `Bearer ${process.env.TELNYX_API_KEY?.trim() ?? ""}`;
    let media: Response;
    try {
      media = await sicherFetch(url.href, { headers, redirect: "manual", signal: AbortSignal.timeout(120000), maxWeiterleitungen: 0 });
    } catch { throw new TelefonAufnahmeFehler("media_network_error"); }
    if ([301, 302, 303, 307, 308].includes(media.status)) {
      const location = media.headers.get("location");
      await media.body?.cancel();
      if (!location || hop === 3) throw new TelefonAufnahmeFehler("media_redirect_invalid", media.status);
      try { url = new URL(location, url); } catch { throw new TelefonAufnahmeFehler("media_url_invalid"); }
      continue;
    }
    if (!media.ok || !media.body) {
      await media.body?.cancel();
      throw new TelefonAufnahmeFehler("media_http_error", media.status);
    }
    const type = media.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (type && !type.startsWith("audio/") && type !== "application/octet-stream" && type !== "binary/octet-stream") {
      await media.body.cancel();
      throw new TelefonAufnahmeFehler("media_content_invalid", media.status);
    }
    return media;
  }
  throw new TelefonAufnahmeFehler("media_redirect_invalid");
}

/** Refresh expired Telnyx links on demand, behind Dashboard authentication. No writes/deletes. */
export async function ladeTelefonAufnahme(id: number, probe = false): Promise<Response | null> {
  const [call] = await db.select().from(telefonAnrufe).where(eq(telefonAnrufe.id, id)).limit(1);
  if (!call?.aufnahmeZustimmung || call.aufnahmeStatus !== "completed" || !call.aufnahmeSid || !call.aufnahmeAccountSid) return null;
  let recording: { sid: string; call_sid: string; media_url?: string };
  try {
    recording = await telnyxAnfrage(`/texml/Accounts/${encodeURIComponent(call.aufnahmeAccountSid)}/Recordings/${encodeURIComponent(call.aufnahmeSid)}.json`);
  } catch { throw new TelefonAufnahmeFehler("metadata_request_failed"); }
  if (recording.sid !== call.aufnahmeSid || (recording.call_sid !== call.providerSid && recording.call_sid !== call.sipSid)) throw new TelefonAufnahmeFehler("recording_mismatch");
  return ladeMedium(recording.media_url ?? "", probe);
}

/** Opt-in startup diagnosis: only response headers, cancel audio immediately; no URLs or content in logs. */
export async function pruefeLetzteTelefonAufnahme() {
  try {
    const [call] = await db.select({ id: telefonAnrufe.id }).from(telefonAnrufe)
      .where(and(eq(telefonAnrufe.aufnahmeZustimmung, true), eq(telefonAnrufe.aufnahmeStatus, "completed")))
      .orderBy(desc(telefonAnrufe.createdAt)).limit(1);
    if (!call) return { status: "no_recording" };
    const media = await ladeTelefonAufnahme(call.id, true);
    if (!media) return { status: "not_available" };
    await media.body?.cancel();
    return { status: "available", httpStatus: media.status };
  } catch (err) {
    return err instanceof TelefonAufnahmeFehler ? { status: err.code, httpStatus: err.httpStatus } : { status: "check_failed" };
  }
}
