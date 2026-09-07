import { pgTable, serial, text, integer, real, timestamp, jsonb, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const lukasStatusTable = pgTable("lukas_status", {
  id: serial("id").primaryKey(),
  mood: text("mood").notNull().default("neutral"),
  energy: text("energy").notNull().default("normal"),
  obsession: text("obsession").notNull().default("nothing specific"),
  note: text("note").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/*
 * Der Zustand des autonomen Taktes — ueber Neustarts hinweg.
 *
 * DER ANLASS: die Leerlaufbremse lag im Arbeitsspeicher. Nach jedem Neustart
 * war sie leer, und "erster Lauf nach dem Start" loeste sofort einen vollen
 * Agentenlauf aus. An einem Tag mit einem Dutzend Deployments sind das ein
 * Dutzend zusaetzlicher Laeufe — jeder mit Seele, Werkzeugen, Erinnerungen und
 * mehreren Runden. Und weil ein Lauf selbst Ziele und Tagebuch aendert, war
 * danach auch die Signatur anders und der naechste regulaere Takt lief
 * ebenfalls. Eine Bremse, die bei jedem Neustart vergisst, ist keine.
 *
 * Zwei Werte, eine Zeile. Absichtlich keine eigene Tabelle mit Historie: es
 * geht um den Zustand von jetzt, nicht um seine Geschichte.
 */
export const autonomieStandTable = pgTable("lukas_autonomie_stand", {
  id: serial("id").primaryKey(),
  /** Wann zuletzt wirklich gelaufen wurde. */
  letzterLauf: timestamp("letzter_lauf", { withTimezone: true }),
  /** Fingerabdruck der Welt nach diesem Lauf. */
  stand: text("stand"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AutonomieStand = typeof autonomieStandTable.$inferSelect;

export const memoriesTable = pgTable("lukas_memories", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  category: text("category").notNull().default("personal"),
  importance: integer("importance").notNull().default(5),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  embedding: jsonb("embedding").$type<number[] | null>().default(null),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  // Erinnerungen zu einem Graph-Knoten werden ueber tags @> '["schluessel"]'
  // gesucht. Auf jsonb ist das ohne GIN ein voller Durchlauf.
  index("lukas_memories_tags_idx").using("gin", t.tags),
  index("lukas_memories_kategorie_idx").on(t.category),
]);

export const goalsTable = pgTable("lukas_goals", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("active"),
  progress: text("progress").notNull().default("just started"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const diaryTable = pgTable("lukas_diary", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  mood: text("mood").notNull().default("neutral"),
  energy: text("energy").notNull().default("normal"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const mediaJobsTable = pgTable("lukas_media_jobs", {
  id: serial("id").primaryKey(),
  requestId: text("request_id"),
  model: text("model").notNull(),
  prompt: text("prompt").notNull(),
  vision: text("vision"),
  status: text("status").notNull().default("pending"),
  resultUrl: text("result_url"),
  mediaType: text("media_type").notNull().default("image"),
  // Klartext-Grund bei status="failed". Vorher landete der Fehler nur in
  // console.error und der Job war "ohne Fehler fehlgeschlagen" — man sah nur,
  // DASS es schiefging, nie warum.
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Gefühlsarchiv: jedes emotionale Ereignis wird dauerhaft gespeichert —
// daraus entstehen aktuelle Stimmung (mit Abklingen) und langfristig Charakter.
export const emotionsTable = pgTable("lukas_emotions", {
  id: serial("id").primaryKey(),
  emotion: text("emotion").notNull(),
  valence: real("valence").notNull(), // -1 (sehr negativ) … +1 (sehr positiv)
  intensity: real("intensity").notNull(), // 0 … 1
  cause: text("cause").notNull(),
  source: text("source").notNull().default("chat"), // chat|goal|trading|media|tool|reflection|moltbook
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CharacterTraits = {
  confidence: number;
  warmth: number;
  guardedness: number;
  playfulness: number;
  ambition: number;
};

export const characterTable = pgTable("lukas_character", {
  id: serial("id").primaryKey(),
  traits: jsonb("traits").$type<CharacterTraits>().notNull(),
  selfImage: text("self_image").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Fehlerprotokoll fuer Chat/Public-Chat/Custom-LLM/TTS/Voice-Session — im
// Dashboard einsehbar (GET /api/lukas/debug-log). In der DB statt nur im
// Arbeitsspeicher, damit es Railway-Redeploys uebersteht (die bei jeder
// Variablenaenderung passieren).
export const debugLogTable = pgTable("lukas_debug_log", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMemorySchema = createInsertSchema(memoriesTable).omit({ id: true, createdAt: true });
export const insertGoalSchema = createInsertSchema(goalsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDiarySchema = createInsertSchema(diaryTable).omit({ id: true, createdAt: true });
export const insertMediaJobSchema = createInsertSchema(mediaJobsTable).omit({ id: true, createdAt: true, updatedAt: true });

export const insertEmotionSchema = createInsertSchema(emotionsTable).omit({ id: true, createdAt: true });

export type EmotionRow = typeof emotionsTable.$inferSelect;
export type CharacterRow = typeof characterTable.$inferSelect;
export type Memory = typeof memoriesTable.$inferSelect;
export type Goal = typeof goalsTable.$inferSelect;
export type DiaryEntry = typeof diaryTable.$inferSelect;
export type MediaJob = typeof mediaJobsTable.$inferSelect;
export type LukasStatusRow = typeof lukasStatusTable.$inferSelect;
export type DebugLogRow = typeof debugLogTable.$inferSelect;

/*
 * Modellverbrauch pro Tag.
 *
 * Bisher lag der Verbrauch nur im Arbeitsspeicher (model-client.ts) und war
 * nach jedem Neustart weg — und Railway startet bei jeder Variablenaenderung
 * neu. Damit liess sich die Frage "wie viel hat heute gekostet" nicht
 * beantworten, und ein Tagesbudget schon gar nicht: es haette bei jedem
 * Deployment wieder bei null angefangen.
 *
 * Eine Zeile je Tag und Modell. Klein genug, dass niemand sie aufraeumen
 * muss, und genau die Koernung, in der man spaeter sieht, WELCHES Modell
 * teuer war.
 */
export const tageskostenTable = pgTable(
  "lukas_tageskosten",
  {
    id: serial("id").primaryKey(),
    /** ISO-Datum in UTC, z.B. "2026-08-29". */
    tag: text("tag").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    aufrufe: integer("aufrufe").notNull().default(0),
    rein: integer("rein").notNull().default(0),
    raus: integer("raus").notNull().default(0),
    ausCache: integer("aus_cache").notNull().default(0),
    inCache: integer("in_cache").notNull().default(0),
    aktualisiert: timestamp("aktualisiert").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("lukas_tageskosten_tag_modell_idx").on(t.tag, t.provider, t.model)],
);

export type Tageskosten = typeof tageskostenTable.$inferSelect;

/*
 * Versandsperre — dieselbe Aktion nicht zweimal.
 *
 * Bei SMS steckt der Schutz in der Nachrichtentabelle selbst (jede Zeile
 * entsteht vor dem Versand und wirkt als Reservierung). Fuer alles andere mit
 * Aussenwirkung gab es nichts: bricht die Verbindung nach dem Absenden einer
 * Mail ab, haelt der Agent den Aufruf fuer gescheitert und schickt sie
 * erneut.
 *
 * Der eindeutige Index ueber (art, fingerabdruck) ist der eigentliche
 * Mechanismus: der Einfuegeversuch IST die Reservierung. Zwei gleichzeitige
 * Zuege koennen nicht beide gewinnen — einer bekommt den Konfliktfehler und
 * weiss damit, dass der andere schon dran ist. Ein Lesen-dann-Schreiben
 * haette genau dieses Rennen verloren.
 */
export const versandTable = pgTable(
  "lukas_versand",
  {
    id: serial("id").primaryKey(),
    /** email | mcp | … — damit sich Fingerabdruecke verschiedener Arten nie treffen. */
    art: text("art").notNull(),
    fingerabdruck: text("fingerabdruck").notNull(),
    /** Was beim ersten Mal herauskam — wird bei einer Wiederholung zurueckgegeben. */
    ergebnis: text("ergebnis").notNull().default(""),
    erledigt: boolean("erledigt").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("lukas_versand_idx").on(t.art, t.fingerabdruck)],
);

export type Versand = typeof versandTable.$inferSelect;

/*
 * Wer den Tag verbraucht hat.
 *
 * DER ANLASS: an einem Tag standen 4,2 Millionen Tokens auf der Uhr, nach
 * eigener Aussage drei Fragen. `lukas_tageskosten` konnte darauf nur
 * antworten, WELCHES Modell das Geld genommen hat — nicht, wer es geschickt
 * hat. Chat, autonomer Lauf, Selbstheilung und neun Mitarbeiter laufen alle
 * ueber denselben Modellpfad und waren danach nicht mehr auseinanderzuhalten.
 *
 * WARUM EINE EIGENE TABELLE statt einer Spalte in `lukas_tageskosten`: der
 * eindeutige Index dort liegt auf (tag, provider, model). Eine Herkunftsspalte
 * muesste hinein, sonst faellt alles wieder in eine Zeile zusammen — und das
 * heisst, den Index auf einer GETEILTEN Produktionsdatenbank zu loeschen und
 * neu zu bauen. Die Migrations-README warnt genau davor, und der Deploy laeuft
 * dort ueber `db:push` ohne jemanden, der eine Rueckfrage beantwortet. Eine
 * neue Tabelle ist rein additiv: sie entsteht oder sie entsteht nicht, aber
 * sie kann nichts kaputtmachen, was schon da ist.
 *
 * Es sind ohnehin zwei verschiedene Fragen. Das Budget will den Tagesgesamt-
 * verbrauch (dafuer bleibt `lukas_tageskosten` unangetastet und bewaehrt); die
 * Herkunft will wissen, wohin es geflossen ist. Getrennte Fragen, getrennte
 * Tabellen — und die eine kann die andere nicht in Mitleidenschaft ziehen.
 */
export const verbrauchHerkunftTable = pgTable(
  "lukas_verbrauch_herkunft",
  {
    id: serial("id").primaryKey(),
    /** ISO-Datum in UTC, wie in lukas_tageskosten. */
    tag: text("tag").notNull(),
    /** "chat" | "autonom" | "selbstheilung" | "mitarbeiter:<slug>" | "unbekannt" */
    herkunft: text("herkunft").notNull(),
    aufrufe: integer("aufrufe").notNull().default(0),
    rein: integer("rein").notNull().default(0),
    raus: integer("raus").notNull().default(0),
    ausCache: integer("aus_cache").notNull().default(0),
    inCache: integer("in_cache").notNull().default(0),
    aktualisiert: timestamp("aktualisiert").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("lukas_verbrauch_herkunft_idx").on(t.tag, t.herkunft)],
);

export type VerbrauchHerkunft = typeof verbrauchHerkunftTable.$inferSelect;

/*
 * Das Uebergabeprotokoll des Teams.
 *
 * Wenn eine Kette aus drei Mitarbeitern ein schwaches Ergebnis liefert, ist
 * die einzige nuetzliche Frage: WO ist es gebrochen? Hat der Fehleranalyst
 * eine duenne Diagnose geliefert, hat der Entwickler sie ignoriert, hat der
 * Pruefer durchgewunken? Bisher stand davon nichts irgendwo — ein
 * `logger.info` beim Start und ein Einsatzzaehler, das war alles. Danach war
 * die Kette nicht mehr nachvollziehbar, sondern nur noch ihr Ergebnis da.
 *
 * Ein nachvollziehbarer Fehlschlag laesst sich korrigieren. Ein
 * unerklaerlicher nicht.
 *
 * Auftrag und Ergebnis stehen GEKUERZT drin, nicht vollstaendig: das hier ist
 * eine Spur zum Nachsehen, kein zweites Gedaechtnis. Vollstaendige
 * Werkzeugergebnisse haben ihren Platz im Gespraech.
 */
export const uebergabenTable = pgTable(
  "lukas_uebergaben",
  {
    id: serial("id").primaryKey(),
    /** Slug des Mitarbeiters — Grundrolle oder selbst eingestellt. */
    helfer: text("helfer").notNull(),
    /** Wer ihn gerufen hat: dieselben Werte wie in lukas_verbrauch_herkunft. */
    herkunft: text("herkunft").notNull().default("unbekannt"),
    auftrag: text("auftrag").notNull().default(""),
    ergebnis: text("ergebnis").notNull().default(""),
    /** Volle Laenge der Antwort — damit sichtbar ist, wie viel hier fehlt. */
    ergebnisZeichen: integer("ergebnis_zeichen").notNull().default(0),
    /** Wurde die Antwort bei der Uebergabe abgeschnitten? */
    gekuerzt: boolean("gekuerzt").notNull().default(false),
    tokens: integer("tokens").notNull().default(0),
    dauerMs: integer("dauer_ms").notNull().default(0),
    /** Gescheitert? Dann steht hier der Grund statt eines Ergebnisses. */
    fehler: text("fehler"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("lukas_uebergaben_zeit_idx").on(t.createdAt)],
);

export type Uebergabe = typeof uebergabenTable.$inferSelect;

/*
 * Lukas' Papierhandel — Entscheidungen mit Protokoll, ohne Geld.
 *
 * DER ZWECK ist nicht, ihn spielen zu lassen. Es geht um eine Zahl statt einer
 * Meinung: nach vier Wochen soll nicht dastehen "er hat ein gutes Gespuer",
 * sondern wie oft er richtig lag, bei welcher Art von Markt, und wo er
 * daneben lag.
 *
 * DAMIT DAS ETWAS WERT IST, muss der Eintrag faelschungssicher gegen den
 * eigenen Optimismus sein. Drei Eigenschaften tragen das, und sie sind der
 * eigentliche Inhalt dieser Tabelle:
 *
 *  1. DER KURS KOMMT NICHT VOM MODELL. Es gibt keinen Parameter, in den Lukas
 *     einen Einstiegspreis schreiben koennte — der Server holt ihn selbst und
 *     legt den Rohausschnitt als Beleg daneben. Ein Modell, das seinen eigenen
 *     Einstieg tippen darf, tippt frueher oder spaeter den guenstigen.
 *  2. ERWARTUNG UND FRIST STEHEN VORHER FEST. Ohne "ich erwarte X bis Y" laesst
 *     sich hinterher jeder Ausgang als halber Erfolg erzaehlen. Mit Frist wird
 *     aus einer offenen Position nach Ablauf automatisch ein Befund, den
 *     niemand erwaehnen muss.
 *  3. NICHTS WIRD NACHTRAEGLICH GEAENDERT. Grund und Erwartung bekommen keinen
 *     Schreibpfad nach dem Eroeffnen. Was beim Schliessen dazukommt, steht in
 *     eigenen Spalten daneben — nicht anstelle.
 *
 * EIGENE TABELLE, ausdruecklich NICHT `trades`: dort liegen die echten Trades
 * der VPS-Bots. Papier und Geld in derselben Tabelle waere genau die
 * Verwechslung, die man sich nicht leisten kann — und die Felder, auf die es
 * hier ankommt (Grund, Erwartung, Beleg), gibt es dort ohnehin nicht.
 */
export const papierhandelTable = pgTable(
  "lukas_papierhandel",
  {
    id: serial("id").primaryKey(),
    /** Worauf gesetzt wird, in Worten. */
    markt: text("markt").notNull(),
    /*
     * "binaer" = Vorhersagemarkt, Kurs zwischen 0 und 1 (Polymarket).
     * "preis"  = normaler Kurs (BTC). Die Gewinnrechnung ist eine andere,
     * deshalb steht die Art hier und wird nicht geraten.
     */
    art: text("art").notNull().default("binaer"),
    /** "ja"/"nein" bei binaer, "long"/"short" bei preis. */
    richtung: text("richtung").notNull(),
    /** Gedachter Einsatz in Cent. Ganzzahlig, damit nichts rundet. */
    einsatzCent: integer("einsatz_cent").notNull(),

    /** Woher der Kurs kam — URL und Pfad im JSON. Beides fuer die Nachpruefung. */
    quelle: text("quelle").notNull(),
    kursPfad: text("kurs_pfad").notNull(),
    einstieg: real("einstieg").notNull(),
    /** Rohausschnitt der Antwort. Der Beleg, dass der Kurs echt war. */
    einstiegBeleg: text("einstieg_beleg").notNull().default(""),

    /** Warum. Wird nach dem Eröffnen nie wieder geschrieben. */
    grund: text("grund").notNull(),
    /** Was er erwartet — pruefbar formuliert. Ebenfalls unveraenderlich. */
    erwartung: text("erwartung").notNull(),
    /** Bis wann die Erwartung eingetreten sein soll. */
    fristBis: timestamp("frist_bis").notNull(),

    /** offen | geschlossen | verfallen */
    status: text("status").notNull().default("offen"),
    ausstieg: real("ausstieg"),
    ausstiegBeleg: text("ausstieg_beleg"),
    /** Gewinn/Verlust in Cent, positiv wie negativ. */
    pnlCent: integer("pnl_cent"),
    /** Was er hinterher dazu sagt. Kommt NEBEN den Grund, nicht an seine Stelle. */
    ergebnis: text("ergebnis"),
    geschlossenAm: timestamp("geschlossen_am"),

    /** War es seine Idee oder hat Issa gefragt? Aus lib/zug.ts. */
    herkunft: text("herkunft").notNull().default("unbekannt"),
    eroeffnetAm: timestamp("eroeffnet_am").defaultNow().notNull(),
  },
  (t) => [index("lukas_papierhandel_status_idx").on(t.status, t.fristBis)],
);

export type Papierhandel = typeof papierhandelTable.$inferSelect;
