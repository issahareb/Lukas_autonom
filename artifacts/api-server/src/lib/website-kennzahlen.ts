import { pool } from "@workspace/db";
import { z } from "zod";
import { leseTaxiAnalytics } from "./taxi-analytics";

// These are the same aggregate queries as the authenticated dashboard.
export const WEBSITE_ANALYTICS_PREFIX = "WITH e AS (SELECT * FROM lukas_website_events WHERE site=$1 AND received_at >= now()-($2::int * interval '1 day')) ";
export const WEBSITE_SUMMARY_SELECT = `, p AS (SELECT session,page,max(coalesce((data->>'seconds')::float,0)) seconds,max(coalesce((data->>'depth')::float,0)) depth FROM e WHERE event IN ('engagement','page_exit') GROUP BY session,page), s AS (SELECT session,sum(seconds) seconds FROM p GROUP BY session) SELECT (SELECT count(DISTINCT session) FROM e) sessions,(SELECT count(*) FROM e WHERE event='page_view') views,(SELECT count(DISTINCT session) FROM e WHERE received_at>now()-interval '30 seconds' AND event IN ('page_view','engagement')) active,coalesce((SELECT avg(seconds) FROM s),0) seconds,coalesce((SELECT avg(depth) FROM p),0) depth`;

const inputSchema = z.object({
  website: z.enum(["hareb.digital", "issahareb.me", "taxibbessen.de"]),
  tage: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90), z.literal(180)]).default(7),
}).strict();
const count = z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/)]).transform(Number).pipe(z.number().finite().nonnegative());
const summarySchema = z.object({ sessions: count, views: count, active: count, seconds: count, depth: count });

/** Read-only, fresh aggregates for private chat and verified owner calls. */
export async function leseWebsiteKennzahlen(input: Record<string, unknown>) {
  const f = inputSchema.parse(input);
  const hinweis = "Erfasste Seitenaufrufe sind keine eindeutigen Personen; Sitzungen sind separat gezählt. Tracking- und Einwilligungslücken können fehlen. Zeitraum ist ein rollendes Fenster bis zum Abruf, kein bestätigter Kalendertag. Keine Werte aus dem Gedächtnis ergänzen.";
  if (f.website === "taxibbessen.de") {
    const data = await leseTaxiAnalytics(f.tage);
    return JSON.stringify({ website: f.website, tage: data.rangeDays, fetchedAt: data.fetchedAt,
      quelle: "TaxiBB Analytics, derselbe Abruf wie im privaten Dashboard", summary: data.summary,
      clicks: data.clicks, forms: data.forms, funnel: data.funnel,
      hinweis: hinweis + " Gespeicherte Buchungen (funnel.bookings) sind unabhängig vom Formulartracking. formSubmitSessions zählt Sitzungen mit Formularabschluss, keine E-Mail-Zustellungen." });
  }
  if (f.tage === 180) throw new Error("Diese Website unterstützt 1, 7, 30 oder 90 Tage.");
  try {
    const result = await pool.query(WEBSITE_ANALYTICS_PREFIX + WEBSITE_SUMMARY_SELECT, [f.website, f.tage]);
    const row = summarySchema.parse(result.rows[0]);
    return JSON.stringify({ website: f.website, tage: f.tage, fetchedAt: new Date().toISOString(),
      quelle: "LUKAS Website-Tracking, dieselbe Zusammenfassung wie im privaten Dashboard",
      summary: { pageviews: row.views, sessions: row.sessions, activeSessions: row.active,
        avgScrollDepth: row.depth, avgActiveSecondsPerSession: row.seconds }, hinweis });
  } catch {
    throw new Error("Website-Messwerte konnten nicht geladen werden. Kein Nullstand bestätigt.");
  }
}
