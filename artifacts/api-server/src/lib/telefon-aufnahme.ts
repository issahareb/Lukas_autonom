import { db, telefonAnrufe } from "@workspace/db";
import { eq } from "drizzle-orm";
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

/** Refresh expired Telnyx links on demand, behind Dashboard authentication. */
export async function ladeTelefonAufnahme(id: number): Promise<Response | null> {
  const [call] = await db.select().from(telefonAnrufe).where(eq(telefonAnrufe.id, id)).limit(1);
  if (!call?.aufnahmeZustimmung || call.aufnahmeStatus !== "completed" || !call.aufnahmeSid || !call.aufnahmeAccountSid) return null;
  const recording = await telnyxAnfrage<{ sid: string; call_sid: string; media_url?: string }>(
    `/texml/Accounts/${encodeURIComponent(call.aufnahmeAccountSid)}/Recordings/${encodeURIComponent(call.aufnahmeSid)}.json`);
  if (recording.sid !== call.aufnahmeSid || (recording.call_sid !== call.providerSid && recording.call_sid !== call.sipSid)) throw new Error("Aufnahme passt nicht zum Anruf");
  const url = new URL(recording.media_url ?? "");
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Ungültige Aufnahmeadresse");
  // No provider credentials on the storage request; checked DNS, no redirects.
  const media = await sicherFetch(url.href, { signal: AbortSignal.timeout(120000), maxWeiterleitungen: 0 });
  if (!media.ok || !media.body) throw new Error("Aufnahme derzeit nicht verfügbar");
  return media;
}
