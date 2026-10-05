import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/*
 * Was Lukas von Issa braucht.
 *
 * Erster Versuch war: Nachricht in den Chat plus WhatsApp aufs Handy. Beides
 * war falsch. Der Chat ist ein Gespraech — eine Meldung geht dort zwischen den
 * Nachrichten unter, und man sieht nicht, was noch offen ist. Und WhatsApp ist
 * eine Unterbrechung, die Issa nicht wollte.
 *
 * Eine Meldung hat einen Zustand, und genau darum geht es: sie ist OFFEN, bis
 * Issa geantwortet hat. Ein eigener Ort mit einer Zahl daneben zeigt auf einen
 * Blick, ob Lukas gerade auf etwas wartet — ein Chatverlauf tut das nicht.
 */
export const meldungen = pgTable("lukas_meldungen", {
  id: serial("id").primaryKey(),
  /** Worum es geht. Dient auch der Wiederholungssperre. */
  betreff: text("betreff").notNull(),
  /** Was er braucht und warum, ausformuliert. */
  text: text("text").notNull(),
  dringend: boolean("dringend").notNull().default(false),
  /** offen | erledigt */
  status: text("status").notNull().default("offen"),
  /*
   * Issas Antwort.
   *
   * Ohne die waere der Tab eine Sackgasse: Lukas fragt, Issa hakt ab, und die
   * Antwort erfaehrt Lukas nie. Was hier steht, bekommt er beim naechsten
   * autonomen Lauf vorgelegt.
   */
  antwort: text("antwort"),
  /** Ob Lukas die Antwort schon gesehen hat. */
  gelesen: boolean("gelesen").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  erledigtAt: timestamp("erledigt_at", { withTimezone: true }),
  /** Explicit confirmation by the owner; age alone never resolves an issue. */
  geprueftAt: timestamp("geprueft_at", { withTimezone: true }),
});

export const insertMeldungSchema = createInsertSchema(meldungen).omit({
  id: true,
  createdAt: true,
  erledigtAt: true,
});

export type Meldung = typeof meldungen.$inferSelect;
export type InsertMeldung = z.infer<typeof insertMeldungSchema>;
