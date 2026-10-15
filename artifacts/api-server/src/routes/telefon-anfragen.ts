import { Router } from "express";
import { pool } from "@workspace/db";
import { z } from "zod";
import { logger } from "../lib/logger";

const router = Router();
// Mounted only after lukasAuth, never on the signed public telephone webhook router.
router.get("/telefon/anfragen", async (req, res) => {
  const query = z.object({
    status: z.enum(["neu", "in_bearbeitung", "erledigt", "archiviert"]).optional(),
    q: z.string().max(200).optional(),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  }).safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Ungültiger Filter." }); return; }
  const { status, q, offset } = query.data;
  // User text is a parameter; wildcard characters are escaped for literal searching.
  const search = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
  const where = "($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR concat_ws(' ',nummer,zusammenfassung,details) ILIKE $2)";
  try {
    const [result, count] = await Promise.all([
      pool.query(`SELECT id, nummer, status, kategorie, zusammenfassung, details, weitergabe, auswertung,
        notiz, email_status, beendet_am, created_at, updated_at FROM lukas_telefon_anfragen
        WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET $3`, [status ?? null, search, offset]),
      pool.query(`SELECT count(*)::int AS total FROM lukas_telefon_anfragen WHERE ${where}`, [status ?? null, search]),
    ]);
    res.setHeader("Cache-Control", "no-store");
    res.json({ rows: result.rows.map(row => ({ ...row, details: JSON.parse(row.details) })), total: count.rows[0].total });
  } catch { res.status(500).json({ error: "Telefonanfragen konnten nicht geladen werden." }); }
});
router.patch("/telefon/anfragen/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = z.object({ status: z.enum(["neu", "in_bearbeitung", "erledigt", "archiviert"]).optional(), notiz: z.string().max(5000).optional() }).strict().safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !body.success || Object.keys(body.data).length === 0) {
    res.status(400).json({ error: "Ungültige Änderung." }); return;
  }
  try {
    const result = await pool.query(`UPDATE lukas_telefon_anfragen SET status=COALESCE($2,status), notiz=COALESCE($3,notiz), updated_at=now() WHERE id=$1 RETURNING id`, [id, body.data.status ?? null, body.data.notiz ?? null]);
    if (!result.rowCount) { res.status(404).json({ error: "Anfrage nicht gefunden." }); return; }
    res.json({ ok: true });
  } catch { logger.warn({ phase: "enquiry_update_failed" }, "Telefonanfrage konnte nicht aktualisiert werden"); res.status(500).json({ error: "Änderung nicht gespeichert." }); }
});
export default router;
