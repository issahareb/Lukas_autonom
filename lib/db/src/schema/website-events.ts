import { pgTable, text, timestamp, jsonb, primaryKey, index } from 'drizzle-orm/pg-core';
export const websiteEvents = pgTable('lukas_website_events', {
  site: text('site').notNull(), id: text('id').notNull(), session: text('session').notNull(),
  page: text('page').notNull(), path: text('path').notNull(), event: text('event').notNull(),
  occurredAt: timestamp('occurred_at',{withTimezone:true}).notNull(),
  receivedAt: timestamp('received_at',{withTimezone:true}).defaultNow().notNull(),
  data: jsonb('data').notNull(),
}, t => [primaryKey({columns:[t.site,t.id]}),index('website_received_idx').on(t.site,t.receivedAt),index('website_session_idx').on(t.site,t.session,t.receivedAt)]);
