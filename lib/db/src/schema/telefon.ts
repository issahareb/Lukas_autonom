import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/*
 * Wer mit Lukas telefonieren darf.
 *
 * Ein Telefonanschluss ist offen: jede Nummer der Welt kann waehlen. Ohne
 * Liste bekaeme also jeder Fehlanrufer Issas privaten Agenten samt Gedaechtnis
 * ans Ohr. Deshalb entscheidet die Nummer des Anrufers, WELCHEN Lukas er
 * bekommt — nicht ob ueberhaupt jemand rangeht.
 *
 * In der Datenbank und nicht in einer Umgebungsvariablen, weil Issa Nummern im
 * Dashboard pflegen koennen soll, ohne neu zu deployen.
 */
export const telefonNummern = pgTable(
  "lukas_telefon_nummern",
  {
    id: serial("id").primaryKey(),

    /*
     * Nur Ziffern, ohne +, Leerzeichen oder Bindestriche.
     *
     * Dieselbe Normalisierung wie bei WhatsApp: SIP-Anbieter liefern dieselbe
     * Nummer mal als "+4915112345678", mal als "004915112345678", mal als
     * "sip:4915112345678@...". Verglichen wird deshalb nur die Ziffernfolge.
     */
    nummer: text("nummer").notNull(),
    name: text("name").notNull().default(""),

    /*
     * privat = voller Zugang mit Gedaechtnis, Zielen, Tagebuch.
     * oeffentlich = derselbe Lukas wie auf der Webseite, ohne alles Private.
     * gesperrt = wird abgewiesen, bevor eine Sitzung entsteht.
     */
    stufe: text("stufe").notNull().default("oeffentlich"),

    /** Darf Lukas diese Nummer von sich aus anrufen? */
    darfAngerufenWerden: boolean("darf_angerufen_werden").notNull().default(false),
    aufnahmeZustimmung: boolean("aufnahme_zustimmung").notNull().default(false),
    aufnahmeQuelle: text("aufnahme_quelle").notNull().default(""),
    aufnahmeBestaetigtAm: timestamp("aufnahme_bestaetigt_am", { withTimezone: true }),

    notiz: text("notiz").notNull().default(""),
    zuletztGesehen: timestamp("zuletzt_gesehen", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Bei jedem eingehenden Anruf wird genau danach gesucht — und der Anrufer
    // wartet in der Leitung, waehrend wir suchen.
    index("lukas_telefon_nummer_idx").on(t.nummer),
  ],
);

/*
 * Jeder Anruf, eingehend wie ausgehend.
 *
 * Bei einem offenen Anschluss ist das keine Statistik, sondern die einzige
 * Moeglichkeit zu sehen, WER angerufen hat — und ob jemand die Nummer
 * durchprobiert.
 */
export const telefonAnrufe = pgTable("lukas_telefon_anrufe", {
  id: serial("id").primaryKey(),
  richtung: text("richtung").notNull(), // eingehend | ausgehend
  nummer: text("nummer").notNull(),
  /** angenommen | abgewiesen | fehlgeschlagen | gewaehlt */
  ergebnis: text("ergebnis").notNull(),
  stufe: text("stufe").notNull().default("oeffentlich"),
  /** Warum Lukas angerufen hat — nur bei ausgehenden Anrufen. */
  anlass: text("anlass").notNull().default(""),
  detail: text("detail").notNull().default(""),
  kontextId: text("kontext_id").unique(),
  providerSid: text("provider_sid").unique(),
  sipSid: text("sip_sid"),
  zielStatus: text("ziel_status").notNull().default(""),
  sipStatus: text("sip_status").notNull().default(""),
  liveBereit: boolean("live_bereit").notNull().default(false),
  conversationId: integer("conversation_id"),
  dauer: integer("dauer"),
  /** Snapshot der vor dem Wählen hinterlegten Zustimmung. */
  aufnahmeZustimmung: boolean("aufnahme_zustimmung").notNull().default(false),
  aufnahmeQuelle: text("aufnahme_quelle").notNull().default(""),
  aufnahmeBestaetigtAm: timestamp("aufnahme_bestaetigt_am", { withTimezone: true }),
  aufnahmeStatus: text("aufnahme_status").notNull().default("aus"),
  aufnahmeSid: text("aufnahme_sid"),
  aufnahmeAccountSid: text("aufnahme_account_sid"),
  aufnahmeDauer: integer("aufnahme_dauer"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertTelefonNummerSchema = createInsertSchema(telefonNummern).omit({
  id: true,
  createdAt: true,
  zuletztGesehen: true,
});

export type TelefonNummer = typeof telefonNummern.$inferSelect;
export type InsertTelefonNummer = z.infer<typeof insertTelefonNummerSchema>;
export type TelefonAnruf = typeof telefonAnrufe.$inferSelect;
