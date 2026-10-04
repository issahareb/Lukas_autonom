import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import pg from "pg";

const dir = mkdtempSync(resolve(".telefon-status-check-"));
let pool, restartPool, client, schema;
const oldUrl = process.env.DATABASE_URL;
try {
  const stub = join(dir, "stub.mjs");
  writeFileSync(stub, "export const db={}, telefonAnrufe={}, messages={}, conversations={};");
  const out = join(dir, "pure.mjs");
  await build({ entryPoints: ["src/lib/telefon-status.ts"], outfile: out, bundle: true,
    platform: "node", format: "esm", packages: "external", alias: { "@workspace/db": stub } });
  const { naechsterStatus: next, anrufErgebnis: result } = await import(out);
  for (const end of ["completed", "busy", "no-answer", "failed", "canceled"]) {
    for (const late of ["queued", "initiated", "ringing", "in-progress", "completed", "failed"]) assert.equal(next(end, late), end);
  }
  assert.equal(next("in-progress", "ringing"), "in-progress");
  assert.equal(next("queued", "unknown"), "queued");
  const call = (zielStatus, sipStatus = "", liveBereit = false) => result({ zielStatus, sipStatus, liveBereit });
  assert.equal(call("queued"), "gewaehlt");
  assert.equal(call("ringing"), "klingelt");
  assert.equal(call("in-progress"), "angenommen");
  assert.equal(call("in-progress", "in-progress"), "angenommen", "SIP alone does not confirm Live readiness");
  assert.equal(call("in-progress", "in-progress", true), "verbunden");
  assert.equal(call("in-progress", "completed", true), "beendet", "An ended SIP leg cannot turn back into an accepted call");
  assert.equal(call("completed", "failed", true), "verbindungsfehler");
  for (const [status, expected] of [["busy", "besetzt"], ["no-answer", "keine_antwort"], ["failed", "fehlgeschlagen"], ["canceled", "abgebrochen"], ["completed", "beendet"]]) assert.equal(call(status), expected);
  console.log("OK — Telefonstatus: Start ≠ Annahme ≠ Verbindung, Fehlerursachen und verspätete Terminalmeldungen.");

  if (process.env.BENCH_DATABASE_URL) {
    client = new pg.Client({ connectionString: process.env.BENCH_DATABASE_URL }); await client.connect();
    schema = "bench_telefon_" + process.pid;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    const baseline = readFileSync("../../lib/db/migrations/0000_vengeful_lord_tyger.sql", "utf8");
    for (const table of ["lukas_conversations", "lukas_messages", "lukas_telefon_anrufe", "lukas_telefon_nummern"]) {
      await client.query(baseline.match(new RegExp(`CREATE TABLE "${table}" \\([\\s\\S]*?\\n\\);`))[0]);
    }
    await client.query('ALTER TABLE lukas_messages ADD FOREIGN KEY (conversation_id) REFERENCES lukas_conversations(id) ON DELETE CASCADE');
    await client.query(readFileSync("../../lib/db/migrations/0003_aspiring_tenebrous.sql", "utf8"));
    await client.query(readFileSync("../../lib/db/migrations/0004_fixed_havok.sql", "utf8"));
    await client.query(readFileSync("../../lib/db/migrations/0005_glossy_alice.sql", "utf8"));
    const url = new URL(process.env.BENCH_DATABASE_URL); url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.href;
    const real = join(dir, "real.mjs");
    await build({ stdin: { contents: 'export * from "./src/lib/telefon-status.ts"; export * from "./src/lib/telefon-kontakte.ts"; export * from "./src/lib/telefon-aufnahme.ts"; export { erlaubterMithoerAnruf } from "./src/lib/telefon-mithoeren.ts"; export { pool } from "@workspace/db";', resolveDir: process.cwd(), loader: "ts" },
      outfile: real, bundle: true, platform: "node", format: "esm", packages: "external", alias: { "@workspace/db": resolve("../../lib/db/src/index.ts") } });
    const t = await import(real); pool = t.pool;
    process.env.TELNYX_NUMMER = "+49201123456"; process.env.TELNYX_APP_ID = "test-app";
    const { rows: [chat] } = await client.query("INSERT INTO lukas_conversations(title) VALUES ('Anruf-Test') RETURNING id");
    const ids = await Promise.all([t.neuerVerfolgterAnruf("4915112345678", "Auftrag A", chat.id), t.neuerVerfolgterAnruf("4915112345678", "Auftrag B", chat.id)]);
    assert.notEqual(ids[0], ids[1]);
    await Promise.all(ids.map((id, i) => t.aktualisiereAnruf(id, { providerSid: "root-" + i })));
    const root = (i, status, extra = {}) => t.telnyxStatusEingang({ CallSid: "root-" + i, CallStatus: status, From: process.env.TELNYX_NUMMER, To: "+4915112345678", ConnectionId: "test-app", ...extra });
    await assert.rejects(root(0, "in-progress", { To: "+493012345678" }));
    await assert.rejects(root(0, "in-progress", { ConnectionId: "wrong-app" }));
    await assert.rejects(t.telnyxStatusEingang({ CallSid: "child", ParentCallSid: "root-1", CallStatus: "in-progress" }, ids[0]));
    await Promise.all([root(0, "in-progress"), root(0, "in-progress"), root(0, "ringing")]);
    let rows = (await client.query("SELECT * FROM lukas_messages")).rows;
    assert.equal(rows.length, 1, "Duplicate/concurrent callbacks create only one chat notification");
    await t.telnyxStatusEingang({ CallSid: "child-0", ParentCallSid: "root-0", CallStatus: "in-progress" }, ids[0]);
    await Promise.all([t.aktualisiereAnruf(ids[0], { liveBereit: true }), root(1, "busy")]);
    assert.equal((await client.query("SELECT ergebnis FROM lukas_telefon_anrufe WHERE kontext_id=$1", [ids[0]])).rows[0].ergebnis, "verbunden");
    assert.equal((await client.query("SELECT ergebnis FROM lukas_telefon_anrufe WHERE kontext_id=$1", [ids[1]])).rows[0].ergebnis, "besetzt");
    await root(0, "completed", { CallDuration: "23" });
    await root(0, "ringing"); await root(0, "completed", { CallDuration: "23" });
    rows = (await client.query("SELECT * FROM lukas_messages ORDER BY id")).rows;
    assert.equal(rows.length, 4); assert.match(rows.at(-1).content, /23 Sekunden/);
    assert.equal((await client.query("SELECT ergebnis FROM lukas_telefon_anrufe WHERE kontext_id=$1", [ids[0]])).rows[0].ergebnis, "beendet");
    // New module/pool reads the persisted statuses, simulating a process restart.
    const restarted = join(dir, "restart.mjs");
    await build({ stdin: { contents: 'export * from "./src/lib/telefon-status.ts"; export { erlaubterMithoerAnruf } from "./src/lib/telefon-mithoeren.ts"; export { pool } from "@workspace/db";', resolveDir: process.cwd(), loader: "ts" }, outfile: restarted, bundle: true, platform: "node", format: "esm", packages: "external", alias: { "@workspace/db": resolve("../../lib/db/src/index.ts") } });
    const restartedModule = await import(restarted); restartPool = restartedModule.pool;
    const report = JSON.parse(await restartedModule.telefonStatus());
    assert.equal(report.anrufe.find(r => r.id === ids[0]).status, "Anruf beendet");
    // Contacts: exact names before partial matches; duplicate names remain ambiguous.
    await client.query("INSERT INTO lukas_telefon_nummern(nummer,name,darf_angerufen_werden) VALUES ('491511111111','Max',true), ('491522222222','Max Muster',true), ('491533333333','Max Muster',false), ('491544444444','Maria   Müller',true), ('491555555555','100% Garten',true)");
    assert.equal((await t.findeTelefonKontakte("max")).length, 1);
    assert.equal((await t.findeTelefonKontakte("MAX MUSTER")).length, 2);
    assert.equal((await t.findeTelefonKontakte("Maria Müller"))[0].nummer, "491544444444");
    assert.equal((await t.findeTelefonKontakte("100%"))[0].name, "100% Garten");
    assert.equal((await t.findeTelefonKontakte("%" )).length, 1, "Wildcards are literal, not a match-all");
    assert.equal((await t.findeTelefonKontakte("Nicht vorhanden")).length, 0);
    assert.equal(JSON.parse(await t.telefonKontakte("Max Muster")).kontakte.length, 2);
    // A signed provider event still needs the original consent and exact call ID.
    const consentDate = new Date("2026-10-04T10:00:00Z");
    const recordingCall = await t.neuerVerfolgterAnruf("4915112345678", "Aufnahme", undefined,
      { aufnahmeZustimmung: true, aufnahmeQuelle: "homepage", aufnahmeBestaetigtAm: consentDate });
    await t.aktualisiereAnruf(recordingCall, { providerSid: "record-root" });
    const recording = { CallSid: "record-root", ConnectionId: "test-app", AccountSid: "11111111-1111-4111-8111-111111111111", RecordingSid: "22222222-2222-4222-8222-222222222222", RecordingStatus: "completed", RecordingDuration: "34" };
    await assert.rejects(t.telnyxAufnahmeEingang({ ...recording, CallSid: "wrong-call" }, recordingCall));
    await assert.rejects(t.telnyxAufnahmeEingang({ ...recording, ConnectionId: "wrong-app" }, recordingCall));
    await assert.rejects(t.telnyxAufnahmeEingang({ ...recording, CallSid: "root-0" }, ids[0]), /nicht zugeordnet/);
    await Promise.all([t.telnyxAufnahmeEingang(recording, recordingCall), t.telnyxAufnahmeEingang(recording, recordingCall)]);
    await t.telnyxAufnahmeEingang({ ...recording, RecordingStatus: "in-progress" }, recordingCall);
    await t.telnyxAufnahmeEingang({ ...recording, RecordingStatus: "absent" }, recordingCall);
    await assert.rejects(t.telnyxAufnahmeEingang({ ...recording, RecordingSid: "33333333-3333-4333-8333-333333333333" }, recordingCall));
    const savedRecording = (await client.query("SELECT * FROM lukas_telefon_anrufe WHERE kontext_id=$1", [recordingCall])).rows[0];
    assert.equal(savedRecording.aufnahme_status, "completed");
    assert.equal(savedRecording.aufnahme_dauer, 34);
    assert.equal(savedRecording.aufnahme_quelle, "homepage");
    assert.equal(savedRecording.aufnahme_bestaetigt_am.toISOString(), consentDate.toISOString());
    assert.equal(await t.ladeTelefonAufnahme(999999), null);
    const restartedReport = JSON.parse(await restartedModule.telefonStatus());
    assert.equal(restartedReport.anrufe.find(r => r.id === recordingCall).aufnahmeStatus, "completed");
    const liveDate = new Date("2026-10-04T10:00:00.123Z");
    const liveNumber = "491566666666";
    await client.query("INSERT INTO lukas_telefon_nummern(nummer,name,mithoeren_zustimmung,mithoeren_quelle,mithoeren_bestaetigt_am) VALUES ($1,'Live Test',true,'email',$2)", [liveNumber, liveDate]);
    const liveId = await t.neuerVerfolgterAnruf(liveNumber, "Live-Test", undefined, undefined,
      { mithoerenZustimmung: true, mithoerenQuelle: "email", mithoerenBestaetigtAm: liveDate });
    const liveCall = await t.erlaubterMithoerAnruf(liveId);
    assert.ok(liveCall, "Unique contact with matching written consent can be monitored");
    assert.equal(liveCall.aufnahmeZustimmung, false, "Listening consent does not enable recording");
    const { rows: [duplicateContact] } = await client.query("INSERT INTO lukas_telefon_nummern(nummer,name) VALUES ($1,'Duplicate Live Test') RETURNING id", [liveNumber]);
    assert.equal(await t.erlaubterMithoerAnruf(liveId), null, "Duplicate phone numbers do not authorize monitoring");
    await client.query("DELETE FROM lukas_telefon_nummern WHERE id=$1", [duplicateContact.id]);
    assert.ok(await t.erlaubterMithoerAnruf(liveId), "Removing the duplicate restores the unique consent match");
    await client.query("UPDATE lukas_telefon_nummern SET mithoeren_zustimmung=false WHERE nummer=$1", [liveNumber]);
    assert.equal(await t.erlaubterMithoerAnruf(liveId), null);
    assert.equal((await client.query("SELECT mithoeren_zustimmung FROM lukas_telefon_anrufe WHERE kontext_id=$1", [liveId])).rows[0].mithoeren_zustimmung, true, "Consent snapshot remains unchanged");
    const deletedChatCall = await t.neuerVerfolgterAnruf("493012345678", "Gelöschter Chat", chat.id);
    await client.query("DELETE FROM lukas_conversations WHERE id=$1", [chat.id]);
    await t.aktualisiereAnruf(deletedChatCall, { zielStatus: "failed" }); // Deleted chats don't abort callbacks.
    console.log("OK — Echtes Postgres: Migration, parallele Anrufe an dieselbe Nummer, Row Locks, Zuordnung, Chatmeldung, Neustart und gelöschter Chat.");
    console.log("OK — Echtes Postgres: Kontaktnamen, doppelte Namen, wörtliche Suche, Aufnahmezustimmung, Snapshot und doppelte/verspätete Aufnahmeereignisse.");
  }
} finally {
  if (pool) await pool.end();
  if (restartPool) await restartPool.end();
  if (client) { if (schema) await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end(); }
  if (oldUrl == null) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
  rmSync(dir, { recursive: true, force: true });
}
