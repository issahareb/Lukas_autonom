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
    for (const table of ["lukas_conversations", "lukas_messages", "lukas_telefon_anrufe"]) {
      await client.query(baseline.match(new RegExp(`CREATE TABLE "${table}" \\([\\s\\S]*?\\n\\);`))[0]);
    }
    await client.query('ALTER TABLE lukas_messages ADD FOREIGN KEY (conversation_id) REFERENCES lukas_conversations(id) ON DELETE CASCADE');
    await client.query(readFileSync("../../lib/db/migrations/0003_aspiring_tenebrous.sql", "utf8"));
    const url = new URL(process.env.BENCH_DATABASE_URL); url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.href;
    const real = join(dir, "real.mjs");
    await build({ stdin: { contents: 'export * from "./src/lib/telefon-status.ts"; export { pool } from "@workspace/db";', resolveDir: process.cwd(), loader: "ts" },
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
    await build({ stdin: { contents: 'export * from "./src/lib/telefon-status.ts"; export { pool } from "@workspace/db";', resolveDir: process.cwd(), loader: "ts" }, outfile: restarted, bundle: true, platform: "node", format: "esm", packages: "external", alias: { "@workspace/db": resolve("../../lib/db/src/index.ts") } });
    const restartedModule = await import(restarted); restartPool = restartedModule.pool;
    const report = JSON.parse(await restartedModule.telefonStatus());
    assert.equal(report.anrufe.find(r => r.id === ids[0]).status, "Anruf beendet");
    const deletedChatCall = await t.neuerVerfolgterAnruf("493012345678", "Gelöschter Chat", chat.id);
    await client.query("DELETE FROM lukas_conversations WHERE id=$1", [chat.id]);
    await t.aktualisiereAnruf(deletedChatCall, { zielStatus: "failed" }); // Deleted chats don't abort callbacks.
    console.log("OK — Echtes Postgres: Migration, parallele Anrufe an dieselbe Nummer, Row Locks, Zuordnung, Chatmeldung, Neustart und gelöschter Chat.");
  }
} finally {
  if (pool) await pool.end();
  if (restartPool) await restartPool.end();
  if (client) { if (schema) await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end(); }
  if (oldUrl == null) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
  rmSync(dir, { recursive: true, force: true });
}
