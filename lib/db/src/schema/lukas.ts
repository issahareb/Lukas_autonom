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
 * Eine Zeile je Tag, Anbieter, Modell und Quelle. Klein genug, dass niemand sie aufraeumen
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
    quelle: text("quelle").notNull().default("unzugeordnet"),
    aufrufe: integer("aufrufe").notNull().default(0),
    rein: integer("rein").notNull().default(0),
    raus: integer("raus").notNull().default(0),
    ausCache: integer("aus_cache").notNull().default(0),
    inCache: integer("in_cache").notNull().default(0),
    aktualisiert: timestamp("aktualisiert").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("lukas_tageskosten_tag_modell_quelle_idx").on(t.tag, t.provider, t.model, t.quelle)],
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
