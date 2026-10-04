import { randomUUID } from "node:crypto";
import { db, telefonAnrufe, messages, conversations, type TelefonAnruf } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const terminal = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);
const rank: Record<string, number> = { "": 0, queued: 1, initiated: 1, ringing: 2, "in-progress": 3 };
const failure = new Set(["busy", "no-answer", "failed", "canceled"]);
export function naechsterStatus(alt: string, neu: string): string {
  if (terminal.has(alt)) return alt;
  if (terminal.has(neu) || (rank[neu] ?? -1) > (rank[alt] ?? 0)) return neu;
  return alt;
}
export function anrufErgebnis(r: Pick<TelefonAnruf, "zielStatus" | "sipStatus" | "liveBereit">): string {
  if (r.zielStatus === "busy") return "besetzt";
  if (r.zielStatus === "no-answer") return "keine_antwort";
  if (r.zielStatus === "failed") return "fehlgeschlagen";
  if (r.zielStatus === "canceled") return "abgebrochen";
  if (failure.has(r.sipStatus)) return "verbindungsfehler";
  if (r.zielStatus === "completed" || r.sipStatus === "completed") return "beendet";
  if (r.liveBereit && r.sipStatus === "in-progress" && r.zielStatus === "in-progress") return "verbunden";
  if (r.zielStatus === "in-progress") return "angenommen";
  if (r.zielStatus === "ringing") return "klingelt";
  return "gewaehlt";
}
export const ANRUF_LABEL: Record<string, string> = {
  gewaehlt: "Anruf gestartet; Annahme noch nicht bestätigt", klingelt: "Es klingelt",
  angenommen: "Ziel hat den Anruf angenommen; Verbindung zu LUKAS noch nicht bestätigt",
  verbunden: "Anruf angenommen und mit LUKAS verbunden", beendet: "Anruf beendet",
  besetzt: "Ziel ist besetzt", keine_antwort: "Keine Antwort", fehlgeschlagen: "Anruf fehlgeschlagen",
  abgebrochen: "Anruf abgebrochen", verbindungsfehler: "Verbindung zu LUKAS fehlgeschlagen",
};

export async function neuerVerfolgterAnruf(nummer: string, anlass: string, conversationId?: number,
  aufnahme?: Pick<TelefonAnruf, "aufnahmeZustimmung" | "aufnahmeQuelle" | "aufnahmeBestaetigtAm">,
  mithoeren?: Pick<TelefonAnruf, "mithoerenZustimmung" | "mithoerenQuelle" | "mithoerenBestaetigtAm">): Promise<string> {
  const kontextId = randomUUID();
  await db.insert(telefonAnrufe).values({ kontextId, nummer, anlass, richtung: "ausgehend",
    ergebnis: "gewaehlt", zielStatus: "queued", conversationId: conversationId && conversationId > 0 ? conversationId : null,
    ...aufnahme, ...mithoeren, aufnahmeStatus: aufnahme?.aufnahmeZustimmung ? "angefordert" : "aus" });
  return kontextId;
}

/** The row lock also serializes duplicate/out-of-order callbacks across replicas. */
export async function aktualisiereAnruf(kontextId: string, patch: Partial<Pick<TelefonAnruf,
  "providerSid" | "sipSid" | "zielStatus" | "sipStatus" | "liveBereit" | "dauer" | "detail" | "stufe">>): Promise<void> {
  await db.transaction(async tx => {
    const [alt] = await tx.select().from(telefonAnrufe).where(eq(telefonAnrufe.kontextId, kontextId)).for("update");
    if (!alt) return; // Old calls and incoming sessions have no tracked row.
    const neu = { ...alt, ...patch,
      zielStatus: naechsterStatus(alt.zielStatus, patch.zielStatus ?? ""),
      sipStatus: naechsterStatus(alt.sipStatus, patch.sipStatus ?? ""),
      liveBereit: alt.liveBereit || patch.liveBereit === true,
    };
    neu.ergebnis = anrufErgebnis(neu);
    await tx.update(telefonAnrufe).set({ ...patch, zielStatus: neu.zielStatus, sipStatus: neu.sipStatus,
      liveBereit: neu.liveBereit, ergebnis: neu.ergebnis, updatedAt: new Date() }).where(eq(telefonAnrufe.id, alt.id));
    if (alt.ergebnis !== neu.ergebnis && neu.ergebnis !== "klingelt" && alt.conversationId) {
      // Conversation may have been deleted while the call was running.
      const [chat] = await tx.select({ id: conversations.id }).from(conversations)
        .where(eq(conversations.id, alt.conversationId)).for("key share");
      if (chat) await tx.insert(messages).values({ conversationId: chat.id, role: "assistant",
        content: `Anruf an +${alt.nummer}: ${ANRUF_LABEL[neu.ergebnis] ?? neu.ergebnis}.${neu.dauer != null ? ` Dauer: ${neu.dauer} Sekunden.` : ""}${neu.ergebnis === "angenommen" ? " Das kann auch eine Mailbox oder Ansage sein." : ""}` });
    }
  });
}

export async function telefonStatus(): Promise<string> {
  const rows = await db.select().from(telefonAnrufe).orderBy(desc(telefonAnrufe.createdAt)).limit(10);
  return JSON.stringify({ anbieter: process.env.LUKAS_TELEFON_ANBIETER ?? "twilio",
    hinweis: "Anrufstart, Zielannahme und SIP-Verbindung sind getrennte Bestätigungen. Annahme beweist keinen menschlichen Gesprächspartner. Fehlende Meldungen bedeuten unbekannt; ein beendeter Anruf beweist keine Auftragserledigung. Alte Einträge ohne kontextId haben keine vollständige Statusverfolgung.",
    anrufe: rows.map(r => ({ id: r.kontextId ?? r.id, anruf_id: r.id, nummer: "+" + r.nummer, anlass: r.anlass,
      status: ANRUF_LABEL[r.ergebnis] ?? r.ergebnis, zielStatus: r.zielStatus, sipStatus: r.sipStatus,
      liveBereit: r.liveBereit, dauer: r.dauer, detail: r.detail, aufnahmeStatus: r.aufnahmeStatus, zuletzt: r.updatedAt })) });
}

/** Only called after verifying the Telnyx signature on the exact body bytes. */
export async function telnyxStatusEingang(body: Record<string, unknown>, kontextId?: string): Promise<boolean> {
  const sid = typeof body.CallSid === "string" ? body.CallSid : "";
  if (!sid || sid.length > 512) throw new Error("CallSid fehlt");
  if (body.ConnectionId && body.ConnectionId !== process.env.TELNYX_APP_ID) throw new Error("Falsche Anwendung");
  const [r] = await db.select().from(telefonAnrufe).where(kontextId
    ? eq(telefonAnrufe.kontextId, kontextId) : eq(telefonAnrufe.providerSid, sid)).limit(1);
  if (!r || !r.kontextId) {
    if (body.To === process.env.TELNYX_NUMMER) return false; // Incoming, untracked call.
    throw new Error("Anruf noch nicht zugeordnet"); // Retry if callback beat the dial response.
  }
  if (kontextId) {
    if (!r.providerSid || body.ParentCallSid !== r.providerSid || (r.sipSid && r.sipSid !== sid)) throw new Error("Falsches SIP-Bein");
  } else if (body.From !== process.env.TELNYX_NUMMER || body.To !== "+" + r.nummer) throw new Error("Falsches Ziel");
  const raw = typeof body.CallStatus === "string" ? body.CallStatus : "";
  const status = raw === "answered" ? "in-progress" : raw;
  if (!(status in rank) && !terminal.has(status)) return false;
  const n = Number(body.CallDuration);
  const dauer = body.CallDuration != null && Number.isInteger(n) && n >= 0 && n <= 86400 ? n : undefined;
  await aktualisiereAnruf(r.kontextId, kontextId ? { sipSid: sid, sipStatus: status }
    : { zielStatus: status, ...(dauer == null ? {} : { dauer }) });
  return true;
}
