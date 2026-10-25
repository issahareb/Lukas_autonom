import { Router } from "express";
const router = Router();
// These routes share the existing private telephone API authentication.
router.get("/lukas/telefon/rueckrufe", async (_req, res) => {
  try { const { rueckrufStatus } = await import("../lib/rueckrufe"); res.json(await rueckrufStatus()); }
  catch { res.status(503).json({ error: "Rückrufstatus nicht verfügbar" }); }
});
router.post("/lukas/telefon/rueckrufe/:id/stornieren", async (req, res) => {
  try { const { storniereRueckruf } = await import("../lib/rueckrufe"); res.json(await storniereRueckruf(String(req.params.id))); }
  catch { res.status(409).json({ error: "Rückruf nicht storniert; Status prüfen" }); }
});
export default router;
