import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/*
 * Code-Vorschlaege von Lukas.
 *
 * ENTSCHIEDEN WIRD IM DASHBOARD, nicht auf GitHub: der Vorschlag liegt dort
 * in verstaendlicher Sprache, und Issa muss fuer eine Kleinigkeit nicht die
 * Oberflaeche wechseln. Das war und bleibt der Punkt.
 *
 * GESCHRIEBEN wird seit dem Umbau anders. Vorher ging jede Datei einzeln ueber
 * die Contents-API auf den Zielbranch. Zwei Dinge gingen dabei schief, beide
 * nachgestellt: scheiterte Datei zwei, war Datei eins schon geschrieben — das
 * Repository stand in einem Zustand, den niemand beschlossen hatte. Und wer
 * zwischen Pruefung und Schreiben etwas an derselben Datei aenderte, wurde
 * stillschweigend ueberschrieben.
 *
 * Jetzt: EIN Commit mit allen Dateien, auf dem festgehaltenen Basiscommit als
 * Elternteil, auf einem eigenen Branch, plus ein Pull Request. Entweder es
 * steht alles, oder nichts. Und ist der Zielbranch weitergelaufen, meldet der
 * Pull Request den Konflikt — sichtbar, statt still.
 *
 * Drei Wege raus:
 *   accepted   -> ein Commit auf eigenem Branch + Pull Request
 *   rejected   -> erledigt, Lukas erfaehrt es
 *   revision   -> geht mit Issas Kommentar zurueck an Lukas
 *
 * Der Datensatz bleibt in jedem Fall erhalten. Damit ist auch spaeter noch
 * nachvollziehbar, was Lukas wann an sich selbst aendern wollte und warum —
 * bei einem System, das sich selbst umschreibt, ist genau das die wichtigste
 * Spur.
 */
export type ProposalFile = {
  path: string;
  content: string;
  /*
   * Blob-SHA der Datei ZUM ZEITPUNKT DES VORSCHLAGS.
   *
   * Warum das noetig ist: content ist immer der vollstaendige neue
   * Dateiinhalt. Wird ein Vorschlag Stunden spaeter angenommen und hat sich die
   * Datei inzwischen geaendert, ueberschreibt das Annehmen die neuere Fassung
   * stillschweigend — der Vorschlag ist ja gegen den alten Stand geschrieben.
   *
   * Genau das ist passiert: Vorschlag #3 hat beim Annehmen eine Zeile
   * entfernt, die zwischenzeitlich dazugekommen war. Niemand hat es bemerkt.
   *
   * Mit dieser SHA laesst sich beim Annehmen pruefen, ob die Datei noch die
   * ist, die Lukas vor sich hatte. Fehlt sie (Vorschlaege von vor dieser
   * Aenderung), ist keine Pruefung moeglich — dann wird es wenigstens gesagt.
   */
  baseSha?: string | null;
};

export const codeProposals = pgTable("lukas_code_proposals", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id"),
  repo: text("repo").notNull(),
  title: text("title").notNull(),
  // In normaler Sprache: was passiert, wenn Issa das annimmt. Ohne Fachbegriffe.
  summary: text("summary").notNull(),
  // Warum Lukas das vorschlaegt — welches Problem er geloest hat.
  reasoning: text("reasoning").notNull().default(""),
  // [{ path, content }] — content ist immer der VOLLSTAENDIGE neue Dateiinhalt.
  files: jsonb("files").$type<ProposalFile[]>().notNull(),
  /*
   * Der Commit, gegen den dieser Vorschlag geschrieben ist.
   *
   * Die Blob-SHA je Datei sagt, ob sich EINE Datei geaendert hat. Sie reicht
   * nicht, um die Aenderung als Ganzes einzuordnen: angewendet wurde bisher
   * gegen den jeweils aktuellen Stand, Datei fuer Datei. Wer zwischen Pruefung
   * und Schreiben etwas aenderte, wurde ueberschrieben.
   *
   * Mit einem festen Basiscommit wird daraus EIN Commit mit genau diesem
   * Elternteil. Ist der Zielbranch weitergelaufen, meldet der Pull Request
   * einen Konflikt — sichtbar, statt still.
   */
  baseCommit: text("base_commit"),
  // Branch und Pull Request, die beim Annehmen entstanden sind.
  branchName: text("branch_name"),
  pullRequestUrl: text("pull_request_url"),
  // pending | accepted | rejected | revision
  status: text("status").notNull().default("pending"),
  // Issas Kommentar beim Zurueckschicken (oder beim Ablehnen).
  comment: text("comment"),
  // Ergebnis des Anwendens: Commit-Link oder Fehlermeldung.
  appliedResult: text("applied_result"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const insertCodeProposalSchema = createInsertSchema(codeProposals).omit({
  id: true,
  createdAt: true,
});

export type CodeProposal = typeof codeProposals.$inferSelect;
export type InsertCodeProposal = z.infer<typeof insertCodeProposalSchema>;
