import { db, telefonNummern } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { TelefonKontext } from "./telnyx";

function configuredContactId(): number | undefined {
  const raw = process.env.LUKAS_TELEFON_OWNER_CONTACT_ID?.trim() ?? "";
  if (!/^[1-9]\d*$/.test(raw)) return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : undefined;
}

function strict(): boolean {
  return (process.env.LUKAS_TELEFON_STRENG ?? "false").trim().toLowerCase() === "true";
}

/**
 * The caller's display name and spoken claims never grant tool access.
 * The route has already verified both provider signatures and the context HMAC.
 * Caller ID still carries the owner's explicitly accepted telephone-network risk.
 */
export function telefonOwnerContactId(input: {
  id?: number; stufe: string; nummer: string; kontext?: TelefonKontext;
}): number | undefined {
  const configured = configuredContactId();
  const context = input.kontext;
  if (!configured || input.id !== configured || input.stufe !== "privat" || strict() ||
      context?.richtung !== "eingehend" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(context.id) ||
      !/^\+[1-9]\d{5,14}$/.test(context.nummer) || !Number.isFinite(context.exp) || context.exp <= Date.now()) return undefined;
  const normal = (value: string) => value.replace(/[^0-9]/g, "").replace(/^00/, "");
  return normal(input.nummer) === normal(context.nummer) ? configured : undefined;
}

/** Read-only startup lookup; never logs or returns phone numbers or contact names. */
export async function inspectTelefonOwnerContact(): Promise<{
  enabled: boolean; status: "unique" | "missing" | "ambiguous";
  contactId?: number; stufe?: string; configured: boolean;
}> {
  const lookup = process.env.LUKAS_TELEFON_OWNER_CONTACT_LOOKUP?.trim().toLowerCase() ?? "";
  const configuredId = configuredContactId();
  const enabled = Boolean(lookup || process.env.LUKAS_TELEFON_OWNER_CONTACT_ID?.trim());
  if (!enabled || lookup.length > 80 || (!lookup && !configuredId)) {
    return { enabled, status: "missing", configured: false };
  }
  const rows = await db.select({ id: telefonNummern.id, stufe: telefonNummern.stufe })
    .from(telefonNummern)
    .where(lookup ? sql`lower(btrim(${telefonNummern.name})) = ${lookup}` : eq(telefonNummern.id, configuredId!))
    .limit(2);
  if (rows.length !== 1) return { enabled, status: rows.length ? "ambiguous" : "missing", configured: false };
  const row = rows[0];
  return { enabled, status: "unique", contactId: row.id, stufe: row.stufe,
    configured: row.id === configuredId && row.stufe === "privat" && !strict() };
}
