import { boolean, doublePrecision, pgTable, text, timestamp, index, integer } from "drizzle-orm/pg-core";

// Provider snapshots are cumulative. One row per session makes replay and
// out-of-order delivery idempotent; seconds are never converted to tokens.
export const liveVerbrauchTable = pgTable("lukas_live_verbrauch", {
  id: text("id").primaryKey(),
  model: text("model").notNull(),
  quelle: text("quelle").notNull(),
  sekunden: doublePrecision("sekunden"),
  beendet: boolean("beendet").notNull().default(false),
  gestartetAt: timestamp("gestartet_at", { withTimezone: true }).notNull(),
  aktualisiertAt: timestamp("aktualisiert_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("lukas_live_verbrauch_start_idx").on(t.gestartetAt)]);

export const openaiGuthabenTable = pgTable("lukas_openai_guthaben", {
  id: integer("id").primaryKey(),
  usd: doublePrecision("usd").notNull(),
  organisation: text("organisation").notNull(),
  bestaetigtAt: timestamp("bestaetigt_at", { withTimezone: true }).notNull(),
});
