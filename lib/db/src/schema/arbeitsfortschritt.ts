import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { conversations } from "./conversations";

/** Private owner-only work journal. A tool result is not goal completion. */
export const arbeitsfortschritt = pgTable("lukas_arbeitsfortschritt", {
  scope: text("scope").primaryKey(),
  conversationId: integer("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  auftrag: text("auftrag").notNull(),
  status: text("status").notNull(),
  schritte: jsonb("schritte").$type<Array<{
    id: string; werkzeug: string; eingabe: string; status: string; ergebnis?: string;
  }>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
