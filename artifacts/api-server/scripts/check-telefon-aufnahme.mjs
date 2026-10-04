import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
const dir = mkdtempSync(resolve(".aufnahme-check-"));
try {
  const stub = join(dir, "stub.mjs");
  writeFileSync(stub, `
export const telefonAnrufe = {}, eq = () => {};
export const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => globalThis.recordingRow ? [globalThis.recordingRow] : [] }) }) }) };
export const telnyxAnfrage = async path => { globalThis.recordingPaths.push(path); return globalThis.recordingMeta; };
export const sicherFetch = async (url, options) => { globalThis.mediaRequests.push({url, options}); return new Response('audio', {headers:{'Content-Type':'audio/mpeg'}}); };
`);
  const out = join(dir, "aufnahme.mjs");
  await build({ entryPoints: ["src/lib/telefon-aufnahme.ts"], outfile: out, bundle: true, platform: "node", format: "esm",
    plugins: [{ name: "adapters", setup(b) { b.onResolve({ filter: /^(@workspace\/db|drizzle-orm|\.\/telnyx|\.\/netzschutz)$/ }, () => ({ path: stub })); } }] });
  const { ladeTelefonAufnahme } = await import(out);
  globalThis.recordingPaths = []; globalThis.mediaRequests = [];
  assert.equal(await ladeTelefonAufnahme(42), null);
  globalThis.recordingRow = { aufnahmeZustimmung: false, aufnahmeStatus: "completed", aufnahmeSid: "sid", aufnahmeAccountSid: "account", providerSid: "root" };
  assert.equal(await ladeTelefonAufnahme(42), null);
  assert.equal(globalThis.recordingPaths.length, 0);
  globalThis.recordingRow.aufnahmeZustimmung = true;
  globalThis.recordingMeta = { sid: "sid", call_sid: "wrong", media_url: "https://storage.example.test/audio" };
  await assert.rejects(ladeTelefonAufnahme(42), /passt nicht/);
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
    assert.equal(globalThis.mediaRequests.at(-1).options.headers, undefined, "No API token on media request");
    assert.equal(globalThis.mediaRequests.at(-1).options.maxWeiterleitungen, 0);
    assert.equal(globalThis.recordingPaths.at(-1), "/texml/Accounts/account/Recordings/sid.json");
  }
  console.log("OK — Aufnahmen: Zustimmung, Anrufzuordnung, frische Medienlinks, HTTPS und keine Anbieter-Credentials am Speicher.");
} finally {
  for (const key of ["recordingPaths", "mediaRequests", "recordingRow", "recordingMeta"]) delete globalThis[key];
  rmSync(dir, { recursive: true, force: true });
}
