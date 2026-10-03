/** Real worker entry points, inert adapters and virtual timers. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(process.cwd(), ".background-pause-check-"));
const envNames = ["LUKAS_BACKGROUND_PAUSED", "LUKAS_AUTONOMY_ENABLED", "LUKAS_HEILUNG_ENABLED"];
const previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
const originals = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval, clearTimeout: globalThis.clearTimeout, clearInterval: globalThis.clearInterval, fetch: globalThis.fetch };
const state = { calls: [] };
globalThis.__backgroundPauseTest = state;
const scheduled = [];
const activeTimers = new Set();
let checks = 0;
const files = [
  ["autonomy", "autonomy.ts", "startAutonomy", "stopAutonomy", "runAutonomyCycle"],
  ["moltbook", "moltbook-worker.ts", "startMoltbookWorker", "stopMoltbookWorker", "runMoltbookCycle"],
  ["healing", "selbstheilung.ts", "startSelbstheilung", "stopSelbstheilung", "runSelbstheilung"],
  ["consolidation", "consolidation-worker.ts", "startConsolidationWorker", "stopConsolidationWorker", "runConsolidation"],
];
async function check(name, work) { await work(); checks++; console.log("  OK " + name); }
function fakeTimer(kind) {
  return (callback, delay, ...args) => {
    const handle = { kind, callback, delay, args, unref() { return this; }, ref() { return this; } };
    scheduled.push(handle); activeTimers.add(handle); return handle;
  };
}
try {
  const names = new Set();
  const dependencies = new Set();
  for (const file of [...files.map(row => row[1]), "reflection.ts"]) {
    const source = readFileSync(join("src/lib", file), "utf8");
    for (const match of source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/g)) {
      if (/(?:^|\/)background-pause(?:\.ts)?$/.test(match[2])) continue;
      dependencies.add(match[2]);
      for (const entry of match[1].split(",")) {
        const specifier = entry.trim();
        if (!specifier || /^type\s/.test(specifier)) continue;
        const name = specifier.split(/\s+as\s+/)[0];
        assert.match(name, /^[A-Za-z_$][\w$]*$/); names.add(name);
      }
    }
  }
  const stub = join(dir, "services.mjs");
  const special = new Set(["logger", "moltbookEnabled", "LUKAS_SOUL", "DEFAULT_STATUS"]);
  writeFileSync(stub, [
    'function forbidden(name) { globalThis.__backgroundPauseTest.calls.push(name); throw new Error("Unexpected background service: " + name); }',
    'function blocked(name) { return new Proxy(function() { return forbidden(name); }, { get(_target, property) { return forbidden(name + "." + String(property)); } }); }',
    'export const logger = { info() {}, warn() {}, error() {}, debug() {} };',
    'export const moltbookEnabled = () => true;',
    'export const LUKAS_SOUL = "synthetic test soul";',
    'export const DEFAULT_STATUS = { mood: "curious", energy: "normal" };',
    ...[...names].filter(name => !special.has(name)).map(name => 'export const ' + name + ' = blocked(' + JSON.stringify(name) + ');'),
  ].join("\n"));
  const out = join(dir, "workers.mjs");
  const entry = [
    ...files.map(([alias, file]) => 'export * as ' + alias + ' from "./src/lib/' + file + '";'),
    'export * as reflection from "./src/lib/reflection.ts";',
    'export { backgroundPaused } from "./src/lib/background-pause.ts";',
  ].join("\n");
  await build({
    stdin: { contents: entry, sourcefile: "background-pause-test-entry.ts", resolveDir: process.cwd(), loader: "ts" },
    outfile: out, bundle: true, format: "esm", platform: "node", logLevel: "silent",
    plugins: [{ name: "background-service-isolation", setup(b) {
      b.onResolve({ filter: /.*/ }, args => dependencies.has(args.path) ? { path: stub } : undefined);
    } }],
  });
  process.env.LUKAS_BACKGROUND_PAUSED = "true";
  process.env.LUKAS_AUTONOMY_ENABLED = "true";
  process.env.LUKAS_HEILUNG_ENABLED = "true";
  globalThis.setTimeout = fakeTimer("timeout");
  globalThis.setInterval = fakeTimer("interval");
  globalThis.clearTimeout = handle => { activeTimers.delete(handle); };
  globalThis.clearInterval = handle => { activeTimers.delete(handle); };
  globalThis.fetch = async () => { state.calls.push("fetch"); throw new Error("Network is forbidden in background-pause tests"); };
  const modules = await import(pathToFileURL(out).href);
  await check("Pause parses explicit true and is read dynamically", async () => {
    for (const value of ["true", " TRUE ", "TrUe"]) {
      process.env.LUKAS_BACKGROUND_PAUSED = value; assert.equal(modules.backgroundPaused(), true);
    }
    for (const value of ["false", "", "yes", "1"]) {
      process.env.LUKAS_BACKGROUND_PAUSED = value; assert.equal(modules.backgroundPaused(), false);
    }
    delete process.env.LUKAS_BACKGROUND_PAUSED; assert.equal(modules.backgroundPaused(), false);
    process.env.LUKAS_BACKGROUND_PAUSED = "true";
  });
  await check("Importing paused workers starts no work", async () => {
    assert.deepEqual(state.calls, []); assert.equal(scheduled.length, 0);
  });
  for (const [alias, , start, , cycle] of files) {
    await check(alias + " startup schedules nothing while globally paused", async () => {
      modules[alias][start]();
      assert.equal(scheduled.length, 0); assert.deepEqual(state.calls, []);
    });
    await check(alias + " direct cycle performs no DB/model/service work while paused", async () => {
      await modules[alias][cycle]();
      assert.deepEqual(state.calls, []); assert.equal(scheduled.length, 0);
    });
  }
  await check("Automatic reflection after a chat is paused before DB access", async () => {
    modules.reflection.maybeReflect();
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(state.calls, []); assert.equal(scheduled.length, 0);
  });
  await check("Direct non-forced reflection is also paused", async () => {
    assert.equal(await modules.reflection.runReflection(false), null);
    assert.equal(await modules.reflection.runReflection(), null);
    assert.deepEqual(state.calls, []);
  });
  await check("Explicit manual reflection is not disabled by the background flag", async () => {
    await assert.rejects(modules.reflection.runReflection(true), /Unexpected background service: db\.select/);
    assert.deepEqual(state.calls, ["db.select"]); state.calls.length = 0;
  });
  process.env.LUKAS_BACKGROUND_PAUSED = "false";
  for (const [alias, , start, stop] of files) {
    await check(alias + " can start after unpausing and stop clears both timers", async () => {
      const before = scheduled.length; modules[alias][start]();
      const added = scheduled.slice(before);
      assert.equal(added.length, 2);
      assert.deepEqual(added.map(timer => timer.kind).sort(), ["interval", "timeout"]);
      assert.equal(activeTimers.size, 2); modules[alias][stop]();
      assert.equal(activeTimers.size, 0, "Startup timeout and recurring interval must both be cancelled");
      assert.deepEqual(state.calls, []);
    });
  }
  await check("Interactive Live remains independent of background pause", async () => {
    const source = readFileSync("src/lib/ai/live-session.ts", "utf8");
    assert.doesNotMatch(source, /LUKAS_BACKGROUND_PAUSED|backgroundPaused\s*\(/);
  });
  console.log("OK — Background pause: " + checks + " checks; no autonomous timers or service calls.");
} finally {
  Object.assign(globalThis, originals);
  for (const name of envNames) {
    if (previousEnv[name] === undefined) delete process.env[name];
    else process.env[name] = previousEnv[name];
  }
  delete globalThis.__backgroundPauseTest;
  rmSync(dir, { recursive: true, force: true });
}
