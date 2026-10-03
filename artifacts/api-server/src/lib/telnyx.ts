import { createHmac, createPublicKey, randomUUID, timingSafeEqual, verify } from "node:crypto";

const API = "https://api.telnyx.com/v2";
const E164 = /^\+[1-9]\d{5,14}$/;
export const istTelnyx = () => (process.env.LUKAS_TELEFON_ANBIETER ?? "twilio") === "telnyx";
export const telnyxBereit = () => Boolean(process.env.TELNYX_API_KEY && process.env.TELNYX_NUMMER &&
  process.env.TELNYX_APP_ID && process.env.TELNYX_PUBLIC_KEY && process.env.OPENAI_PROJECT_ID &&
  process.env.OPENAI_WEBHOOK_SECRET);

function telnyxOperation(pfad: string): string {
  if (/^\/phone_numbers(?:[/?]|$)/.test(pfad)) return "Nummernstatus";
  if (/^\/texml\/calls\//.test(pfad)) return "Anrufaufbau";
  if (/^\/texml_applications(?:[/?]|$)/.test(pfad)) return "TeXML-Konfiguration";
  if (/^\/outbound_voice_profiles(?:[/?]|$)/.test(pfad)) return "Sprachprofil";
  return "API-Anfrage";
}

export async function telnyxAnfrage<T>(pfad: string, body?: unknown): Promise<T> {
  const key = process.env.TELNYX_API_KEY?.trim();
  if (!key) throw new Error("TELNYX_API_KEY fehlt.");
  const res = await fetch(`${API}${pfad}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const rawCode = (data as { errors?: Array<{ code?: unknown }> } | null)?.errors?.[0]?.code;
    // Never reflect raw provider descriptions, request paths, credentials or URLs.
    const code = typeof rawCode === "string" && /^\d{5}$/.test(rawCode) ? rawCode :
      typeof rawCode === "number" && Number.isInteger(rawCode) && rawCode >= 10000 && rawCode <= 99999
        ? String(rawCode) : "unbekannt";
    const hinweis = code === "10010"
      ? " Telnyx verweigert die Berechtigung für diese Aktion. API-Zugriffsrechte und die Freigabe der betroffenen Voice-Anwendung prüfen."
      : "";
    throw new Error(`Telnyx ${res.status} bei „${telnyxOperation(pfad)}“ (Code ${code}).${hinweis}`);
  }
  return data as T;
}

/** Ed25519 over timestamp|exact request bytes, including form-encoded TeXML. */
export function telnyxSignatur(body: Buffer | undefined, timestamp: string, signature: string): boolean {
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim();
  if (!body || !publicKey || !/^\d+$/.test(timestamp) || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  try {
    const raw = Buffer.from(publicKey, "base64");
    const sig = Buffer.from(signature, "base64");
    if (raw.length !== 32 || sig.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]), format: "der", type: "spki" });
    return verify(null, Buffer.concat([Buffer.from(`${timestamp}|`), body]), key, sig);
  } catch { return false; }
}

export type TelefonKontext = { nummer: string; richtung: "eingehend" | "ausgehend"; anlass: string; exp: number; id: string };

/** Signed call context survives a restart and does not trust a SIP caller ID. */
export function telefonKontext(nummer: string, richtung: TelefonKontext["richtung"], anlass = ""): string {
  const key = process.env.TELNYX_API_KEY;
  if (!key) throw new Error("TELNYX_API_KEY fehlt.");
  if (nummer && !E164.test(nummer)) throw new Error("Ungültige Telefonnummer.");
  const data = Buffer.from(JSON.stringify({ nummer, richtung, anlass: anlass.slice(0, 1000), exp: Date.now() + 180000, id: randomUUID() })).toString("base64url");
  return `${data}.${createHmac("sha256", key).update(data).digest("base64url")}`;
}

export function pruefeTelefonKontext(token: string): TelefonKontext | null {
  const key = process.env.TELNYX_API_KEY;
  if (!key || token.length > 8000) return null;
  try {
    const [data, signature, extra] = token.split(".");
    if (!data || !signature || extra) return null;
    const expected = createHmac("sha256", key).update(data).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const value = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (!Number.isFinite(value.exp) || value.exp < Date.now() || value.exp > Date.now() + 180000 ||
      !["eingehend", "ausgehend"].includes(value.richtung) || typeof value.nummer !== "string" ||
      (value.nummer !== "" && !E164.test(value.nummer)) || typeof value.anlass !== "string" ||
      typeof value.id !== "string") return null;
    return value;
  } catch { return null; }
}

const xml = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));

export function telnyxXml(nummer: string, richtung: TelefonKontext["richtung"], anlass = ""): string {
  const projekt = process.env.OPENAI_PROJECT_ID?.trim();
  if (!projekt || !/^proj_[A-Za-z0-9_-]+$/.test(projekt)) throw new Error("OPENAI_PROJECT_ID fehlt oder ist ungültig.");
  const host = process.env.OPENAI_SIP_HOST ?? "sip.api.openai.com";
  if (!/^[a-zA-Z0-9.-]+$/.test(host)) throw new Error("Ungültiger SIP-Host.");
  const token = telefonKontext(nummer, richtung, anlass);
  // TLS schützt die SIP-Signalisierung; GPT Live verlangt zusätzlich SRTP für Audio.
  const target = `sip:${projekt}@${host};transport=tls;secure=srtp?X-Lukas-Context=${encodeURIComponent(token)}`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial answerOnBridge="true" timeout="30"><Sip>${xml(target)}</Sip></Dial></Response>`;
}

export type TelnyxStand = {
  anbieter: "telnyx"; nummer: string; status: string; verbunden: boolean;
  konfiguriert: boolean; freigeschaltet: boolean; bereit: boolean; hinweis: string;
};

export async function telnyxStand(): Promise<TelnyxStand> {
  const nummer = process.env.TELNYX_NUMMER?.trim() ?? "";
  if (!E164.test(nummer)) throw new Error("TELNYX_NUMMER fehlt oder ist ungültig.");
  const result = await telnyxAnfrage<{ data: Array<{ phone_number: string; status: string; connection_id: string }> }>(
    `/phone_numbers?filter[phone_number]=${encodeURIComponent(nummer)}`,
  );
  const n = result.data.find(n => n.phone_number === nummer);
  if (!n) throw new Error("Die konfigurierte Rufnummer gehört nicht zu diesem Telnyx-Konto.");
  const verbunden = Boolean(process.env.TELNYX_APP_ID && n.connection_id === process.env.TELNYX_APP_ID);
  const konfiguriert = telnyxBereit() && verbunden;
  const freigeschaltet = n.status === "active";
  return { anbieter: "telnyx", nummer, status: n.status, verbunden, konfiguriert, freigeschaltet,
    bereit: konfiguriert && freigeschaltet,
    hinweis: !freigeschaltet ? `Telnyx hat die Rufnummer noch nicht freigeschaltet (${n.status}).` :
      !konfiguriert ? "Die technische Einrichtung ist noch unvollständig." : "Rufnummer aktiv und der Anwendung zugeordnet. Anrufberechtigung, SIP-Verbindung und Audio sind damit noch nicht geprüft.",
  };
}

export async function telnyxWaehle(nummer: string, anlass: string): Promise<void> {
  if (!E164.test(nummer)) throw new Error("Ungültige Zielrufnummer.");
  const stand = await telnyxStand();
  if (!stand.bereit) throw new Error(stand.hinweis);
  await telnyxAnfrage(`/texml/calls/${encodeURIComponent(process.env.TELNYX_APP_ID!)}`, {
    From: stand.nummer, To: nummer, Texml: telnyxXml(nummer, "ausgehend", anlass),
  });
}
