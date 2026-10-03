import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import express from 'express';
const dir = mkdtempSync(join(tmpdir(), 'lukas-telnyx-'));
const oldFetch = globalThis.fetch;
let server;
try {
  const out = join(dir, 'telnyx.mjs');
  await build({ entryPoints: ['src/lib/telnyx.ts'], outfile: out, bundle: true, platform: 'node', format: 'esm' });
  const t = await import(out);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  Object.assign(process.env, { TELNYX_API_KEY: 'test-only', TELNYX_PUBLIC_KEY: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'), TELNYX_NUMMER: '+49201123456', TELNYX_APP_ID: 'test-app', OPENAI_PROJECT_ID: 'proj_test', OPENAI_WEBHOOK_SECRET: 'whsec_' + Buffer.from('local-webhook-regression-secret').toString('base64'), LUKAS_TELEFON_ANBIETER: 'telnyx' });
  const body = Buffer.from('From=%2B4915112345678&To=%2B49201123456&ConnectionId=test-app');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signed = (bytes, time = timestamp) => sign(null, Buffer.concat([Buffer.from(time + '|'), bytes]), privateKey).toString('base64');
  assert.equal(t.telnyxSignatur(body, timestamp, signed(body)), true);
  assert.equal(t.telnyxSignatur(Buffer.from(body + 'x'), timestamp, signed(body)), false);
  const expired = String(Number(timestamp) - 301);
  assert.equal(t.telnyxSignatur(body, expired, signed(body, expired)), false);
  assert.equal(t.telnyxSignatur(body, timestamp, ''), false);
  const token = t.telefonKontext('+4915112345678', 'ausgehend', 'Termin & Rückruf');
  assert.equal(t.pruefeTelefonKontext(token).anlass, 'Termin & Rückruf');
  assert.equal(t.pruefeTelefonKontext('x' + token), null);
  const now = Date.now;
  Date.now = () => now() + 181000;
  assert.equal(t.pruefeTelefonKontext(token), null);
  Date.now = now;
  assert.throws(() => t.telnyxXml('"/><Say>bad', 'eingehend'));
  assert.match(t.telnyxXml('', 'eingehend'), /transport=tls\?X-Lukas-Context=/);
  let calls = [], numberStatus = 'requirement-info-pending';
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ data: options.method === 'GET' ? [{ phone_number: process.env.TELNYX_NUMMER, connection_id: 'test-app', status: numberStatus }] : { sid: 'call-test' } }), { status: 200 });
  };
  await assert.rejects(t.telnyxWaehle('+4915112345678', 'Test'), /noch nicht freigeschaltet/);
  assert.equal(calls.filter(c => c.options.method === 'POST').length, 0);
  numberStatus = 'active'; await t.telnyxWaehle('+4915112345678', 'Test');
  const dial = calls.find(c => c.options.method === 'POST');
  assert.equal(dial.url, 'https://api.telnyx.com/v2/texml/calls/test-app');
  const payload = JSON.parse(dial.options.body);
  assert.equal(payload.From, process.env.TELNYX_NUMMER); assert.equal(payload.To, '+4915112345678');
  const context = t.pruefeTelefonKontext(payload.Texml.match(/X-Lukas-Context=([^<]+)/)[1]);
  assert.equal(context.nummer, payload.To); assert.equal(context.richtung, 'ausgehend');
  assert.match((await t.telnyxStand()).hinweis, /noch nicht geprüft/);
  let providerErrorCode = '10010';
  globalThis.fetch = async () => new Response(JSON.stringify({
    errors: [{ code: providerErrorCode, detail: 'secret-provider-detail', title: 'secret-provider-title' }],
  }), { status: 403 });
  await assert.rejects(t.telnyxAnfrage('/texml/calls/secret-app-id', {}), error => {
    assert.match(error.message, /Telnyx 403/);
    assert.match(error.message, /Anrufaufbau/);
    assert.match(error.message, /Code 10010/);
    assert.match(error.message, /Berechtigung/);
    assert.doesNotMatch(error.message, /secret|trial|Guthaben/i);
    return true;
  });
  await assert.rejects(t.telnyxAnfrage('/phone_numbers?filter[phone_number]=secret-number'), /Nummernstatus/);
  providerErrorCode = 10010;
  await assert.rejects(t.telnyxAnfrage('/texml/calls/test', {}), /Code 10010/);
  for (const invalid of ['10010\nsecret', 'https://secret.invalid/key', '123456789012345', { value: 'secret' }, null]) {
    providerErrorCode = invalid;
    await assert.rejects(t.telnyxAnfrage('/secret-unknown-path'), error => {
      assert.match(error.message, /API-Anfrage/);
      assert.match(error.message, /Code unbekannt/);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
  }
  globalThis.fetch = oldFetch;
  const stub = join(dir, 'stub.mjs');
  writeFileSync(stub, `
export const db = {}, telefonNummern = {}, desc = () => {}, eq = () => {};
export const logger = { warn(...args){ globalThis.telefonLogs?.push(args); }, info(...args){ globalThis.telefonLogs?.push(args); }, error(){} };
import OpenAI from "openai";
export const openai = new OpenAI({ apiKey: "local-test-only", webhookSecret: process.env.OPENAI_WEBHOOK_SECRET });
export class LiveSessionError extends Error { constructor(message, accepted = false) { super(message); this.accepted = accepted; } }
export const nimmAn = async (...args) => {
  globalThis.acceptedCalls.push(args);
  if (globalThis.acceptGate) await globalThis.acceptGate;
  if (globalThis.acceptFailure) throw new Error("temporary provider failure");
  if (globalThis.acceptTerminalFailure) throw new LiveSessionError("sideband unavailable after accept", true);
  return "oeffentlich";
};
export const weiseAb = async () => { globalThis.rejectedCalls++; };
export const nummerAusSip = () => 'untrusted', normalisiere = s => s.replace(/[^0-9]/g, '');
export const letzteAnrufe = async () => [], protokolliere = async () => {};
export const twilioZugang = () => null, twilioStand = async () => ({}), twilioEinrichten = async () => [], starteAnruf = async () => '';
export const sendeSms = async () => ({}), letzteSms = async () => [], zugangVorhanden = () => false, nimmSmsEntgegen = async () => ({}), meldeDichBeiIssa = async () => {}, recordDebugEvent = () => {};
`);
  const routes = join(dir, 'routes.mjs');
  await build({ entryPoints: ['src/routes/telefon.ts'], outfile: routes, bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [{ name: 'test-adapters', setup(b) {
    b.onResolve({ filter: /^(@workspace\/|drizzle-orm$|\.\.\/lib\/)/ }, args => args.path === '../lib/telnyx' ? undefined : { path: stub });
  } }] });
  const require = createRequire(import.meta.url);
  symlinkSync(require.resolve('express/package.json').replace(/\/express\/package.json$/, ''), join(dir, 'node_modules'));
  const { telefonWebhookRouter } = await import(routes);
  globalThis.acceptedCalls = []; globalThis.rejectedCalls = 0; globalThis.telefonLogs = [];
  const app = express(), capture = (req, _res, bytes) => { req.rawBody = bytes; };
  app.use(express.json({ verify: capture })); app.use(express.urlencoded({ extended: false, verify: capture })); app.use('/api', telefonWebhookRouter);
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (bytes, signature = signed(bytes)) => oldFetch(base + '/telefon/telnyx/texml', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'telnyx-timestamp': timestamp, 'telnyx-signature-ed25519': signature }, body: bytes });
  assert.equal((await request(body, '')).status, 401);
  assert.equal(globalThis.telefonLogs.at(-1)[0].reason, 'invalid_signature');
  assert.equal((await request(Buffer.from(body + '&ConnectionId=other'))).status, 403);
  assert.equal(globalThis.telefonLogs.at(-1)[0].reason, 'configuration_mismatch');
  assert.equal(globalThis.telefonLogs.at(-1)[0].connectionMatches, false);
  const incoming = await request(body); assert.equal(incoming.status, 200);
  assert.deepEqual(globalThis.telefonLogs.at(-1)[0], { route: 'telnyx/texml', outcome: 'xml_returned', httpStatus: 200 });
  assert.doesNotMatch(JSON.stringify(globalThis.telefonLogs), /4915112345678|49201123456|test-app|test-only|X-Lukas-Context|local-webhook-regression-secret/);
  const incomingToken = (await incoming.text()).match(/X-Lukas-Context=([^<]+)/)[1];
  assert.equal(t.pruefeTelefonKontext(incomingToken).richtung, 'eingehend');
  const event = { type: 'live.transport.incoming', data: { type: 'sip', session_id: 'live_one', sip_headers: [{ name: 'X-Lukas-Context', value: token }] } };
  const sendEvent = (options = {}) => {
    const bytes = JSON.stringify(event);
    const ts = String(Math.floor(Date.now() / 1000) - (options.expired ? 600 : 0));
    const id = 'whmsg_regression';
    const signature = createHmac('sha256', Buffer.from('local-webhook-regression-secret'))
      .update(id + '.' + ts + '.' + bytes).digest('base64');
    return oldFetch(base + '/telefon/eingehend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'webhook-id': id,
        'webhook-timestamp': ts, 'webhook-signature': 'v1,' + (options.invalid ? 'invalid' : signature) },
      body: bytes,
    });
  };
  // Real SDK signature verification is asynchronous; missing await breaks this.
  assert.equal((await sendEvent({ invalid: true })).status, 401);
  assert.equal((await sendEvent({ expired: true })).status, 401);
  assert.equal(globalThis.acceptedCalls.length, 0);
  assert.equal((await sendEvent()).status, 200);
  assert.equal((await sendEvent()).status, 200);
  assert.equal(globalThis.acceptedCalls.length, 1);
  assert.equal(globalThis.acceptedCalls[0][0], 'live_one');
  assert.equal(globalThis.acceptedCalls[0][1], '+4915112345678');
  assert.equal(globalThis.acceptedCalls[0][2].richtung, 'ausgehend');
  event.data.session_id = 'live_parallel';
  let releaseAccept;
  globalThis.acceptGate = new Promise(resolve => { releaseAccept = resolve; });
  const parallel = [sendEvent(), sendEvent()];
  await new Promise(resolve => setTimeout(resolve, 30));
  releaseAccept(); globalThis.acceptGate = null;
  assert.deepEqual((await Promise.all(parallel)).map(r => r.status), [200, 200]);
  assert.equal(globalThis.acceptedCalls.filter(args => args[0] === 'live_parallel').length, 1);
  event.data.session_id = 'live_retry'; globalThis.acceptFailure = true;
  assert.equal((await sendEvent()).status, 503);
  assert.equal(globalThis.rejectedCalls, 0, 'ambiguous accept must not reject a potentially live call');
  globalThis.acceptFailure = false;
  assert.equal((await sendEvent()).status, 200);
  event.data.session_id = 'live_terminal'; globalThis.acceptTerminalFailure = true;
  assert.equal((await sendEvent()).status, 200);
  assert.equal((await sendEvent()).status, 200);
  assert.equal(globalThis.acceptedCalls.filter(args => args[0] === 'live_terminal').length, 1);
  globalThis.acceptTerminalFailure = false;
  event.data.session_id = 'live_badcontext'; event.data.sip_headers[0].value = 'forged';
  assert.equal((await sendEvent()).status, 200);
  assert.equal(globalThis.rejectedCalls, 1);
  event.data.session_id = 'invalid session id';
  assert.equal((await sendEvent()).status, 400);
  const beforeIgnored = globalThis.acceptedCalls.length;
  event.type = 'realtime.call.incoming'; event.data.call_id = 'legacy_call';
  assert.equal((await sendEvent()).status, 200);
  assert.equal(globalThis.acceptedCalls.length, beforeIgnored);
  console.log('OK — Telnyx: form signatures, tamper/expiry rejection, context correlation, webhook deduplication, pending-number guard and outbound payload.');
} finally {
  globalThis.fetch = oldFetch;
  if (server) await new Promise(resolve => server.close(resolve));
  delete globalThis.telefonLogs;
  rmSync(dir, { recursive: true, force: true });
}
