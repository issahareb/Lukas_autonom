import { Router, type IRouter } from "express";
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
const router: IRouter = Router();
router.get("/lukas/taxibb/analytics", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const days = req.query.days === undefined ? 30 : Number(req.query.days);
  if (![7, 30, 90, 180].includes(days) || (req.query.days !== undefined && typeof req.query.days !== "string")) {
    return res.status(400).json({ error: "Ungültiger Zeitraum" });
  }
  const token = process.env.TAXIBB_ANALYTICS_READ_TOKEN;
  if (!token) return res.status(503).json({ error: "TaxiBB-Auswertung ist noch nicht verbunden" });
  try {
    // Fixed destination, no redirects and no browser-visible credentials.
    const response = await fetch(`https://workspaceapi-server-production-8880.up.railway.app/api/analytics/overview?days=${days}`, {
      headers: { "x-analytics-token": token }, redirect: "error", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Error("upstream unavailable");
    const data = taxiAnalyticsSchema.parse(await response.json());
    return res.json({ ...data, fetchedAt: new Date().toISOString() });
  } catch {
    return res.status(503).json({ error: "TaxiBB-Messwerte konnten nicht geladen werden. Bitte erneut versuchen." });
  }
});
export default router;
