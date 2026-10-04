import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
const dir = mkdtempSync(resolve(".aufnahme-check-"));
try {
  const stub = join(dir, "stub.mjs");
  writeFileSync(stub, `
export const telefonAnrufe = {}, eq = () => {}, and = () => {}, desc = () => {};
const rows = { limit: async () => globalThis.recordingRow ? [globalThis.recordingRow] : [], orderBy: () => rows };
export const db = { select: () => ({ from: () => ({ where: () => rows }) }) };
export const telnyxAnfrage = async path => { globalThis.recordingPaths.push(path); return globalThis.recordingMeta; };
export const sicherFetch = async (url, options) => { globalThis.mediaRequests.push({url, options}); return globalThis.mediaReply ? globalThis.mediaReply(url, options) : new Response('audio', {headers:{'Content-Type':'audio/mpeg'}}); };
`);
  const out = join(dir, "aufnahme.mjs");
  await build({ entryPoints: ["src/lib/telefon-aufnahme.ts"], outfile: out, bundle: true, platform: "node", format: "esm",
    plugins: [{ name: "adapters", setup(b) { b.onResolve({ filter: /^(@workspace\/db|drizzle-orm|\.\/telnyx|\.\/netzschutz)$/ }, () => ({ path: stub })); } }] });
  const { ladeTelefonAufnahme, pruefeLetzteTelefonAufnahme } = await import(out);
  globalThis.recordingPaths = []; globalThis.mediaRequests = [];
  assert.equal(await ladeTelefonAufnahme(42), null);
  globalThis.recordingRow = { aufnahmeZustimmung: false, aufnahmeStatus: "completed", aufnahmeSid: "sid", aufnahmeAccountSid: "account", providerSid: "root" };
  assert.equal(await ladeTelefonAufnahme(42), null);
  assert.equal(globalThis.recordingPaths.length, 0);
  globalThis.recordingRow.aufnahmeZustimmung = true;
  globalThis.recordingMeta = { sid: "sid", call_sid: "wrong", media_url: "https://storage.example.test/audio" };
  await assert.rejects(ladeTelefonAufnahme(42), /recording_mismatch/);
  globalThis.recordingMeta.call_sid = "root";
  for (const url of ["http://storage.example.test/audio", "https://user:pass@storage.example.test/audio", "file:///tmp/audio"]) {
    globalThis.recordingMeta.media_url = url;
    await assert.rejects(ladeTelefonAufnahme(42));
  }
  assert.equal(globalThis.mediaRequests.length, 0);
  for (const key of ["fresh-1", "fresh-2"]) {
    globalThis.recordingMeta.media_url = "https://storage.example.test/audio?signature=" + key;
    assert.equal(await (await ladeTelefonAufnahme(42)).text(), "audio");
    assert.equal(globalThis.mediaRequests.at(-1).url, globalThis.recordingMeta.media_url);
    assert.equal(globalThis.mediaRequests.at(-1).options.headers.Authorization, undefined, "No API token on storage request");
    assert.equal(globalThis.mediaRequests.at(-1).options.maxWeiterleitungen, 0);
    assert.equal(globalThis.recordingPaths.at(-1), "/texml/Accounts/account/Recordings/sid.json");
  }
  const savedKey = process.env.TELNYX_API_KEY;
  process.env.TELNYX_API_KEY = "test-key";
  try {
    const rowBefore = JSON.stringify(globalThis.recordingRow);
    globalThis.recordingMeta.media_url = "https://api.telnyx.com/v2/texml/Accounts/account/Recordings/sid.mp3";
    globalThis.mediaReply = url => url.startsWith("https://api.telnyx.com/")
      ? new Response(null, { status: 302, headers: { location: "https://storage.example.test/audio?signature=fresh" } })
      : new Response("audio", { headers: { "content-type": "audio/mpeg" } });
    assert.equal(await (await ladeTelefonAufnahme(42)).text(), "audio");
    assert.equal(globalThis.mediaRequests.at(-2).options.headers.Authorization, "Bearer test-key");
    assert.equal(globalThis.mediaRequests.at(-2).options.redirect, "manual");
    assert.equal(globalThis.mediaRequests.at(-1).options.headers.Authorization, undefined);
    assert.equal((await pruefeLetzteTelefonAufnahme()).status, "available");
    assert.equal(globalThis.mediaRequests.at(-1).options.headers.Range, "bytes=0-0");
    for (const target of ["http://storage.example.test/audio", "https://user:pass@storage.example.test/audio"]) {
      globalThis.mediaReply = () => new Response(null, { status: 302, headers: { location: target } });
      const count = globalThis.mediaRequests.length;
      await assert.rejects(ladeTelefonAufnahme(42), /media_url_invalid/);
      assert.equal(globalThis.mediaRequests.length, count + 1, "Unsafe redirect is never fetched");
    }
    globalThis.mediaReply = () => new Response(null, { status: 302, headers: { location: "/loop" } });
    await assert.rejects(ladeTelefonAufnahme(42), /media_redirect_invalid/);
    globalThis.mediaReply = () => { throw new Error("secret-storage-signature"); };
    assert.deepEqual(await pruefeLetzteTelefonAufnahme(), { status: "media_network_error", httpStatus: undefined });
    globalThis.mediaReply = () => new Response("denied", { status: 403 });
    assert.deepEqual(await pruefeLetzteTelefonAufnahme(), { status: "media_http_error", httpStatus: 403 });
    assert.equal(JSON.stringify(globalThis.recordingRow), rowBefore, "Playback/probe never changes an existing recording");
  } finally {
    if (savedKey === undefined) delete process.env.TELNYX_API_KEY; else process.env.TELNYX_API_KEY = savedKey;
  }
  console.log("OK — Aufnahmen: Zustimmung, Zuordnung, authentifizierter Telnyx-Abruf, sichere Redirects, Diagnose ohne Datenverlust.");
} finally {
  for (const key of ["recordingPaths", "mediaRequests", "recordingRow", "recordingMeta", "mediaReply"]) delete globalThis[key];
  rmSync(dir, { recursive: true, force: true });
}
