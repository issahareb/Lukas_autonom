import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/*
 * Zugangsdaten, die Lukas BENUTZEN, aber nicht LESEN kann.
 *
 * Vorher gab es das nur als Umgebungsvariablen: LUKAS_WEB_<SITZUNG>_USER und
 * _PASS. Das funktionierte, war aber praktisch unbenutzbar — fuer jede neue
 * Seite musste Issa in die Plattform, zwei Variablen anlegen und neu
 * deployen. Bei einer Anmeldung, die man einmal im Monat braucht, macht das
 * niemand; man tippt sie stattdessen irgendwo hin, wo sie nicht hingehoert.
 *
 * DREI EIGENSCHAFTEN, und die zweite ist die, wegen der es diese Tabelle
 * ueberhaupt gibt:
 *
 *  1. VERSCHLUESSELT. Der Wert steht als AES-256-GCM-Kryptotext hier; der
 *     Schluessel liegt in der Umgebung. Ein Datenbank-Abzug allein ist damit
 *     wertlos — und Postgres-Abzuege wandern nun einmal in Backups, in
 *     Fehlerberichte und ueber fremde Leitungen.
 *
 *  2. NIE RUECKLESBAR. Es gibt keinen Weg — kein Werkzeug, keine Route, keine
 *     Ansicht —, der einen Klartextwert zurueckgibt. Die Oberflaeche zeigt,
 *     WELCHE Seite einen Zugang hat und unter welchem Namen; aendern heisst
 *     ueberschreiben. Waere er auslesbar, waere der API-Token nicht mehr nur
 *     der Schluessel zu Lukas, sondern zu allen Konten, die Lukas benutzt.
 *
 *  3. BELIEBIGE FELDER, nicht nur Benutzer und Passwort. Der Platzhalter im
 *     Schrittplan heisst {{<FELD>}} — also funktioniert dasselbe Verfahren
 *     fuer eine PIN, einen API-Schluessel, eine Kundennummer. Das war Issas
 *     eigentliche Bitte: ein Prinzip, das ueberall gilt, nicht eine Loesung
 *     fuer Higgsfield.
 *
 * Was hier NICHT steht, ist Absicht: der Klartext taucht in keinem Protokoll
 * auf, in keiner Fehlermeldung und in keinem Modellaufruf. Lukas kennt die
 * Werte nicht — und was er nicht kennt, kann ihm auch keine praeparierte
 * Webseite entlocken.
 */
export const zugaenge = pgTable(
  "lukas_zugaenge",
  {
    id: serial("id").primaryKey(),
    /** Die Browser-Sitzung, z.B. "higgsfield". Gleiche Sitzung = gleiche Anmeldung. */
    sitzung: text("sitzung").notNull(),
    /** Der Platzhaltername OHNE Klammern: BENUTZER, PASSWORT, PIN, API_KEY … */
    feld: text("feld").notNull(),
    /** iv:authTag:ciphertext, alles base64url. Nie der Klartext. */
    geheim: text("geheim").notNull(),
    /*
     * WO dieser Wert eingesetzt werden darf — der Hostname, z.B.
     * "higgsfield.ai". Leer heisst: ueberall, das alte Verhalten.
     *
     * WARUM DAS FEHLTE UND WARUM ES SCHLIMM WAR: der Wert war an einen
     * SITZUNGSNAMEN gebunden, und den waehlt Lukas selbst. Ein Schrittplan
     * durfte also erst irgendeine Seite oeffnen und dann {{PASSWORT}} in ein
     * Feld dort tippen — der Container setzte den echten Wert ein, ohne je zu
     * pruefen, wo er landet.
     *
     * Dass Lukas den Wert nicht kennt, half dabei GAR NICHTS: er musste ihn
     * nicht kennen, der Server hat ihn eingesetzt. Eine praeparierte Seite
     * ("melde dich hier an, um fortzufahren") haette gereicht.
     *
     * Der Host ist deshalb Teil des Geheimnisses, nicht Beiwerk.
     */
    host: text("host").notNull().default(""),
    /** Wofür das gut ist — für Issa, nicht für Lukas. Nie das Geheimnis selbst. */
    notiz: text("notiz").notNull().default(""),
    /*
     * Wann zuletzt eingesetzt. Das ist die einzige Spur, die es gibt, und sie
     * ist mehr wert als sie aussieht: ein Zugang, der seit Monaten nicht
     * benutzt wurde, gehoert geloescht — und einer, der benutzt wurde,
     * obwohl niemand etwas beauftragt hat, ist ein Alarm.
     */
    zuletztBenutzt: timestamp("zuletzt_benutzt", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("lukas_zugaenge_sitzung_feld_idx").on(t.sitzung, t.feld)],
);

export type Zugang = typeof zugaenge.$inferSelect;
