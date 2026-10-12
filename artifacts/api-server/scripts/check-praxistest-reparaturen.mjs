import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".praxis-check-"));
try {
  const stub = join(dir, "db.mjs");
  writeFileSync(stub, `
    export const verbrauchAuftraege = { id: "id", name: "auftraege" };
    export const verbrauchAufrufe = { name: "aufrufe" };
    export const logger = { info() {}, warn() {}, error() {} };
    globalThis.__rows = { auftraege: new Map(), aufrufe: [] };
    export const db = { insert: table => ({ values: row => {
      if (table.name === "aufrufe") { globalThis.__rows.aufrufe.push(row); return Promise.resolve(); }
      return { onConflictDoUpdate: async () => {
        if (row.status === "laeuft") await new Promise(r => setTimeout(r, 15));
        globalThis.__rows.auftraege.set(row.id, row);
      } };
    } }) };
  `);
  const entry = join(dir, "entry.ts");
  writeFileSync(entry, `
    export * from "../src/lib/memory-relevance";
    export * from "../src/lib/werkzeug-auswahl";
    export * from "../src/lib/ai/context-window";
    export * from "../src/lib/ai/model-router";
    export * from "../src/lib/verbrauch-auftrag";
    export * from "../src/lib/verbrauch-quelle";
  `);
  await build({ entryPoints: [entry], outfile: join(dir, "test.mjs"), bundle: true, format: "esm", platform: "node",
    alias: { "@workspace/db": stub }, plugins: [{ name: "logger", setup(b) {
      b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: stub }));
    } }], logLevel: "silent" });
  const m = await import(join(dir, "test.mjs"));

  assert.equal(m.relevantEnough("Nenne belegte Informationen zu TaxiBB Essen", "Issa betreibt ein Robotikprojekt und Cully Hill Boys."), false);
  assert.equal(m.relevantEnough("Nenne belegte Informationen zu TaxiBB Essen", "Domain: taxibbessen.de"), true);
  assert.equal(m.relevantEnough("TaxiBB Essen", "Robotik und Cully Hill Boys sind Projekte in Essen"), false);
  assert.equal(m.relevantEnough("TaxiBB Essen", "TaxiBot ist ein anderes Projekt", 0.31), false);
  assert.ok(m.boundedMemory(Array.from({ length: 20 }, () => ({ text: "a".repeat(5000) }))).length <= 6000);
  assert.match(m.boundedMemory([{ text: "a".repeat(5000) }]), /Auszug/);

  const names = ["query_memory", "mcp_find_tool", "mcp_call", "web_search", "fetch_url", "browse_page", "browser_do", "execute_command", "execute_on_host", "email_search", "email_read", "email_send", "github_read_path", "mcp__higgsfield__get_workflow_instructions"];
  const tools = names.map(name => ({ type: "function", function: { name, parameters: { type: "object", properties: {} } } }));
  const selected = task => m.waehleWerkzeuge(tools, task).map(t => t.function.name);
  assert.ok(selected("Was kostet die Jahreskarte im Grugapark 2026? Quelle bitte").includes("web_search"));
  assert.ok(!selected("Was kostet die Jahreskarte im Grugapark 2026? Quelle bitte").some(n => n.startsWith("mcp__")));
  assert.ok(!selected("Lies meine neueste E-Mail von GitHub").includes("github_read_path"));
  assert.ok(selected("Lies meine neueste E-Mail von GitHub").includes("mcp_find_tool"));
  const filtered = m.werkzeugeNachFehler(tools, "browse_page", new Error("All configured authentication methods failed")).map(t => t.function.name);
  assert.ok(!filtered.includes("browser_do") && !filtered.includes("execute_command"));
  assert.ok(filtered.includes("fetch_url"));
  assert.ok(m.zugangsFehler("email_search", new Error("E-Mail-Zugang fehlt: EMAIL_USER")));
  assert.ok(selected("Prüfe die SSH-Verbindung einmal").includes("execute_on_host"));
  const afterMailFailure = m.werkzeugeNachFehler(tools, "email_search", new Error("EMAIL_USER fehlt")).map(t => t.function.name);
  assert.ok(afterMailFailure.includes("execute_on_host"), "a blocked mailbox does not prevent the independent SSH check");
  assert.ok(!afterMailFailure.some(n => n.startsWith("email_")), "same mailbox cannot be retried through a sibling tool");

  process.env.LUKAS_CONTEXT_MAX_CHARS = "12000";
  const history = [{ role: "system", content: "S".repeat(16000) },
    { role: "user", content: "ALTE FRAGE" }, { role: "assistant", content: "ALT" },
    { role: "user", content: "Plane Portfolio, Demo und Outreach" }, { role: "assistant", content: "PLAN: Demo am Dienstag" },
    { role: "user", content: "Kürze ihn und verschiebe die Demo auf Donnerstag" }];
  const packed = m.fitLukasContext(history);
  assert.ok(packed.some(x => x.content === "PLAN: Demo am Dienstag"));
  assert.ok(!packed.some(x => x.content === "ALTE FRAGE"));
  assert.equal(history.length, 6, "archive input remains intact");
  delete process.env.LUKAS_CONTEXT_MAX_CHARS;
  const lookup = { userText: "Lies die Build- und Typecheck-Skripte aus package.json im Repo", usedTools: ["github_read_path"] };
  assert.equal(m.routeLukasModel(lookup).profile, m.routeLukasModel({ ...lookup, usedTools: [] }).profile);
  assert.equal(m.routeLukasModel({ userText: "Behebe den TypeScript-Fehler", usedTools: ["github_read_path"] }).profile, "code");

  const input = { route: { model: "test", provider: "openai" }, messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }], tools: [] };
  const call = (n, phase = "start") => m.messeModellAufruf(input, phase, async () => {
    await Promise.resolve(); m.merkeAufrufUsage({ eingabe: n, ausgabe: 2, cacheLesen: 8, cacheSchreiben: null });
  });
  await Promise.all([
    m.mitVerbrauchsAuftrag("chat", 71, async () => {
      await call(10);
      await m.mitVerbrauchsAuftrag("unteragent", undefined, () => call(20));
      await call(30, "antwort");
    }),
    m.mitVerbrauchsAuftrag("chat", 72, async () => {
      await call(100); m.auftragsStatus("blockiert");
      await assert.rejects(m.messeModellAufruf(input, "fallback", async () => { throw new Error("provider failed"); }));
    }),
  ]);
  await m.verbrauchLeeren();
  const rows = globalThis.__rows;
  const roots = [...rows.auftraege.values()].filter(a => !a.parentId);
  assert.equal(roots.length, 2, "concurrent requests have separate roots");
  const first = roots.find(a => a.conversationId === 71), second = roots.find(a => a.conversationId === 72);
  assert.equal(first.status, "antwort", "late start cannot overwrite completion");
  assert.equal(second.status, "blockiert");
  const child = [...rows.auftraege.values()].find(a => a.parentId);
  assert.equal(child.rootId, first.id); assert.equal(child.parentId, first.id);
  const firstCalls = rows.aufrufe.filter(c => c.rootId === first.id);
  assert.equal(firstCalls.length, 3); assert.equal(firstCalls.reduce((s,c) => s+c.eingabe+c.ausgabe+c.cacheLesen, 0), 90);
  assert.equal(rows.aufrufe.find(c => c.auftragId === child.id).quelle, "unteragent");
  const failed = rows.aufrufe.find(c => c.status === "fehler");
  assert.equal(failed.rootId, second.id); assert.equal(failed.eingabe, null, "missing usage is not zero");
  assert.ok(rows.aufrufe.every(c => c.cacheSchreiben === null));
  assert.equal(firstCalls[0].kontext.systemZeichen, 3);
  assert.ok(!JSON.stringify(rows.aufrufe).includes('"hi"'), "no prompt contents in telemetry");
  console.log("OK — Praxistest-Reparaturen: Projektfilter, begrenzter Kontext, Folgefrage, gezielte Werkzeuge, Zugangssperre, stabile Modellwahl und dauerhafte Auftrags-/Unteragentenmessung.");
} finally { rmSync(dir, { recursive: true, force: true }); }
