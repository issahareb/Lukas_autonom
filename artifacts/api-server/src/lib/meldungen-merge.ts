import { db, meldungen } from "@workspace/db";
import { asc, eq, inArray } from "drizzle-orm";

/** Explicit owner choice. Keep both records and all text; never turn a
 * guessed semantic similarity into a resolved problem or an owner answer. */
export async function fuehreMeldungenZusammen(id: number, zielId: number): Promise<void> {
  await db.transaction(async tx => {
    const rows = await tx.select().from(meldungen).where(inArray(meldungen.id, [id, zielId]))
      .orderBy(asc(meldungen.id)).for("update");
    const source = rows.find(m => m.id === id), target = rows.find(m => m.id === zielId);
    if (!source || !target || source.id === target.id || source.status !== "offen" || target.status !== "offen") {
      throw new Error("Zwei verschiedene offene Meldungen auswählen.");
    }
    const text = `${target.text}\n\nZusammengeführt aus Meldung #${source.id} (${source.betreff}, ${source.createdAt.toISOString()}):\n${source.text}`;
    if (text.length > 40000) throw new Error("Die zusammengeführte Meldung wäre zu lang.");
    await tx.update(meldungen).set({ text, dringend: target.dringend || source.dringend }).where(eq(meldungen.id, zielId));
    await tx.update(meldungen).set({ status: "erledigt", erledigtAt: new Date(), gelesen: true,
      antwort: `Zusammengeführt in Meldung #${zielId}. Das Anliegen bleibt dort offen.` }).where(eq(meldungen.id, id));
  });
}
