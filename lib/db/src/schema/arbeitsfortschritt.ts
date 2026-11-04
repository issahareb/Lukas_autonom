import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/** Private owner-only work journal. A tool result is not goal completion. */
export const arbeitsfortschritt = pgTable("lukas_arbeitsfortschritt", {
  scope: text("scope").primaryKey(),
  auftrag: text("auftrag").notNull(),
  status: text("status").notNull(),
  schritte: jsonb("schritte").$type<Array<{
    id: string; werkzeug: string; eingabe: string; status: string; ergebnis?: string;
  }>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
