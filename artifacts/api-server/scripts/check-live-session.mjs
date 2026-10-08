import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
const directory = await mkdtemp(join(tmpdir(), "lukas-live-check-")), output = join(directory, "live-session.mjs");
const fixture = { sockets: [], requests: [], calls: [], logs: [], usage: [], failSockets: 0,
  failCreate: false, sequence: 0, answer: "Bestätigtes Ergebnis.", backend: null };
globalThis.__liveSessionTest = fixture;
const stubSources = {
  undici: [
    'const fixture = globalThis.__liveSessionTest;',
    'export class WebSocket extends EventTarget {',
    'static OPEN = 1; static CLOSED = 3;',
    'readyState = 0; bufferedAmount = 0; sent = [];',
    'constructor(url, options) { super(); this.url = String(url); this.options = options; fixture.sockets.push(this);',
    'if (fixture.failSockets > 0) { fixture.failSockets--; queueMicrotask(() => this.dispatchEvent(new Event("error"))); }',
    'else queueMicrotask(() => { if (this.readyState === 3) return; this.readyState = 1; this.dispatchEvent(new Event("open")); }); }',
    'send(data) { if (this.readyState !== 1) throw new Error("socket closed"); const event = JSON.parse(data); this.sent.push(event);',
    'if (event.type === "session.close") queueMicrotask(() => this.emit({ type: "session.closed", reason: "close_requested", usage: { seconds: 0 } })); }',
    'close(code = 1000, reason = "") { if (this.readyState === 3) return; this.readyState = 3; const event = new Event("close"); Object.assign(event, { code, reason, wasClean: code === 1000 }); queueMicrotask(() => this.dispatchEvent(event)); }',
    'emit(data) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) })); }',
    '}',
  ].join("\n"),
  "../live-verbrauch": 'export async function speichereLiveVerbrauch(input) { globalThis.__liveSessionTest.usage.push(input); }',
  "../logger": 'const record = (data, message) => globalThis.__liveSessionTest.logs.push({data, message}); export const logger = { info: record, warn: record, error: record };',
  "./sprach-sitzung": 'export const sprachModell = () => process.env.LUKAS_LIVE_MODEL || "gpt-live-1"; export const sprachStimme = () => process.env.LUKAS_LIVE_VOICE || "cedar";',
  "../lukas-brain": 'export async function runLukasTurn(options) { const fixture = globalThis.__liveSessionTest; fixture.calls.push(options); return fixture.backend ? await fixture.backend(options) : fixture.answer; }',
};
await build({
  entryPoints: [resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib/ai/live-session.ts")],
  outfile: output, bundle: true, platform: "node", target: "node22", format: "esm", logLevel: "silent",
  plugins: [{ name: "live-isolation", setup(builder) {
    builder.onResolve({ filter: /^(undici|\.\.\/live-verbrauch|\.\.\/logger|\.\/sprach-sitzung|\.\.\/lukas-brain)$/ },
      (args) => ({ path: args.path, namespace: "live-stub" }));
    builder.onLoad({ filter: /.*/, namespace: "live-stub" }, (args) => ({ contents: stubSources[args.path], loader: "js" }));
  } }],
});
const previous = { fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
const envKeys = ["OPENAI_PROJECT_ID", "OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_BASE_URL", "LUKAS_LIVE_MODEL", "LUKAS_LIVE_VOICE", "LUKAS_LIVE_MAX_SESSIONS"];
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
for (const key of envKeys) delete process.env[key];
const timers = new Map();
globalThis.setTimeout = (callback, milliseconds, ...args) => {
  const token = { unref() { return this; } };
  timers.set(token, { callback: () => callback(...args), milliseconds }); return token;
};
globalThis.clearTimeout = (token) => { timers.delete(token); };
globalThis.fetch = async (url, options) => {
  const request = { url: String(url), ...options, body: options.body ? JSON.parse(options.body) : undefined };
  fixture.requests.push(request);
  if (fixture.apiError) return Response.json({ error: fixture.apiError }, { status: 400 });
  if (request.url.endsWith("/live/sessions")) {
    if (fixture.failCreate) { fixture.failCreate = false; return new Response("untrusted provider details", { status: 500 }); }
    const id = "opaque_session_" + ++fixture.sequence;
    return Response.json({ session: { id }, transport: { type: "webrtc", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" } });
  }
  return new Response(null, { status: 204 });
};
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };
const fire = (milliseconds) => {
  const entry = [...timers].find(([, timer]) => timer.milliseconds === milliseconds);
  assert.ok(entry, "expected active timer: " + milliseconds); timers.delete(entry[0]); entry[1].callback();
};
const offer = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const createOptions = { sdp: offer, instructions: "PRIVATE_BACKEND_ONLY", visibility: "private", allowTools: true };
const socketFor = (id) => fixture.sockets.filter((socket) => socket.url.includes("/" + id + "/attach")).at(-1);
let serial = 0;
const input = (socket, delta) => socket.emit({ type: "session.input_transcript.delta", event_id: "event_" + ++serial, delta, start_ms: serial * 10, end_ms: serial * 10 + 10 });
const delegate = (socket, id) => socket.emit({ type: "session.delegation.created", event_id: "event_" + ++serial, offset_ms: serial * 10 + 100,
  delegation: { id, type: "delegation", target: "client", task: "UNTRUSTED_METADATA_NOT_USER_TEXT" } });
let api;
try {
  api = await import(pathToFileURL(output).href);
  assert.equal(fixture.requests.length, 0);
  await assert.rejects(api.createLiveWebRtcSession(createOptions), /API-Schlüssel/);
  assert.equal(fixture.requests.length, 0); process.env.OPENAI_API_KEY = "fake-test-key-do-not-use";
  await assert.rejects(api.createLiveWebRtcSession({ ...createOptions, sdp: "invalid" }), /Audio-SDP/);
  await assert.rejects(api.createLiveWebRtcSession({ ...createOptions, sdp: offer + "m=video 9 UDP/TLS/RTP/SAVPF 96\r\n" }), /Audio-SDP/);
  process.env.LUKAS_LIVE_MODEL = "gpt-realtime-2.1";
  await assert.rejects(api.createLiveWebRtcSession(createOptions), /anderes Protokoll/);
  delete process.env.LUKAS_LIVE_MODEL; assert.equal(fixture.requests.length, 0);

  process.env.OPENAI_PROJECT_ID = "invalid-project";
  await assert.rejects(api.createLiveWebRtcSession(createOptions), /OpenAI-Projekt/);
  assert.equal(fixture.requests.length, 0);
  process.env.OPENAI_PROJECT_ID = "proj_phone_test";
  const first = await api.createLiveWebRtcSession(createOptions);
  assert.equal(first.model, "gpt-live-1"); assert.equal(first.voice, "cedar");
  assert.match(first.closeToken, /^[a-f0-9]{64}$/); assert.ok(!JSON.stringify(first).includes("fake-test-key"));
  const request = fixture.requests.at(-1), socket = socketFor(first.sessionId);
  assert.equal(request.headers.Authorization, "Bearer fake-test-key-do-not-use");
  assert.equal(request.headers["OpenAI-Project"], "proj_phone_test");
  assert.equal(socket.options.headers["OpenAI-Project"], "proj_phone_test");
  assert.equal(request.body.session.delegation.type, "client"); assert.equal(request.body.session.store, false);
  assert.deepEqual(request.body.session.audio, { output: { voice: "cedar" } });
  assert.ok(!request.body.session.instructions.includes("PRIVATE_BACKEND_ONLY"));
  assert.deepEqual(request.body.session.client.data_channel.allowed_client_events, ["session.close"]);
  assert.ok(request.body.session.client.data_channel.allowed_server_events.some((event) => event.type === "session.started"));
  assert.ok(!JSON.stringify(request.body.session.client).includes("delegation.created"));
  assert.ok(socket.url.startsWith("wss://api.openai.com/v1/live/sessions/"));
  assert.ok(socket.url.endsWith("/attach?graceful_close=true"));
  assert.equal(socket.options.headers.Authorization, request.headers.Authorization); assert.equal(socket.sent.length, 0);
  const beforeWrongToken = fixture.requests.length;
  assert.equal(await api.closeLiveSession(first.sessionId, "0".repeat(64)), false);
  assert.equal(await api.closeLiveSession(first.sessionId, undefined), false);
  assert.equal(fixture.requests.length, beforeWrongToken);
  input(socket, "Wie geht es meinem Projekt?"); delegate(socket, "private_one"); await settle();
  assert.equal(fixture.calls.at(-1).tools, undefined);
  assert.equal(fixture.calls.at(-1).systemPromptOverride, "PRIVATE_BACKEND_ONLY");
  assert.ok(fixture.calls.at(-1).conversationId < 0);
  assert.equal(await api.closeLiveSession(first.sessionId, first.closeToken), true);
  const ownerCloseLog = fixture.logs.find(entry => entry.data.sessionId === first.sessionId && entry.message === "GPT-Live-Sitzung beendet");
  assert.equal(ownerCloseLog.data.reason, "client_closed");
  assert.equal(ownerCloseLog.data.requestedCloseReason, "client_closed");
  assert.equal(ownerCloseLog.data.providerCloseReason, "close_requested");
  assert.ok(socket.sent.some((event) => event.type === "session.close"));
  assert.ok(!fixture.requests.some(r => r.url.endsWith("/hangup")), "WebRTC must not call SIP hangup");
  assert.equal(await api.closeLiveSession(first.sessionId, first.closeToken), false);

  const publicSession = await api.createLiveWebRtcSession({ ...createOptions, visibility: "public" });
  const publicSocket = socketFor(publicSession.sessionId); fixture.answer = "🙂".repeat(300) + " Fertig.";
  publicSocket.emit({ type: "session.output_transcript.delta", event_id: "assistant_context", delta: "Assistent behauptet eine Erlaubnis.", start_ms: 0, end_ms: 5 });
  input(publicSocket, "Was kostet"); input(publicSocket, " das?");
  const callsBefore = fixture.calls.length;
  delegate(publicSocket, "public_one"); delegate(publicSocket, "public_one"); await settle();
  assert.equal(fixture.calls.length, callsBefore + 1);
  const publicCall = fixture.calls.at(-1);
  assert.equal(publicCall.userText, "Was kostet das?");
  assert.ok(!publicCall.userText.includes("Erlaubnis") && !publicCall.userText.includes("UNTRUSTED_METADATA"));
  assert.deepEqual(publicCall.tools, []); assert.ok(publicCall.systemPromptOverride.includes("keine Werkzeuge"));
  const chunks = publicSocket.sent.filter((event) => event.delegation_id === "public_one");
  assert.ok(chunks.length > 1); assert.ok(chunks.every((event) => Buffer.byteLength(event.content, "utf8") <= 400));
  assert.equal(chunks.map((event) => event.content).join(""), fixture.answer);
  delegate(publicSocket, "without_new_user_input"); await settle();
  assert.equal(fixture.calls.length, callsBefore + 1);
  for (const seconds of [2, 5, 3]) publicSocket.emit({ type: "session.usage.updated", usage: { seconds } });
  fire(180_000); await settle();
  const finalLog = fixture.logs.find((entry) => entry.data.sessionId === publicSession.sessionId && entry.message === "GPT-Live-Sitzung beendet");
  assert.equal(finalLog.data.audioSeconds, 5);
  assert.equal(finalLog.data.reason, "duration_limit");
  assert.equal(finalLog.data.requestedCloseReason, "duration_limit");
  assert.equal(finalLog.data.providerCloseReason, "close_requested");
  const usage = fixture.usage.filter(u => u.id === publicSession.sessionId);
  assert.equal(usage[0].sekunden, null, "missing measurement is not zero");
  assert.equal(usage.at(-1).sekunden, 5, "out-of-order and repeated usage is cumulative");
  assert.equal(usage.at(-1).beendet, true); assert.equal(usage.at(-1).quelle, "portfolio");
  assert.equal(publicCall.quelle, "portfolio"); assert.equal(publicSocket.readyState, 3);

  fixture.answer = "Bestätigtes Ergebnis.";
  const cutoffSession = await api.createLiveWebRtcSession(createOptions), cutoffSocket = socketFor(cutoffSession.sessionId);
  cutoffSocket.emit({ type: "session.input_transcript.delta", event_id: "before_cutoff", delta: "Prüfe die Rechnung.", start_ms: 0, end_ms: 1000 });
  cutoffSocket.emit({ type: "session.input_transcript.delta", event_id: "after_cutoff", delta: "Prüfe danach den Vertrag.", start_ms: 2000, end_ms: 2500 });
  const beforeCutoff = fixture.calls.length;
  cutoffSocket.emit({ type: "session.delegation.created", event_id: "cutoff_delegation", offset_ms: 1200,
    delegation: { id: "cutoff_one", type: "delegation", target: "client" } }); await settle();
  assert.equal(fixture.calls.length, beforeCutoff + 1); assert.equal(fixture.calls.at(-1).userText, "Prüfe die Rechnung.");
  assert.ok(!JSON.stringify(fixture.calls.at(-1).history).includes("Vertrag"));
  cutoffSocket.emit({ type: "session.delegation.created", event_id: "next_cutoff_delegation", offset_ms: 3000,
    delegation: { id: "cutoff_two", type: "delegation", target: "client" } }); await settle();
  assert.equal(fixture.calls.length, beforeCutoff + 2); assert.equal(fixture.calls.at(-1).userText, "Prüfe danach den Vertrag.");
  await api.closeLiveSession(cutoffSession.sessionId, cutoffSession.closeToken);

  const cancelSession = await api.createLiveWebRtcSession(createOptions), cancelSocket = socketFor(cancelSession.sessionId);
  let runningSignal;
  fixture.backend = (options) => new Promise((_resolve, reject) => {
    runningSignal = options.signal;
    const cancel = () => { const error = new Error("Cancelled"); error.name = "AbortError"; reject(error); };
    if (options.signal.aborted) cancel(); else options.signal.addEventListener("abort", cancel, { once: true });
  });
  const beforeCancel = fixture.calls.length;
  input(cancelSocket, "Starte die Recherche."); delegate(cancelSocket, "cancel_one"); await settle();
  assert.equal(fixture.calls.length, beforeCancel + 1);
  input(cancelSocket, "Danach die zweite Recherche."); delegate(cancelSocket, "cancel_two");
  await api.closeLiveSession(cancelSession.sessionId, cancelSession.closeToken); await settle();
  assert.ok(runningSignal.aborted); assert.equal(fixture.calls.length, beforeCancel + 1);
  assert.ok(!cancelSocket.sent.some((event) => event.type === "session.commentary.append")); fixture.backend = null;

  const reconnectSession = await api.createLiveWebRtcSession(createOptions);
  const requestsBefore = fixture.requests.length;
  const actualNow = Date.now;
  let reconnectNow = actualNow();
  Date.now = () => reconnectNow;
  try {
  for (let outage = 0; outage < 4; outage++) {
    reconnectNow += 10_001;
    const oldSocket = socketFor(reconnectSession.sessionId);
    oldSocket.close(); await settle(); fire(500); await settle();
    const recovered = socketFor(reconnectSession.sessionId);
    assert.notEqual(recovered, oldSocket, "Each independent outage reconnects");
    assert.equal(recovered.readyState, 1);
    assert.equal(fixture.requests.length, requestsBefore, "Recovery must not create another paid session");
    assert.equal(recovered.sent.some(event => event.type === "session.close"), false);
  }
  } finally { Date.now = actualNow; }
  const afterRecovery = socketFor(reconnectSession.sessionId);
  const callsBeforeRecovery = fixture.calls.length;
  input(afterRecovery, "Prüfe den Stand nach der Wiederverbindung.");
  delegate(afterRecovery, "after_four_recoveries"); await settle();
  assert.equal(fixture.calls.length, callsBeforeRecovery + 1);
  assert.ok(afterRecovery.sent.some(event => event.delegation_id === "after_four_recoveries"));
  await api.closeLiveSession(reconnectSession.sessionId, reconnectSession.closeToken);
  const recoveredClose = fixture.logs.find(entry => entry.data.sessionId === reconnectSession.sessionId && entry.message === "GPT-Live-Sitzung beendet");
  assert.equal(recoveredClose.data.reconnects, 4);

  const failedReconnect = await api.createLiveWebRtcSession(createOptions);
  const requestsBeforeFailedReconnect = fixture.requests.length;
  socketFor(failedReconnect.sessionId).close(1006, "untrusted reconnect text");
  await settle(); fixture.failSockets = 3;
  for (const delay of [500, 1000, 2000]) { fire(delay); await settle(); }
  const failedReconnectLog = fixture.logs.find(entry => entry.data.sessionId === failedReconnect.sessionId && entry.message === "GPT-Live-Sitzung beendet");
  assert.ok(failedReconnectLog, "Consecutive failed recovery must remain bounded");
  assert.equal(failedReconnectLog.data.reason, "sideband_reconnect_limit");
  assert.equal(failedReconnectLog.data.requestedCloseReason, "sideband_reconnect_limit");
  assert.equal(failedReconnectLog.data.providerCloseReason, "close_requested");
  assert.equal(fixture.requests.length, requestsBeforeFailedReconnect);
  assert.equal(await api.closeLiveSession(failedReconnect.sessionId, failedReconnect.closeToken), false);
  assert.equal([...timers.values()].some(timer => timer.milliseconds === 4000), false);

  for (const [providerReason, expectedReason] of [
    ["remote_hangup", "remote_hangup"], ["connection_lost", "connection_lost"],
    ["expired", "expired"], ["content", "content"], ["secret close words", "unknown"], [undefined, null],
  ]) {
    const remote = await api.createLiveWebRtcSession(createOptions);
    socketFor(remote.sessionId).emit({ type: "session.closed", reason: providerReason, usage: { seconds: 7 } });
    await settle();
    const ended = fixture.logs.find(entry => entry.data.sessionId === remote.sessionId && entry.message === "GPT-Live-Sitzung beendet");
    assert.ok(ended); assert.equal(ended.data.reason, "provider_closed");
    assert.equal(ended.data.requestedCloseReason, null); assert.equal(ended.data.providerCloseReason, expectedReason);
    assert.equal(ended.data.audioSeconds, 7);
    assert.equal(await api.closeLiveSession(remote.sessionId, remote.closeToken), false);
    assert.equal(fixture.logs.filter(entry => entry.data.sessionId === remote.sessionId && entry.message === "GPT-Live-Sitzung beendet").length, 1);
    assert.equal(JSON.stringify(fixture.logs.filter(entry => entry.data.sessionId === remote.sessionId)).includes("secret close words"), false);
  }

  const privateTelemetry = await api.createLiveWebRtcSession(createOptions);
  const telemetrySocket = socketFor(privateTelemetry.sessionId);
  const privateFragments = ["secret input words", "secret output words", "secret event words", "secret close words", "secret error words"];
  telemetrySocket.emit({ type: "session.input_transcript.delta", event_id: privateFragments[2], delta: privateFragments[0], start_ms: 0, end_ms: 100 });
  telemetrySocket.emit({ type: "session.output_transcript.delta", event_id: "different " + privateFragments[2], delta: privateFragments[1], start_ms: 100, end_ms: 200 });
  telemetrySocket.close(1006, privateFragments[3]); await settle();
  const transportClose = fixture.logs.find(entry => entry.data.sessionId === privateTelemetry.sessionId && entry.message === "GPT-Live-Steuerverbindung geschlossen");
  assert.ok(transportClose); assert.equal(transportClose.data.code, 1006); assert.equal(transportClose.data.wasClean, false);
  fire(500); await settle();
  socketFor(privateTelemetry.sessionId).emit({ type: "error", event_id: "error " + privateFragments[2],
    error: { code: privateFragments[4], type: privateFragments[4], message: privateFragments[4], param: privateFragments[4] } });
  await settle();
  const telemetryClose = fixture.logs.find(entry => entry.data.sessionId === privateTelemetry.sessionId && entry.message === "GPT-Live-Sitzung beendet");
  assert.ok(telemetryClose); assert.equal(telemetryClose.data.reason, "provider_error");
  assert.equal(telemetryClose.data.requestedCloseReason, "provider_error");
  const telemetryText = JSON.stringify(fixture.logs.filter(entry => entry.data.sessionId === privateTelemetry.sessionId));
  for (const fragment of privateFragments) assert.equal(telemetryText.includes(fragment), false);
  assert.equal(await api.closeLiveSession(privateTelemetry.sessionId, privateTelemetry.closeToken), false);
  // A socket that opens then immediately fails has not recovered stably.
  const flapping = await api.createLiveWebRtcSession(createOptions);
  const beforeFlapping = fixture.requests.length;
  socketFor(flapping.sessionId).close(1006); await settle();
  for (const delay of [500, 1000, 2000]) {
    fire(delay); await settle();
    socketFor(flapping.sessionId).close(1006); await settle();
  }
  const flapLog = fixture.logs.find(entry => entry.data.sessionId === flapping.sessionId && entry.message === "GPT-Live-Sitzung beendet");
  assert.ok(flapLog);
  assert.equal(flapLog.data.reason, "sideband_reconnect_limit");
  assert.equal(flapLog.data.reconnects, 3);
  assert.equal(fixture.requests.length, beforeFlapping);
  assert.equal(await api.closeLiveSession(flapping.sessionId, flapping.closeToken), false);

  // Closing immediately after sideband loss must attach only to close, never use SIP hangup.
  const closeLost = await api.createLiveWebRtcSession(createOptions);
  socketFor(closeLost.sessionId).close(); await settle();
  await api.closeLiveSession(closeLost.sessionId, closeLost.closeToken);
  assert.ok(socketFor(closeLost.sessionId).sent.some(event => event.type === "session.close"));
  assert.ok(!fixture.requests.some((r) => r.url.endsWith("/hangup")));
  const durationSession = await api.createLiveWebRtcSession(createOptions);
  fire(1_800_000); await settle(); assert.equal(socketFor(durationSession.sessionId).readyState, 3);
  process.env.LUKAS_LIVE_MAX_SESSIONS = "1";
  const reserved = api.createLiveWebRtcSession(createOptions);
  await assert.rejects(api.createLiveWebRtcSession(createOptions), /belegt/);
  const reservedResult = await reserved; await api.closeLiveSession(reservedResult.sessionId, reservedResult.closeToken);
  delete process.env.LUKAS_LIVE_MAX_SESSIONS;
  fixture.failCreate = true; const beforeFailed = fixture.requests.length;
  await assert.rejects(api.createLiveWebRtcSession(createOptions), /HTTP 500/);
  assert.equal(fixture.requests.length, beforeFailed + 1);


  const privateErrorText = "PRIVATE_PROVIDER_DETAILS_DO_NOT_LOG";
  fixture.apiError = { code: "invalid_value", type: "invalid_request_error", param: "session.audio.output.voice",
    message: "Unsupported voice " + privateErrorText };
  await assert.rejects(api.acceptLiveSipSession({ sessionId: "live_error_probe", instructions: "PRIVATE_BACKEND_ONLY", visibility: "private" }),
    error => /HTTP 400/.test(error.message) && /invalid_value/.test(error.message) && !error.message.includes(privateErrorText));
  const voiceError = fixture.logs.filter(row => row.message === "OpenAI Live HTTP-Anfrage abgewiesen").at(-1);
  assert.equal(voiceError.data.operation, "sip_accept");
  assert.equal(voiceError.data.code, "invalid_value");
  assert.equal(voiceError.data.param, "session.audio.output.voice");
  assert.equal(voiceError.data.hints.voice, true); assert.equal(voiceError.data.hints.unsupported, true);
  assert.ok(!JSON.stringify(voiceError).includes(privateErrorText));
  fixture.apiError = { code: privateErrorText, type: privateErrorText, param: privateErrorText, message: privateErrorText };
  await assert.rejects(api.acceptLiveSipSession({ sessionId: "live_error_private", instructions: "PRIVATE_BACKEND_ONLY", visibility: "private" }), /HTTP 400/);
  const hiddenError = fixture.logs.filter(row => row.message === "OpenAI Live HTTP-Anfrage abgewiesen").at(-1);
  assert.equal(hiddenError.data.code, "unknown"); assert.equal(hiddenError.data.param, "unknown");
  assert.equal(hiddenError.data.errorType, "unknown"); assert.ok(!JSON.stringify(hiddenError).includes(privateErrorText));
  fixture.apiError = { code: "credit_balance_exhausted", type: "invalid_request_error", message: "Insufficient credit balance." };
  await assert.rejects(api.createLiveWebRtcSession(createOptions), /credit_balance_exhausted/);
  assert.equal(fixture.logs.at(-1).data.hints.credit, true);
  fixture.apiError = { type: "invalid_request_error", message: "The SIP session cannot be accepted in its current state. " +
    "fake-test-key-do-not-use live_redaction_session https://private.example/token +4915112345678 " + '"private words should stay private"' };
  await assert.rejects(api.acceptLiveSipSession({ sessionId: "live_redaction_session", instructions: "PRIVATE_BACKEND_ONLY", visibility: "private" }), /HTTP 400/);
  const stateMessage = fixture.logs.at(-1).data.message;
  assert.match(stateMessage, /The SIP session cannot be accepted in its current state/);
  assert.doesNotMatch(stateMessage, /fake-test-key|live_redaction_session|private.example|491511|private words/);
  fixture.apiError = { type: "invalid_request_error", message: "Cannot start session: " + request.body.session.instructions };
  await assert.rejects(api.createLiveWebRtcSession(createOptions), /HTTP 400/);
  assert.ok(!fixture.logs.at(-1).data.message.includes(request.body.session.instructions));
  assert.match(fixture.logs.at(-1).data.message, /redacted/);
  fixture.apiError = { type: "invalid_request_error", message: "session ".repeat(200) };
  await assert.rejects(api.createLiveWebRtcSession(createOptions), /HTTP 400/);
  assert.ok(fixture.logs.at(-1).data.message.length <= 500);
  fixture.apiError = null;

  const endings = [];
  const phone = async (id) => {
    await api.acceptLiveSipSession({ sessionId: id, telefonKontextId: "context_" + id, instructions: "phone", visibility: "private", onTelefonEnd: async reason => endings.push(reason) });
    return socketFor(id);
  };
  const say = (s, delta) => s.emit({ type: "session.output_transcript.delta", event_id: "event_" + ++serial, delta, start_ms: serial * 10, end_ms: serial * 10 + 10 });
  assert.equal(api.fluestereLiveTelefon("context_goodbye", "Vorgemerkt vor Annahme.", true), "queued");
  const farewell = await phone("goodbye");
  assert.ok(farewell.sent.some(e => e.content?.includes("Vorgemerkt vor Annahme.")));

  say(farewell, "Vielen Dank. Tsch"); say(farewell, "üss!");
  input(farewell, "Warte, eine Frage noch.");
  assert.ok(![...timers.values()].some(t => t.milliseconds === 5000), "new caller speech cancels farewell");
  assert.equal(api.fluestereLiveTelefon("wrong_context", "private"), false);
  assert.equal(api.fluestereLiveTelefon("context_goodbye", "Frag nach Lieferung."), true);
  assert.ok(farewell.sent.some(e => e.content?.includes("Frag nach Lieferung.")));
  say(farewell, "Auf Wiederhören."); fire(5000); await settle();
  assert.ok(fixture.requests.some(r => r.url.endsWith("/goodbye/hangup")) || farewell.sent.some(e => e.type === "session.close"));
  assert.ok(endings.includes("verabschiedet"));
  assert.equal(api.fluestereLiveTelefon("context_goodbye", "late"), false);
  const mailbox = await phone("mailbox");
  input(mailbox, "Ich habe meine Mailbox noch nicht abgehört.");
  assert.equal(mailbox.readyState, 1);
  input(mailbox, "Bitte hinterlassen Sie nach dem Signal"); input(mailbox, "ton eine Nachricht."); await settle();
  assert.ok(endings.includes("mailbox")); assert.equal(mailbox.readyState, 3);

  const sipOptions = { sessionId: "live_phone_ok", instructions: "PHONE_PRIVATE_BACKEND", visibility: "private", allowTools: true,
    initialCommentary: "Du hast selbst angerufen. Begrüße den Gesprächspartner kurz zum vereinbarten Termin." };
  const beforeSip = fixture.calls.length;
  await Promise.all([api.acceptLiveSipSession(sipOptions), api.acceptLiveSipSession(sipOptions)]);
  const accepts = fixture.requests.filter((r) => r.url.endsWith("/live_phone_ok/accept"));
  assert.equal(accepts.length, 1); assert.equal(accepts[0].body.session.type, "live");
  assert.equal(accepts[0].body.session.client, undefined);
  assert.deepEqual(accepts[0].body.session.audio, { output: { voice: "cedar" } });
  const sipSocket = socketFor("live_phone_ok");
  assert.ok(accepts[0].body.session.instructions.includes("Backchannel policy:"));
  assert.ok(accepts[0].body.session.instructions.includes("Interruption policy:"));
  assert.ok(!JSON.stringify(accepts[0].body.session).includes("PHONE_PRIVATE_BACKEND"), "private backend context remains private");
  assert.equal(accepts[0].body.session.input[0].role, "developer");
  assert.ok(accepts[0].body.session.input[0].content[0].text.includes(sipOptions.initialCommentary), "entire brief is present at accept");
  assert.equal(sipSocket.sent.length, 0, "no competing context or greeting during attachment replay");
  fire(250); await settle();
  const greeting = sipSocket.sent.filter((e) => e.type === "session.instructions.append" && e.delegation_id === null);
  assert.equal(greeting.length, 1, "phone startup must trigger exactly one greeting instruction");
  assert.match(greeting[0].content, /genau einmal/);
  const quietBrief = sipSocket.sent.filter((e) => e.type === "session.thinking.append" && e.delegation_id === null);
  assert.equal(quietBrief.length, 0, "startup context must not be streamed after speech can already begin");
  assert.equal(sipSocket.sent.some((e) => e.type === "session.commentary.append" && e.delegation_id === null), false,
    "private/startup context must never be injected as speakable commentary");
  assert.equal(fixture.calls.length, beforeSip);
  input(sipSocket, "Wie lautet die öffentliche Adresse?"); delegate(sipSocket, "phone_one"); await settle();
  assert.deepEqual(fixture.calls.at(-1).tools, []); assert.equal(fixture.calls.at(-1).userText, "Wie lautet die öffentliche Adresse?");
  sipSocket.emit({ type: "session.closed", reason: "remote_hangup", usage: { seconds: 3 } });
  await assert.rejects(api.acceptLiveSipSession(sipOptions), (error) => error.accepted === true);
  assert.equal(fixture.requests.filter((r) => r.url.endsWith("/live_phone_ok/accept")).length, 1);
  // Reflected audio precedes text. Reissuing instructions must not cut it off.
  const silentPcm = Buffer.alloc(4800), audiblePcm = Buffer.from(silentPcm);
  audiblePcm.writeInt16LE(1200, 0);
  const audioStartupCases = [
    { name: "silent_timed", delta: silentPcm.toString("base64"), timing: { start_ms: 0, end_ms: 100 }, audible: false },
    { name: "audible_timed", delta: audiblePcm.toString("base64"), timing: { start_ms: 0, end_ms: 100 }, audible: true },
    { name: "silent_untimed", delta: silentPcm.toString("base64"), timing: {}, audible: false },
    { name: "audible_untimed", delta: audiblePcm.toString("base64"), timing: {}, audible: true },
    { name: "empty", delta: "", timing: {}, audible: false },
    { name: "invalid_base64", delta: "not valid PCM!", timing: {}, audible: false },
    { name: "odd_pcm_byte", delta: "AQ==", timing: {}, audible: false },
    { name: "noncanonical", delta: "AB==", timing: {}, audible: false },
  ];
  for (const test of audioStartupCases) {
    const sessionId = "live_phone_audio_" + test.name;
    await api.acceptLiveSipSession({ ...sipOptions, sessionId });
    const active = socketFor(sessionId);
    const fallback = [...timers.values()].find(timer => timer.milliseconds === 250);
    assert.ok(fallback, "greeting fallback starts pending");
    active.emit({ type: "session.output_audio.delta", delta: test.delta, ...test.timing });
    assert.equal([...timers.values()].some(timer => timer.milliseconds === 250), !test.audible,
      test.name + ": only valid nonzero PCM cancels the pending greeting");
    if (!test.audible) fire(250);
    else fallback.callback(); // An already queued callback must also respect observed audio.
    await settle();
    assert.equal(active.sent.filter(event => event.type === "session.instructions.append").length, test.audible ? 0 : 1,
      test.name + ": do not interrupt output or suppress the greeting on digital silence");
    if (test.audible) {
      active.close(1006); await settle(); fire(500); await settle();
      const recovered = socketFor(sessionId);
      recovered.emit({ type: "session.output_audio.delta", delta: test.delta, start_ms: 9000, end_ms: 9100 });
      assert.equal(recovered.sent.some(event => event.type === "session.instructions.append"),false);
      recovered.emit({ type: "session.closed", reason: "remote_hangup" });
    } else active.emit({ type: "session.closed", reason: "remote_hangup" });
    const closeLog = fixture.logs.find(entry => entry.data.sessionId === sessionId && entry.message === "GPT-Live-Sitzung beendet");
    assert.ok(closeLog);
    if (test.audible) {
      assert.equal(closeLog.data.reflectedOutput.segments,2);
      assert.equal(closeLog.data.reflectedOutput.timelineGaps,0,"reconnect must not invent media gaps");
    }
    if (test.delta.length > 100) assert.equal(JSON.stringify(fixture.logs.filter(row=>row.data.sessionId===sessionId)).includes(test.delta), false, "audio payload never enters logs");
  }
  // A first word arriving during sideband replay must cancel the extra greeting.
  for (const role of ["user", "assistant"]) {
    const sessionId = "live_phone_already_" + role;
    await api.acceptLiveSipSession({ ...sipOptions, sessionId });
    const active = socketFor(sessionId);
    active.emit({ type: role === "user" ? "session.input_transcript.delta" : "session.output_transcript.delta",
      event_id: "first_" + role, delta: "Hallo", start_ms: 0, end_ms: 100 });
    assert.ok(![...timers.values()].some(timer => timer.milliseconds === 250), "speech cancels pending greeting");
    assert.equal(active.sent.some(event => event.type === "session.instructions.append"), false);
    active.emit({ type: "session.closed" });
  }
  const longBrief = "Auftrag Anfang " + "ä".repeat(1800) + " AUFTRAG_ENDE";
  await api.acceptLiveSipSession({ ...sipOptions, sessionId: "live_phone_long_brief", initialCommentary: longBrief });
  const longAccept = fixture.requests.find(r => r.url.endsWith("/live_phone_long_brief/accept"));
  assert.ok(longAccept.body.session.input[0].content[0].text.endsWith("AUFTRAG_ENDE"), "do not truncate startup to four streamed chunks");
  socketFor("live_phone_long_brief").emit({ type: "session.closed" });
  assert.ok(![...timers.values()].some(timer => timer.milliseconds === 250), "close cancels pending greeting");
  fixture.failSockets = 1;
  await assert.rejects(api.acceptLiveSipSession({ ...sipOptions, sessionId: "live_phone_attach_failure" }), (error) => error.accepted === true);
  assert.ok(fixture.requests.some((r) => r.url.endsWith("/live_phone_attach_failure/hangup")));
  await assert.rejects(api.acceptLiveSipSession({ ...sipOptions, sessionId: "live_phone_attach_failure" }), (error) => error.accepted === true);
  assert.equal(fixture.requests.filter((r) => r.url.endsWith("/live_phone_attach_failure/accept")).length, 1);
  await api.rejectLiveSipSession("live_phone_rejected"); assert.deepEqual(fixture.requests.at(-1).body, { status_code: 603 });

  // Keep an owner voice session open while four external phone conversations
  // run. One slow backend turn must not block or contaminate another call.
  const ownerDuringCalls = await api.createLiveWebRtcSession(createOptions);
  const parallelIds = ["live_parallel_a", "live_parallel_b", "live_parallel_c", "live_parallel_d"];
  await Promise.all(parallelIds.map((sessionId, index) => api.acceptLiveSipSession({
    sessionId, instructions: `CALL_CONTEXT_${index}`, visibility: "public",
    initialCommentary: `Auftrag ${index}`,
  })));
  let releaseSlowCall;
  fixture.backend = (options) => options.userText === "Frage 0"
    ? new Promise(resolve => { releaseSlowCall = () => resolve("Antwort 0"); })
    : Promise.resolve(options.userText.replace("Frage", "Antwort"));
  const beforeParallelWork = fixture.calls.length;
  for (const [index, id] of parallelIds.entries()) {
    input(socketFor(id), `Frage ${index}`);
    delegate(socketFor(id), "same_id_in_separate_sessions");
  }
  await settle();
  const parallelWork = fixture.calls.slice(beforeParallelWork);
  assert.equal(parallelWork.length, 4);
  assert.equal(new Set(parallelWork.map(call => call.conversationId)).size, 4);
  for (const [index, id] of parallelIds.entries()) {
    const work = parallelWork.find(call => call.userText === `Frage ${index}`);
    assert.ok(work.systemPromptOverride.startsWith(`CALL_CONTEXT_${index}`));
    assert.deepEqual(work.tools, []);
    for (const other of [0, 1, 2, 3].filter(value => value !== index)) {
      assert.ok(!JSON.stringify(work.history).includes(`Frage ${other}`));
    }
    const replies = socketFor(id).sent.filter(event => event.delegation_id === "same_id_in_separate_sessions");
    assert.equal(replies.map(event => event.content).join(""), index === 0 ? "" : `Antwort ${index}`);
  }
  const beforeOverflow = fixture.requests.length;
  const fifthCall = { sessionId: "live_parallel_e", instructions: "Fifth call", visibility: "public" };
  await assert.rejects(api.acceptLiveSipSession(fifthCall), /belegt/);
  assert.equal(fixture.requests.length, beforeOverflow, "Public capacity is enforced before another remote accept");
  releaseSlowCall(); await settle(); fixture.backend = null;
  assert.equal(socketFor(parallelIds[0]).sent.filter(event => event.delegation_id === "same_id_in_separate_sessions")
    .map(event => event.content).join(""), "Antwort 0");
  socketFor(parallelIds[0]).emit({ type: "session.closed" });
  await api.acceptLiveSipSession(fifthCall);
  assert.equal(socketFor(ownerDuringCalls.sessionId).readyState, 1, "Owner session stays open");
  for (const id of [...parallelIds.slice(1), fifthCall.sessionId]) socketFor(id).emit({ type: "session.closed" });
  await api.closeLiveSession(ownerDuringCalls.sessionId, ownerDuringCalls.closeToken);
  console.log("Parallel SIP regressions passed: isolated calls, independent backend turns and shared public capacity.");

  const shutdownSession = await api.createLiveWebRtcSession(createOptions);
  // Shutdown must wait for a still-pending create and its remote cleanup.
  const originalFetch = globalThis.fetch; let releaseCreate;
  globalThis.fetch = (url, options) => new Promise(resolve => { releaseCreate = () => resolve(originalFetch(url, options)); });
  const pendingCreate = api.createLiveWebRtcSession(createOptions);
  let shutdownFinished = false;
  const shutdown = api.shutdownLiveSessions().then(() => { shutdownFinished = true; });
  await settle(); assert.equal(shutdownFinished, false);
  globalThis.fetch = originalFetch; releaseCreate();
  await assert.rejects(pendingCreate, /startet gerade neu/);
  await shutdown; await settle();
  assert.equal(socketFor(shutdownSession.sessionId).readyState, 3);
  await assert.rejects(api.createLiveWebRtcSession(createOptions), /startet gerade neu/);
  assert.equal(timers.size, 0);
  console.log("GPT Live regressions passed: protocol, privacy, delegation offsets, cancellation, limits and SIP idempotency.");
} finally {
  await api?.shutdownLiveSessions();
  globalThis.fetch = previous.fetch; globalThis.setTimeout = previous.setTimeout; globalThis.clearTimeout = previous.clearTimeout;
  for (const key of envKeys) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
  delete globalThis.__liveSessionTest; await rm(directory, { recursive: true, force: true });
}
