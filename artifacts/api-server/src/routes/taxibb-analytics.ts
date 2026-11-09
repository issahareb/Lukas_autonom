import { Router, type IRouter } from "express";
import { leseTaxiAnalytics } from "../lib/taxi-analytics";
export { taxiAnalyticsSchema } from "../lib/taxi-analytics";

const router: IRouter = Router();
router.get("/lukas/taxibb/analytics", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const days = req.query.days === undefined ? 30 : Number(req.query.days);
  if (![7, 30, 90, 180].includes(days) || (req.query.days !== undefined && typeof req.query.days !== "string")) {
    return res.status(400).json({ error: "Ungültiger Zeitraum" });
  }
  try {
    return res.json(await leseTaxiAnalytics(days));
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : "TaxiBB-Messwerte konnten nicht geladen werden." });
  }
});
export default router;
