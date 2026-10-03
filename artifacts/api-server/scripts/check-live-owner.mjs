import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";

const dir = mkdtempSync(join(process.cwd(), ".live-owner-check-"));
const previous = { token: process.env.LUKAS_API_TOKEN, nodeEnv: process.env.NODE_ENV };
const ownerToken = "owner-live-test-token";
const closeToken = "close-capability-for-owner-live-test-0123456789";
const privatePrompt = "Private owner instructions for a synthetic test.";
const offer = "v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n";
const session = { sdp: offer, sessionId: "live_owner_test", closeToken, model: "gpt-live-1", voice: "cedar" };
const state = { createCalls: [], closeCalls: [], debugEvents: [], session, privatePrompt, createError: null, closeError: null };
globalThis.__lukasLiveOwnerTest = state;
let server, checks = 0;
async function check(name, work) { await work(); checks++; console.log("  OK " + name); }
function restoreEnv(name, value) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
try {
  process.env.LUKAS_API_TOKEN = ownerToken; process.env.NODE_ENV = "test";
  const routeSource = readFileSync("src/routes/lukas.ts", "utf8"), names = new Set();
  for (const match of routeSource.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/g)) {
    if (!/^(@workspace\/|drizzle-orm$|\.\.\/lib\/)/.test(match[2])) continue;
    for (const specifier of match[1].split(",")) {
      const name = specifier.trim().split(/\s+as\s+/)[0];
      if (name) { assert.match(name, /^[A-Za-z_$][\w$]*$/); names.add(name); }
    }
  }
  const special = new Set(["logger", "recordDebugEvent", "buildSystemPrompt", "createLiveWebRtcSession", "closeLiveSession"]);
  const stub = join(dir, "adapters.mjs");
  writeFileSync(stub, [
    'const state = () => globalThis.__lukasLiveOwnerTest;',
    'export const logger = { error() {}, warn() {}, info() {} };',
    'export const recordDebugEvent = (...args) => state().debugEvents.push(args);',
    'export const buildSystemPrompt = async () => state().privatePrompt;',
    'export async function createLiveWebRtcSession(options) { const s = state(); s.createCalls.push(options); if (s.createError) throw s.createError; return { ...s.session }; }',
    'export async function closeLiveSession(id, token) { const s = state(); s.closeCalls.push({ id, token }); if (s.closeError) throw s.closeError; return id === s.session.sessionId && token === s.session.closeToken; }',
    ...[...names].filter(name => !special.has(name)).map(name => 'export const ' + name + ' = () => { throw new Error("Unexpected test service: ' + name + '"); };'),
  ].join("\n"));
  const out = join(dir, "owner-routes.mjs");
  await build({
    stdin: { contents: 'export { default as router } from "./src/routes/lukas.ts";\nexport { lukasAuth } from "./src/middlewares/auth.ts";', resolveDir: process.cwd(), sourcefile: "live-owner-test-entry.ts", loader: "ts" },
    outfile: out, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent",
    plugins: [{ name: "owner-live-test-adapters", setup(b) { b.onResolve({ filter: /^(@workspace\/|drizzle-orm$|\.\.\/lib\/)/ }, () => ({ path: stub })); } }],
  });
  const { router, lukasAuth } = await import(pathToFileURL(out).href);
  const app = express(); app.use(express.json({ limit: "96kb" })); app.use("/api", lukasAuth, router);
  app.use((err, _req, res, _next) => res.status(err.type === "entity.parse.failed" ? 400 : 500).json({ error: "Invalid request" }));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const base = "http://127.0.0.1:" + server.address().port + "/api";
  const createPath = "/lukas/live-session", closePath = createPath + "/" + session.sessionId + "/close";
  const request = (path, body, options = {}) => {
    const headers = { "Content-Type": "application/json" };
    if (options.auth !== false) headers.Authorization = "Bearer " + (options.token ?? ownerToken);
    return fetch(base + path, { method: "POST", headers, body: options.raw ?? JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  };
  await check("Owner auth protects creation and closing", async () => {
    for (const [path, body] of [[createPath, { sdp: offer }], [closePath, { closeToken }]]) {
      assert.equal((await request(path, body, { auth: false })).status, 401);
      assert.equal((await request(path, body, { token: "wrong-owner" })).status, 401);
    }
    assert.equal(state.createCalls.length, 0); assert.equal(state.closeCalls.length, 0);
  });
  await check("Missing owner token fails closed", async () => {
    delete process.env.LUKAS_API_TOKEN;
    try { assert.equal((await request(createPath, { sdp: offer })).status, 503); assert.equal(state.createCalls.length, 0); }
    finally { process.env.LUKAS_API_TOKEN = ownerToken; }
  });
  await check("Private tool-enabled session cannot be overridden by request fields", async () => {
    const response = await request(createPath, { sdp: offer, instructions: "attacker prompt", allowTools: false });
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), session);
    assert.deepEqual(state.createCalls.at(-1), { sdp: offer, instructions: privatePrompt, visibility: "private", allowTools: true });
  });
  await check("Invalid and oversized SDP never reach the provider", async () => {
    const before = state.createCalls.length;
    for (const body of [{}, { sdp: null }, { sdp: 42 }, { sdp: "" }, { sdp: "not SDP" }, [], { sdp: "v=0" + "x".repeat(63_998) }])
      assert.equal((await request(createPath, body)).status, 400);
    assert.equal((await request(createPath, null, { raw: '{"sdp":' })).status, 400);
    assert.equal(state.createCalls.length, before);
  });
  await check("Provider failures are sanitized and not cached", async () => {
    state.createError = new Error("Authorization: Bearer sk-test-live-secret " + privatePrompt);
    try {
      const response = await request(createPath, { sdp: offer });
      assert.equal(response.status, 502); assert.equal(response.headers.get("cache-control"), "no-store");
      assert.doesNotMatch(await response.text(), /sk-test-live|Authorization|Private owner instructions/);
      assert.equal(state.debugEvents.at(-1)[0], "live-session");
    } finally { state.createError = null; }
  });
  await check("Close capability validation and forwarding", async () => {
    const before = state.closeCalls.length;
    for (const body of [{}, { closeToken: 42 }, { closeToken: "x".repeat(31) }, { closeToken: "x".repeat(129) }])
      assert.equal((await request(closePath, body)).status, 400);
    assert.equal(state.closeCalls.length, before);
    const token = "wrong-capability-value-0123456789012345";
    assert.equal((await request(closePath, { closeToken: token })).status, 404);
    assert.deepEqual(state.closeCalls.at(-1), { id: session.sessionId, token });
    const response = await request(closePath, { closeToken });
    assert.equal(response.status, 204); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "");
    assert.deepEqual(state.closeCalls.at(-1), { id: session.sessionId, token: closeToken });
    assert.equal((await request(createPath + "/live_unknown/close", { closeToken })).status, 404);
  });
  await check("Close failure does not expose secrets", async () => {
    state.closeError = new Error("Bearer sk-test-live-secret");
    try {
      const response = await request(closePath, { closeToken });
      assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /sk-test-live|Bearer/);
    } finally { state.closeError = null; }
  });
  await check("Legacy endpoint cannot mint credentials", async () => {
    const before = state.createCalls.length;
    assert.equal((await request("/lukas/realtime-session", {})).status, 410);
    assert.equal(state.createCalls.length, before);
  });
  console.log("OK — Owner Live HTTP: " + checks + " groups with real auth and validation.");
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  restoreEnv("LUKAS_API_TOKEN", previous.token); restoreEnv("NODE_ENV", previous.nodeEnv);
  delete globalThis.__lukasLiveOwnerTest; rmSync(dir, { recursive: true, force: true });
}
