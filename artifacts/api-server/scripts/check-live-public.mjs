import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
const dir = mkdtempSync(join(process.cwd(), ".live-public-check-"));
const fixture = join(dir, "fixture.mjs"), output = join(dir, "route.mjs");
const state = {
  handlers: new Map(), calls: [], closes: [], promptCalls: 0, fail: false,
  session: { sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n", sessionId: "live-public-1",
    closeToken: "only-close-this-session-capability-0123456789", model: "gpt-live-1", voice: "cedar", internalSecret: "DO-NOT-RETURN" },
};
globalThis.__livePublicCheck = state;
writeFileSync(fixture, [
 'const state = globalThis.__livePublicCheck;',
 'export function Router() { return { post(path, handler) { state.handlers.set(path, handler); }, get() {} }; }',
 'export const db = {}; export const memoriesTable = {};',
 'export const desc = () => ({}); export const eq = () => ({}); export const openai = {};',
 'export async function buildPublicSystemPrompt() { state.promptCalls++; return "CURATED_PUBLIC_CONTEXT"; }',
 'export const anfrageVonWebsite = async () => ({});',
 'export const logger = { info() {}, warn() {}, error() {} };',
 'export const gleicherToken = () => false; export function recordDebugEvent() {}',
 'export async function createLiveWebRtcSession(options) { state.calls.push(options); if (state.fail) throw new Error("PRIVATE_UPSTREAM_SECRET"); return state.session; }',
 'export async function closeLiveSession(sessionId, closeToken) { state.closes.push({ sessionId, closeToken }); return sessionId === state.session.sessionId && closeToken === state.session.closeToken; }',
].join("\n"));
try {
  await build({ entryPoints: ["src/routes/public.ts"], bundle: true, format: "esm", platform: "node", outfile: output,
    plugins: [{ name: "public-live-fixtures", setup(b) {
      b.onResolve({ filter: /.*/ }, args => args.importer.endsWith("public.ts") ? { path: fixture } : undefined);
    }}],
  });
  await import(pathToFileURL(output).href);
  let sequence = 0;
  async function invoke(path, options = {}) {
    const handler = state.handlers.get(path); assert.ok(handler, "Route registered: " + path);
    const req = { body: options.body ?? {}, params: options.params ?? {},
      ip: options.ip ?? ("test-" + ++sequence), headers: options.headers ?? { origin: "https://issahareb.me" } };
    const res = { statusCode: 200, headers: {}, headersSent: false, destroyed: !!options.destroyed,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; this.headersSent = true; return this; },
      setHeader(name, value) { this.headers[name] = value; return this; },
      sendStatus(code) { this.statusCode = code; this.headersSent = true; return this; },
    };
    await handler(req, res); return res;
  }
  const sdp = state.session.sdp;
  for (const headers of [{}, { origin: "https://attacker.invalid" }]) {
    const res = await invoke("/public/live-session", { headers, body: { sdp } });
    check(res.statusCode === 403 && state.calls.length === 0, "Untrusted/missing origin cannot create");
  }
  for (const bad of [undefined, 12, "", "v=0\r\nm=video 9 RTP/AVP 96\r\n", sdp + "x".repeat(65536), sdp + "\0"]) {
    const res = await invoke("/public/live-session", { body: { sdp: bad } });
    check(res.statusCode === 400 && state.calls.length === 0, "Invalid SDP cannot consume a provider session");
  }
  let res = await invoke("/public/live-session", { body: {
    sdp, instructions: "PRIVATE_OVERRIDE", visibility: "private", allowTools: true, tools: ["shell"], model: "arbitrary",
  }});
  check(res.statusCode === 200 && res.headers["Cache-Control"] === "no-store", "SDP response cannot be cached");
  const sent = state.calls.at(-1);
  check(sent.visibility === "public" && sent.allowTools === false, "Browser cannot enable private context/tools");
  check(sent.instructions.includes("CURATED_PUBLIC_CONTEXT") && !sent.instructions.includes("PRIVATE_OVERRIDE"), "Only curated public prompt");
  check(sent.sdp === sdp && !Object.hasOwn(sent, "model") && !Object.hasOwn(sent, "tools"), "Request fields are selected");
  check(res.body.closeToken === state.session.closeToken && !JSON.stringify(res.body).includes("DO-NOT-RETURN") && !Object.hasOwn(res.body, "value"), "Explicit response excludes provider internals");
  const closePath = "/public/live-session/:sessionId/close";
  const closeOptions = { params: { sessionId: state.session.sessionId }, body: { closeToken: state.session.closeToken } };
  const beforeClose = state.closes.length;
  res = await invoke(closePath, { ...closeOptions, headers: { origin: "https://attacker.invalid" } });
  check(res.statusCode === 403 && state.closes.length === beforeClose, "Closing also requires widget origin");
  res = await invoke(closePath, { params: closeOptions.params, body: {} });
  check(res.statusCode === 400, "Close requires capability");
  res = await invoke(closePath, { ...closeOptions, body: { closeToken: "wrong-capability-01234567890123456789" } });
  check(res.statusCode === 404, "Wrong capability cannot close");
  check((await invoke(closePath, closeOptions)).statusCode === 204, "Correct capability closes");
  const destroyedCloses = state.closes.length;
  await invoke("/public/live-session", { body: { sdp }, destroyed: true });
  check(state.closes.length === destroyedCloses + 1, "Disconnected handshake closes remotely");
  state.fail = true; res = await invoke("/public/live-session", { body: { sdp } });
  check(res.statusCode === 502 && !JSON.stringify(res.body).includes("PRIVATE_UPSTREAM_SECRET"), "Provider errors sanitized");
  state.fail = false;
  const beforeLegacy = state.calls.length;
  res = await invoke("/public/realtime-session");
  check(res.statusCode === 410 && state.calls.length === beforeLegacy, "Legacy cannot mint credentials");
  const beforeRate = state.calls.length;
  for (let i = 0; i < 16; i++) res = await invoke("/public/live-session", { ip: "rate-limited", body: { sdp } });
  check(res.statusCode === 429 && state.calls.length === beforeRate + 15, "Public rate limit retained");

  const widgetSource = readFileSync("public/widget.js", "utf8");
  const pump = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
  function browser(options = {}) {
    const nodes = new Map(), timers = new Map(), requests = [], peers = [], windowEvents = new Map();
    let nextTimer = 0, micRequests = 0;
    const track = { enabled: true, stops: 0, stop() { this.stops++; } };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    class Element {
      constructor() {
        this.style = {}; this.children = []; this.events = new Map(); this.textContent = "";
        const classes = new Set();
        this.classList = {
          add: value => classes.add(value), remove: value => classes.delete(value),
          contains: value => classes.has(value),
          toggle(value, force) { if (force) classes.add(value); else classes.delete(value); },
        };
      }
      querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); }
      addEventListener(type, handler) { this.events.set(type, handler); }
      appendChild(child) { this.children.push(child); return child; }
      focus() {} setAttribute() {} pause() {} remove() { this.removed = true; }
      play() { return Promise.resolve(); }
      click() { this.events.get("click")?.({ preventDefault() {} }); }
    }
    class Channel {
      constructor() { this.readyState = "open"; this.events = new Map(); this.sent = []; }
      addEventListener(type, handler) { this.events.set(type, handler); }
      send(text) { this.sent.push(JSON.parse(text)); }
      emit(event) { this.events.get("message")?.({ data: JSON.stringify(event) }); }
      close() { this.readyState = "closed"; this.events.get("close")?.(); }
    }
    class Peer {
      constructor() { this.connectionState = "new"; peers.push(this); }
      createDataChannel() { this.channel = new Channel(); return this.channel; }
      addTrack() {}
      createOffer() { return Promise.resolve({ type: "offer", sdp }); }
      setLocalDescription(description) { this.localDescription = description; return Promise.resolve(); }
      setRemoteDescription(description) {
        this.remoteDescription = description; this.connectionState = "connected";
        this.onconnectionstatechange?.(); return Promise.resolve();
      }
      close() { this.connectionState = "closed"; this.onconnectionstatechange?.(); }
    }
    const doc = {
      currentScript: { src: "https://lukas.example/widget.js", dataset: { api: "https://lukas.example", voice: "agent" } },
      documentElement: { lang: "de" }, head: new Element(), body: new Element(), createElement: () => new Element(),
    };
    const win = {
      addEventListener(type, handler) { windowEvents.set(type, handler); },
      setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
      clearTimeout(id) { timers.delete(id); },
    };
    function fetchMock(url, init) {
      requests.push({ url, init });
      if (url.endsWith("/close")) return Promise.resolve({ ok: true, status: 204 });
      if (options.sessionPromise) return options.sessionPromise;
      return Promise.resolve({ ok: true, json: async () => state.session });
    }
    runInNewContext(widgetSource, {
      document: doc, window: win, navigator: { mediaDevices: { getUserMedia() {
        micRequests++; return options.micPromise || Promise.resolve(stream);
      }}}, fetch: fetchMock, RTCPeerConnection: Peer, MediaStream: class {}, Audio: Element, URL, Set, console,
    }, { filename: "widget.js" });
    return { nodes, requests, peers, track, stream, timers, windowEvents,
      micRequests: () => micRequests, click: selector => nodes.get(selector).click(),
      timer(ms) {
        const found = [...timers].find(([, timer]) => timer.ms === ms);
        assert.ok(found, "Timer exists: " + ms); timers.delete(found[0]); found[1].fn();
      },
      messages: () => nodes.get(".lukas-msgs").children.map(node => node.textContent),
    };
  }
  let page = browser(); page.click(".lukas-btn");
  check(page.requests.length === 0 && page.micRequests() === 0, "Panel opening creates no session or mic request");
  page.click(".lukas-mic"); check(page.micRequests() === 1, "Microphone requested during click");
  await pump();
  check(page.requests.length === 1 && page.requests[0].url.endsWith("/api/public/live-session"), "SDP through own server");
  const startRequest = page.requests[0];
  check(Object.keys(JSON.parse(startRequest.init.body)).join() === "sdp" && !startRequest.init.headers.Authorization, "Browser sends no key/config");
  check(page.peers[0].remoteDescription.sdp === state.session.sdp, "Peer receives answer");
  const channel = page.peers[0].channel; channel.emit({ type: "session.started" });
  for (const event of [
    { type: "session.output_transcript.delta", event_id: "out-1", delta: "Guten ", start_ms: 0, end_ms: 100 },
    { type: "session.output_transcript.delta", event_id: "out-2", delta: "Tag", start_ms: 100, end_ms: 200 },
    { type: "session.output_transcript.delta", event_id: "out-2", delta: "Tag", start_ms: 100, end_ms: 200 },
    { type: "session.input_transcript.delta", event_id: "in-1", delta: "Hallo Lukas", start_ms: 300, end_ms: 500 },
    { type: "response.output_audio_transcript.done", transcript: "OLD_REALTIME_EVENT" },
  ]) channel.emit(event);
  check(page.messages().includes("Guten Tag") && !page.messages().includes("Guten TagTag"), "Transcript appended once");
  check(page.messages().includes("Hallo Lukas") && !page.messages().includes("OLD_REALTIME_EVENT"), "Live events only");
  check(page.track.enabled, "Microphone stays open while model speaks");
  page.click(".lukas-close");
  check(page.track.stops === 1 && page.peers[0].connectionState === "closed", "Panel close releases resources");
  check(channel.sent.some(event => event.type === "session.close"), "Started session receives Live close");
  check(page.requests.at(-1).url.endsWith("/live-public-1/close") && JSON.parse(page.requests.at(-1).init.body).closeToken === state.session.closeToken, "Close capability sent");
  page = browser(); page.click(".lukas-mic"); await pump(); page.timer(180000); await pump();
  check(page.track.stops === 1 && page.requests.at(-1).url.endsWith("/close"), "Three-minute browser limit");
  const permission = deferred(); page = browser({ micPromise: permission.promise });
  page.click(".lukas-mic"); page.click(".lukas-close"); permission.resolve(page.stream); await pump();
  check(page.track.stops === 1 && page.requests.length === 0 && page.peers.length === 0, "Late permission cannot reactivate");
  const negotiation = deferred(); page = browser({ sessionPromise: negotiation.promise });
  page.click(".lukas-mic"); await pump(); page.click(".lukas-close");
  negotiation.resolve({ ok: true, json: async () => state.session }); await pump();
  check(page.requests.length === 2 && page.requests.at(-1).url.endsWith("/close") && !page.peers[0].remoteDescription, "Late handshake closed remotely");
  page = browser(); page.click(".lukas-mic"); await pump(); page.windowEvents.get("pagehide")(); await pump();
  check(page.track.stops === 1 && page.requests.at(-1).init.keepalive === true, "Navigation releases resources");
  check(page.peers[0].channel.sent.length === 0, "No channel commands before session.started");
  page = browser(); page.click(".lukas-mic"); await pump();
  page.peers[0].connectionState = "failed"; page.peers[0].onconnectionstatechange(); await pump();
  check(page.track.stops === 1 && page.requests.at(-1).url.endsWith("/close"), "Failed WebRTC also closes remote session");
  console.log("OK — Public GPT Live: " + checks + " routing/privacy/browser checks.");
} finally { delete globalThis.__livePublicCheck; rmSync(dir, { recursive: true, force: true }); }
