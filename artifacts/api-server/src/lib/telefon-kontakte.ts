import { db, telefonNummern } from "@workspace/db";
import { asc, ilike, or, sql } from "drizzle-orm";

/** Escape LIKE wildcards: a contact name is data, never a search expression. */
const like = (s: string) => s.replace(/[\\%_]/g, "\\$&");
export async function findeTelefonKontakte(suche: string) {
  const q = suche.trim().replace(/\s+/g, " ");
  if (q.length > 80) return [];
  const name = sql<string>`regexp_replace(btrim(${telefonNummern.name}), '\\s+', ' ', 'g')`;
  if (q) {
    const exact = await db.select().from(telefonNummern).where(ilike(name, like(q))).orderBy(asc(telefonNummern.id)).limit(26);
    if (exact.length) return exact;
  }
  return db.select().from(telefonNummern).where(q ? or(ilike(name, `%${like(q)}%`), ilike(telefonNummern.nummer, `%${like(q.replace(/^\+/, ""))}%`)) : undefined)
    .orderBy(asc(telefonNummern.name), asc(telefonNummern.id)).limit(26);
}

export async function telefonKontakte(suche = ""): Promise<string> {
  const rows = await findeTelefonKontakte(suche);
  return JSON.stringify({ kontakte: rows.slice(0, 25).map(r => ({ id: r.id, name: r.name, nummer: "+" + r.nummer,
    darfAngerufenWerden: r.darfAngerufenWerden, gesperrt: r.stufe === "gesperrt", aufnahmeZustimmung: r.aufnahmeZustimmung })),
    weitereTreffer: rows.length > 25,
    hinweis: "Bei mehreren Treffern nach dem vollständigen Namen oder der Nummer fragen. Keine Nummer raten. Zustimmung zur Aufzeichnung ist getrennt von der Anruffreigabe." });
}
