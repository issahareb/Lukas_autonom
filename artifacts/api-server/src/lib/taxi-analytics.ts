import { z } from "zod";

const number = z.number().finite().nonnegative();
// Strip all other upstream fields: this connection only exposes aggregate counts.
export const taxiAnalyticsSchema = z.object({
  rangeDays: z.number().int().min(1).max(180),
  summary: z.object({ pageviews: number, sessions: number, avgScrollDepth: number, avgActiveSecondsPerSession: number }),
  clicks: z.array(z.object({ target: z.string().max(60), clicks: number, sessions: number })).max(100),
  forms: z.array(z.object({ kind: z.string().max(60), starts: number, attempts: number, successes: number, errors: number, startedSessions: number, successSessions: number })).max(100).default([]),
  funnel: z.object({ formStartSessions: number, formSubmitSessions: number, bookings: number }),
});

/** Shared by the private dashboard and agent; the credential stays server-side. */
export async function leseTaxiAnalytics(days: number) {
  if (![7, 30, 90, 180].includes(days)) throw new Error("TaxiBB unterstützt 7, 30, 90 oder 180 Tage.");
  const token = process.env.TAXIBB_ANALYTICS_READ_TOKEN;
  if (!token) throw new Error("TaxiBB-Auswertung ist noch nicht verbunden");
  try {
    const response = await fetch(`https://workspaceapi-server-production-8880.up.railway.app/api/analytics/overview?days=${days}`, {
      headers: { "x-analytics-token": token }, redirect: "error", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("upstream unavailable");
    const data = taxiAnalyticsSchema.parse(await response.json());
    if (data.rangeDays !== days) throw new Error("Unexpected analytics range");
    return { ...data, fetchedAt: new Date().toISOString() };
  } catch {
    throw new Error("TaxiBB-Messwerte konnten nicht geladen werden. Bitte erneut versuchen.");
  }
}
