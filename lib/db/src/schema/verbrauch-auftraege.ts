import { pgTable, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";

export const verbrauchAuftraege = pgTable("lukas_verbrauch_auftraege", {
  id: text("id").primaryKey(), rootId: text("root_id").notNull(), parentId: text("parent_id"),
  quelle: text("quelle").notNull(), conversationId: integer("conversation_id"),
  status: text("status").notNull().default("laeuft"),
  gestartetAt: timestamp("gestartet_at", { withTimezone: true }).defaultNow().notNull(),
  beendetAt: timestamp("beendet_at", { withTimezone: true }),
  messung: jsonb("messung").$type<{ version: number; revision: string | null; aufgabenart: string; promptHash?: string; fallstudie?: { serie: string; fall: string; abnahme: string } }>(),
}, t => [index("lukas_verbrauch_auftraege_start_idx").on(t.gestartetAt)]);

export const verbrauchAufrufe = pgTable("lukas_verbrauch_aufrufe", {
  id: text("id").primaryKey(), auftragId: text("auftrag_id").notNull(), rootId: text("root_id").notNull(),
  model: text("model").notNull(), provider: text("provider").notNull(), quelle: text("quelle").notNull(),
  phase: text("phase").notNull(), status: text("status").notNull(),
  eingabe: integer("eingabe"), ausgabe: integer("ausgabe"), cacheLesen: integer("cache_lesen"), cacheSchreiben: integer("cache_schreiben"),
  kontext: jsonb("kontext").$type<{ systemZeichen: number; verlaufZeichen: number; ergebnisZeichen: number; schemaZeichen: number; schemaBytes?: number; schemaFormat?: "openai-responses"; werkzeuge: number }>().notNull(),
  dauerMs: integer("dauer_ms").notNull(),
  gestartetAt: timestamp("gestartet_at", { withTimezone: true }).defaultNow().notNull(),
  nachweis: jsonb("nachweis").$type<{ version: number; revision: string | null; profil?: string; responseId?: string; gemeldetesModell?: string; usage?: Record<string, unknown>; nurBeleg?: boolean }>(),
}, t => [index("lukas_verbrauch_aufrufe_root_idx").on(t.rootId), index("lukas_verbrauch_aufrufe_start_idx").on(t.gestartetAt)]);

// Append-only human/test-runner acceptance. A model-created answer is not a verified result.
export const verbrauchAbnahmen = pgTable("lukas_verbrauch_abnahmen", {
  id: text("id").primaryKey(), rootId: text("root_id").notNull(),
  ergebnis: text("ergebnis").notNull(), beleg: text("beleg").notNull(),
  pruefer: text("pruefer").notNull(), erstelltAt: timestamp("erstellt_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("lukas_verbrauch_abnahmen_root_idx").on(t.rootId)]);

export const verbrauchBerichte = pgTable("lukas_verbrauch_berichte", {
  id: text("id").primaryKey(), sha256: text("sha256").notNull(),
  daten: jsonb("daten").$type<Record<string, unknown>>().notNull(),
  erstelltAt: timestamp("erstellt_at", { withTimezone: true }).defaultNow().notNull(),
});
