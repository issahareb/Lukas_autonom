/** Durable user-requested calls. No model runs in the scheduler. */
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { findeTelefonKontakte } from "./telefon-kontakte";
import { normalisiere, starteAnrufMitStatus } from "./telefon";

type Auftrag = { id: string; kontakt_id: number | null; nummer: string; anlass: string; faellig_am: Date; status: string; conversation_id: number | null };
export function rueckrufZeit(input: { in_minuten?: unknown; zeitpunkt?: unknown }, now = Date.now()): Date {
  if ((input.in_minuten !== undefined) === (input.zeitpunkt !== undefined)) throw new Error("Genau eine Zeit angeben: in_minuten oder zeitpunkt mit Zeitzone.");
  let at: number;
  if (input.in_minuten !== undefined) {
    if (typeof input.in_minuten !== "number" || !Number.isFinite(input.in_minuten) || input.in_minuten < 1) throw new Error("Mindestens eine Minute Vorlauf ist nötig.");
    at = now + input.in_minuten * 60_000;
  } else {
    if (typeof input.zeitpunkt !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(input.zeitpunkt)) throw new Error("Zeitpunkt benötigt Datum, Uhrzeit und Zeitzone.");
    at = Date.parse(input.zeitpunkt);
  }
  if (!Number.isFinite(at) || at < now + 30_000 || at > now + 30 * 86400_000) throw new Error("Rückrufzeit muss in der Zukunft und innerhalb von 30 Tagen liegen.");
  return new Date(at);
}
export async function planeRueckruf(input: Record<string, unknown>, ctx: { telefonOwnerContactId?: number; conversationId?: number; signal?: AbortSignal }) {
  const at = rueckrufZeit(input);
  const target = typeof input.nummer === "string" ? input.nummer.trim() : "";
  let id: number;
  if (!target || /^(mich|mir|ich|issas? nummer)$/i.test(target)) {
    if (!ctx.telefonOwnerContactId) throw new Error("Rückrufziel fehlt. Gespeicherten Kontakt nennen; keine Nummer aus Gesprächsbehauptungen ableiten.");
    id = ctx.telefonOwnerContactId;
  } else {
    const contacts = /^[+\d\s()./-]+$/.test(target)
      ? (await pool.query("SELECT id FROM lukas_telefon_nummern WHERE nummer=$1", [normalisiere(target)])).rows
      : await findeTelefonKontakte(target);
    if (contacts.length !== 1) throw new Error("Rückrufziel ist nicht eindeutig als Kontakt gespeichert. Kontakt klären; kein Auftrag gespeichert.");
    id = contacts[0].id;
  }
  const reason = typeof input.anlass === "string" ? input.anlass.trim().slice(0, 2000) : "Vereinbarter Rückruf";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock the contact, serializing scheduling from concurrent delegates/replicas.
    const { rows: [contact] } = await client.query("SELECT id, nummer, stufe, darf_angerufen_werden FROM lukas_telefon_nummern WHERE id=$1 FOR UPDATE", [id]);
    if (!contact || contact.stufe === "gesperrt" || !contact.darf_angerufen_werden) throw new Error("Kontakt ist nicht für ausgehende Anrufe freigegeben. Kein Rückruf gespeichert.");
    const existing = await client.query("SELECT id, faellig_am, status FROM lukas_rueckrufe WHERE kontakt_id=$1 AND status IN ('geplant','startet')", [id]);
    if (existing.rows.length) {
      await client.query("COMMIT");
      return JSON.stringify({ ...existing.rows[0], bereits_vorhanden: true, hinweis: "Kein zweiter Auftrag erstellt. Bestehenden Rückruf bei Bedarf erst stornieren." });
    }
    ctx.signal?.throwIfAborted();
    const key = randomUUID();
    await client.query("INSERT INTO lukas_rueckrufe (id,kontakt_id,nummer,anlass,faellig_am,conversation_id) VALUES ($1,$2,$3,$4,$5,$6)",
      [key,id,normalisiere(contact.nummer),reason,at,ctx.conversationId && ctx.conversationId > 0 ? ctx.conversationId : null]);
    await client.query("COMMIT");
    return JSON.stringify({ id:key,status:"geplant",faellig_am:at.toISOString(),hinweis:"Dauerhaft gespeichert. Noch kein Anruf gestartet; Ausführung und Gesprächserfolg werden getrennt verfolgt." });
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}
export async function rueckrufStatus() {
  const { rows } = await pool.query("SELECT r.id, r.kontakt_id, r.faellig_am, r.status, r.ergebnis, r.anruf_id, r.updated_at, a.ergebnis AS anruf_status FROM lukas_rueckrufe r LEFT JOIN lukas_telefon_anrufe a ON a.kontext_id=r.anruf_id ORDER BY r.created_at DESC LIMIT 30");
  return rows;
}
export async function storniereRueckruf(id: string) {
  const { rows } = await pool.query("UPDATE lukas_rueckrufe SET status='storniert', updated_at=now() WHERE id=$1 AND status='geplant' RETURNING id,status", [id]);
  if (!rows.length) throw new Error("Nicht storniert: Auftrag fehlt oder wurde bereits gestartet/beendet. Einen laufenden Anruf beendet diese Aktion nicht.");
  return rows[0];
}
async function finish(id: string, status: string, message: string, callId?: string) {
  // Result and visible notification are atomic, including crash recovery.
  await pool.query(`WITH done AS (
    UPDATE lukas_rueckrufe SET status=$2, ergebnis=$3, anruf_id=$4, updated_at=now()
    WHERE id=$1 AND status='startet' RETURNING id
  ) INSERT INTO lukas_meldungen (betreff,text,dringend)
    SELECT 'Rückrufauftrag ' || id, $3, $2 <> 'gestartet' FROM done`, [id,status,message,callId ?? null]);
}
/** One batch, also used by integration tests with a fake dialer. */
export async function fuehreRueckrufeAus(dial = starteAnrufMitStatus) {
  await pool.query(`WITH expired AS (
    UPDATE lukas_rueckrufe SET status=CASE WHEN status='startet' THEN 'unklar' ELSE 'verpasst' END,
      ergebnis=CASE WHEN status='startet' THEN 'Ausführung unterbrochen; Anbieterstatus prüfen. Keine automatische Wiederholung.' ELSE 'Rückruf mehr als 15 Minuten überfällig; nicht nachträglich angerufen.' END, updated_at=now()
    WHERE (status='startet' AND updated_at < now()-interval '2 minutes')
       OR (status='geplant' AND faellig_am < now()-interval '15 minutes') RETURNING id,ergebnis
  ) INSERT INTO lukas_meldungen (betreff,text,dringend) SELECT 'Rückrufauftrag '||id,ergebnis,true FROM expired`);
  const { rows } = await pool.query<Auftrag>(`UPDATE lukas_rueckrufe SET status='startet', updated_at=now()
    WHERE id IN (SELECT id FROM lukas_rueckrufe WHERE status='geplant' AND faellig_am<=now()
      ORDER BY faellig_am FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
  for (const row of rows) {
    try {
      // Permission and exact contact binding are checked again at execution time.
      const { rows: [contact] } = await pool.query("SELECT nummer,stufe,darf_angerufen_werden FROM lukas_telefon_nummern WHERE id=$1", [row.kontakt_id]);
      if (!contact || !contact.darf_angerufen_werden || contact.stufe === "gesperrt" || normalisiere(contact.nummer) !== row.nummer) {
        await finish(row.id,"blockiert","Rückruf nicht gestartet: Kontakt entfernt, geändert oder Anruffreigabe widerrufen."); continue;
      }
      const result = await dial("+"+row.nummer,row.anlass,undefined,row.conversation_id ?? undefined);
      await finish(row.id, result.status === "started" ? "gestartet" : result.status === "uncertain" ? "unklar" : "blockiert",result.message,result.callId);
    } catch {
      // A network failure can occur AFTER the provider accepted the call.
      await finish(row.id,"unklar","Rückrufausführung nicht bestätigt. Anbieter-/Anrufstatus prüfen; keine automatische Wiederholung.");
    }
  }
}
let timer: ReturnType<typeof setInterval> | undefined;
let running: Promise<void> | undefined;
export function startRueckrufe() {
  if (timer) return;
  const tick = () => { if (!running) running = fuehreRueckrufeAus().catch(() => logger.error("Rückruf-Warteschlange konnte nicht verarbeitet werden")).finally(() => { running=undefined; }); };
  // Explicit user jobs must run even if unsolicited autonomous work is paused.
  timer=setInterval(tick,5000); timer.unref(); tick();
  logger.info("Rückruf-Warteschlange aktiv (5 Sekunden)");
}
export async function stopRueckrufe() { if (timer) clearInterval(timer); timer=undefined; await running; }
