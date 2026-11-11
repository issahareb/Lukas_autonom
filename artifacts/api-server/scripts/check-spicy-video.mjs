import assert from 'node:assert/strict';
import * as module from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'lukas-spicy-'));
const oldFetch = globalThis.fetch;
const oldKey = process.env.SPICY_API_KEY;
const root = new URL('../src/lib/', import.meta.url);
const compile = async (source) => module.stripTypeScriptTypes
  ? module.stripTypeScriptTypes(source)
  : (await (await import('esbuild')).transform(source, { loader: 'ts', format: 'esm', target: 'node20' })).code;
let checks = 0;
try {
  for (const name of ['spicy-video', 'aufgaben-bedarf', 'werkzeug-auswahl']) {
    const src = readFileSync(new URL(`${name}.ts`, root), 'utf8').replace('"./aufgaben-bedarf"', '"./aufgaben-bedarf.mjs"');
    writeFileSync(join(dir, `${name}.mjs`), await compile(src));
  }
  const { spicyVideoRequest, erzeugeSpicyVideo, spicyVideoStatus } = await import(join(dir, 'spicy-video.mjs'));
  const { waehleWerkzeuge } = await import(join(dir, 'werkzeug-auswahl.mjs'));
  const input = { image_url: 'https://example.com/start.png', idempotency_key: 'request_1234567890', prompt: 'Slow camera move' };
  const requests = [];
  const respond = (data, code = 200, status = 200) => {
    globalThis.fetch = async (url, init) => { requests.push({ url, init }); return new Response(JSON.stringify({ code, data }), { status }); };
  };
  for (const bad of [{ duration_seconds: 0 }, { duration_seconds: -1 }, { duration_seconds: 31 }, { duration_seconds: 5.5 }, { resolution: ['720p'] }, { aspect_ratio: ['9:16'] }, { generate_audio: 'true' }, { image_url: 'http://example.com/a.png' }, { image_url: 'https://name:secret@example.com/a.png' }, { idempotency_key: 'short' }, { unexpected: true }]) {
    assert.throws(() => spicyVideoRequest({ ...input, ...bad })); checks++;
  }
  delete process.env.SPICY_API_KEY;
  await assert.rejects(() => erzeugeSpicyVideo(input), /SPICY_API_KEY fehlt/); checks++;
  assert.equal(requests.length, 0);
  process.env.SPICY_API_KEY = 'SYNTHETIC_SECRET';
  respond({ taskId: 'job_123', state: 'queued', estimatedCost: '0.75' }, 200, 202);
  const accepted = JSON.parse(await erzeugeSpicyVideo(input));
  assert.equal(accepted.status, 'angenommen'); assert.equal(accepted.abgeschlossen, false);
  assert.equal(accepted.task_id, 'job_123'); assert.equal(accepted.idempotency_key, input.idempotency_key);
  assert.equal(requests[0].init.headers.Authorization, 'Bearer SYNTHETIC_SECRET');
  assert.equal(requests[0].init.headers['Idempotency-Key'], input.idempotency_key);
  assert.equal(requests[0].init.redirect, 'error');
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.model, 'alibaba/wan-3.0/image-to-video');
  assert.equal(body.input.duration_seconds, 5); assert.equal(body.input.resolution, '720p'); checks++;
  await erzeugeSpicyVideo(input);
  assert.equal(requests[0].init.body, requests[1].init.body);
  assert.equal(requests[0].init.headers['Idempotency-Key'], requests[1].init.headers['Idempotency-Key']); checks++;
  for (const state of ['queued', 'running', 'processing']) {
    respond({ taskId: 'job_123', state, output: { assets: [{ url: 'https://example.com/not-ready.mp4' }] } });
    const result = JSON.parse(await spicyVideoStatus({ task_id: 'job_123' }));
    assert.equal(result.abgeschlossen, false); assert.equal(result.erfolgreich, false); assert.equal(result.videos, undefined); checks++;
  }
  respond({ taskId: 'job_123', state: 'succeeded', cost: '0.75', settled: true, output: { assets: [{ url: 'https://example.com/done.mp4', mime: 'video/mp4', expiresAt: '2026-11-12T12:00:00Z' }] } });
  const done = JSON.parse(await spicyVideoStatus({ task_id: 'job_123' }));
  assert.equal(done.erfolgreich, true); assert.equal(done.videos[0].expires_at, '2026-11-12T12:00:00Z'); checks++;
  for (const state of ['failed', 'cancelled']) {
    respond({ taskId: 'job_123', state }); const result = JSON.parse(await spicyVideoStatus({ task_id: 'job_123' }));
    assert.equal(result.erfolgreich, false); assert.equal(result.abgeschlossen, true); checks++;
  }
  respond({ taskId: 'job_123', state: 'new-state' });
  assert.equal(JSON.parse(await spicyVideoStatus({ task_id: 'job_123' })).abgeschlossen, false); checks++;
  respond({ taskId: 'wrong', state: 'succeeded' });
  await assert.rejects(() => spicyVideoStatus({ task_id: 'job_123' }), /anderen Auftrag/); checks++;
  respond({ taskId: 'job_123', state: 'succeeded', output: { assets: [] } });
  await assert.rejects(() => spicyVideoStatus({ task_id: 'job_123' }), /kein abrufbares/); checks++;
  respond({}, 500);
  await assert.rejects(() => erzeugeSpicyVideo(input), /nicht bestätigt/); checks++;
  respond({}, 200, 401);
  await assert.rejects(() => erzeugeSpicyVideo(input), /HTTP 401/); checks++;
  globalThis.fetch = async () => { throw new Error('SYNTHETIC_SECRET provider body'); };
  await assert.rejects(() => erzeugeSpicyVideo(input), error => /Status ist unklar|Auftragsstatus ist unklar/.test(error.message) && !error.message.includes('SYNTHETIC_SECRET')); checks++;
  globalThis.fetch = async () => new Response('not json');
  await assert.rejects(() => erzeugeSpicyVideo(input), /keinen neuen idempotency_key/); checks++;
  const before = requests.length; const controller = new AbortController(); controller.abort();
  await assert.rejects(() => erzeugeSpicyVideo(input, controller.signal)); assert.equal(requests.length, before); checks++;
  const tools = ['spicy_video_erstellen', 'spicy_video_status'].map(name => ({ type: 'function', function: { name } }));
  for (const phrase of ['Erstelle ein Video', 'Was macht mein Wan 3 Auftrag?', 'SpicyAPI Status']) {
    assert.equal(waehleWerkzeuge(tools, phrase).length, 2); checks++;
  }
  const policy = readFileSync(new URL('policy.ts', root), 'utf8');
  assert.match(policy, /spicy_video_erstellen: "R2"/); assert.match(policy, /spicy_video_status: "R0"/); checks++;
  assert.doesNotMatch(JSON.stringify(accepted) + JSON.stringify(done), /SYNTHETIC_SECRET/); checks++;
  console.log(`OK — ${checks} SpicyAPI checks: validation, secret isolation, auth, idempotent retries, acceptance vs success, failures, cancellation, expiry and tool routing. No paid requests sent.`);
} finally {
  globalThis.fetch = oldFetch;
  if (oldKey === undefined) delete process.env.SPICY_API_KEY; else process.env.SPICY_API_KEY = oldKey;
  rmSync(dir, { recursive: true, force: true });
}
