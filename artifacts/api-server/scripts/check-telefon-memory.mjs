import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const directory = await mkdtemp(join(tmpdir(), 'lukas-phone-memory-'));
globalThis.__phoneMemoryQuery = async () => { throw new Error('Unexpected SQL in isolated test'); };
try {
  const output = join(directory, 'memory.mjs');
  await build({ entryPoints: [resolve(dirname(fileURLToPath(import.meta.url)), '../src/lib/ai/telefon-memory.ts')], outfile: output,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{ name: 'phone-memory-isolation', setup(b) {
      b.onResolve({ filter: /^(@workspace\/db|\.\.\/logger)$/ }, args => ({ path: args.path, namespace: 'phone-memory-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'phone-memory-stub' }, args => ({ loader: 'js', contents: args.path === '@workspace/db'
        ? 'export const pool={query: q=>globalThis.__phoneMemoryQuery(q)};'
        : 'export const logger={info(){},warn(){},error(){}};' }));
    } }] });
  const api = await import(pathToFileURL(output).href);
  const { phoneNumber, boundedText, PhoneTranscript, preparePhoneMemory } = api;
  assert.equal(phoneNumber('+49 151 00000001'), '4915100000001');
  assert.equal(phoneNumber('0049 151 00000001'), '4915100000001');
  assert.equal(phoneNumber('"Caller" <sip:4915100000001@example.com>'), '4915100000001');
  assert.equal(phoneNumber('unknown'), '');
  assert.equal(boundedText('ä😀Z', 5), 'ä');
  const t = new PhoneTranscript();
  const part = { role: 'assistant', text: 'ja', startMs: 0, endMs: 100 };
  t.append(part); t.append(part); t.append({ ...part, text: ' ja', startMs: 100, endMs: 200 });
  t.append({ role: 'user', text: 'Garten?', startMs: 50, endMs: 150 });
  assert.equal(t.revision, 3);
  assert.equal(JSON.parse(t.snapshot()).fragments.filter(p => p.role === 'assistant').map(p => p.text).join(''), 'ja ja');
  t.append({ ...part, startMs: -1 }); assert.equal(t.revision, 3);
  for (let i = 0; i < 20; i++) t.append({ ...part, startMs: 1000+i, endMs: 2000+i, text: 'ä'.repeat(8000) });
  assert.equal(JSON.parse(t.snapshot()).truncated, true);
  assert.ok(Buffer.byteLength(t.snapshot()) < 70000);
  const date = new Date('2026-01-01T00:00:00Z');
  const contact = { id: 1, nummer: '4915100000001', name: 'Fouad', stufe: 'oeffentlich', aufnahme_zustimmung: true, aufnahme_bestaetigt_am: date, created_at: date };
  const other = { ...contact, id: 2, nummer: '4915100000002', name: 'Anderer Kontakt' };
  const contacts = new Map([[contact.nummer, contact], [other.nummer, other]]), records = new Map();
  const legacy = { created_at: date, anlass: 'Wegen des Garteninserats nachfragen.', ergebnis: 'gewaehlt', ziel_status: 'completed', live_bereit: true };
  let writes = 0, failOnce = false;
  const store = {
    async read(number, visibility, query, sessionId) {
      const c = contacts.get(number) ?? null;
      return { contact: c, calls: c?.id === 1 ? [legacy] : [], history: c?.aufnahme_zustimmung
        ? [...records.values()].filter(r => r.contact.id === c.id && r.visibility === visibility && r.sessionId !== sessionId)
          .map(r => ({ updated_at: date, transkript: r.transcript, vollstaendig: r.complete })) : [] };
    },
    async save(value) {
      writes++;
      if (failOnce) { failOnce = false; throw new Error('Transient DB failure'); }
      if (!contacts.get(value.peer.nummer)?.aufnahme_zustimmung) return false;
      records.set(value.sessionId, structuredClone(value)); return true;
    },
  };
  assert.equal(await preparePhoneMemory('unknown', { nummer: '4915100000099', richtung: 'eingehend' }, 'public', store), undefined);
  const first = await preparePhoneMemory('first', { nummer: '+4915100000001', richtung: 'ausgehend' }, 'public', store);
  assert.match(await first.recall('Hast du noch Interesse am Garten?'), /Garteninserat/);
  first.observe({ role: 'assistant', text: 'Ich rufe wegen des Gartens an.', startMs: 0, endMs: 500 });
  first.observe({ role: 'user', text: 'Eine Besichtigung ist Samstag möglich.', startMs: 600, endMs: 900 });
  await first.close(); await first.close(); assert.equal(writes, 1);
  first.observe({ ...part, text: 'AFTER_CLOSE' }); assert.ok(!records.get('first').transcript.includes('AFTER_CLOSE'));
  const second = await preparePhoneMemory('second', { nummer: '004915100000001', richtung: 'eingehend' }, 'public', store);
  assert.match(JSON.stringify(second.input), /Samstag/);
  assert.match(await second.recall('Besichtigung'), /Samstag/);
  const isolated = await preparePhoneMemory('other', { nummer: other.nummer, richtung: 'ausgehend' }, 'public', store);
  assert.ok(!JSON.stringify(isolated.input).includes('Samstag'));
  assert.ok(!(await isolated.recall('Garten')).includes('Garteninserat'));
  const privateSession = await preparePhoneMemory('private', { nummer: contact.nummer, richtung: 'ausgehend' }, 'private', store);
  assert.ok(!JSON.stringify(privateSession.input).includes('Samstag'));
  await privateSession.close(); await isolated.close(); await second.close();
  const retry = await preparePhoneMemory('retry', { nummer: contact.nummer, richtung: 'ausgehend' }, 'public', store);
  retry.observe(part); failOnce = true; await retry.close(false); assert.equal(records.get('retry').complete, false);
  const revoke = await preparePhoneMemory('revoked', { nummer: contact.nummer, richtung: 'ausgehend' }, 'public', store);
  revoke.observe(part); contact.aufnahme_zustimmung = false; await revoke.close(); assert.ok(!records.has('revoked'));
  const withoutConsent = await preparePhoneMemory('no-consent', { nummer: contact.nummer, richtung: 'eingehend' }, 'public', store);
  withoutConsent.observe(part); await withoutConsent.close(); assert.ok(!records.has('no-consent'));
  assert.ok(!JSON.stringify(withoutConsent.input).includes('Samstag'));
  assert.match(await withoutConsent.recall('Garten'), /Garteninserat/);
  console.log('Phone memory: isolated restart/recall, legacy call reason, overlap, repetition, limits, consent and finalization checks passed.');

  if (process.env.PHONE_MEMORY_SQL_URL) {
    const { default: pg } = await import('pg');
    const root = new pg.Pool({ connectionString: process.env.PHONE_MEMORY_SQL_URL });
    const schema = 'phone_memory_check_' + process.pid;
    await root.query(`CREATE SCHEMA ${schema}`);
    const sql = new pg.Pool({ connectionString: process.env.PHONE_MEMORY_SQL_URL, options: `-c search_path=${schema}` });
    try {
      await sql.query(`CREATE TABLE lukas_telefon_nummern (id serial PRIMARY KEY, nummer text, name text, stufe text, aufnahme_zustimmung boolean, aufnahme_bestaetigt_am timestamptz, created_at timestamptz DEFAULT now());
        CREATE TABLE lukas_telefon_anrufe (nummer text, stufe text, created_at timestamptz DEFAULT now(), anlass text, ergebnis text, ziel_status text, live_bereit boolean);
        CREATE TABLE lukas_telefon_gedaechtnis (session_id text PRIMARY KEY, kontakt_id integer REFERENCES lukas_telefon_nummern(id) ON DELETE CASCADE, nummer text, sichtbarkeit text, richtung text, transkript text, revision integer, vollstaendig boolean, zustimmung_am timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());`);
      await sql.query("INSERT INTO lukas_telefon_nummern (nummer,name,stufe,aufnahme_zustimmung,aufnahme_bestaetigt_am,created_at) VALUES ($1,'Fouad','oeffentlich',true,$2,$2)", [contact.nummer, date]);
      await sql.query("INSERT INTO lukas_telefon_anrufe VALUES ($1,'oeffentlich',now(),'Garteninserat besprechen','gewaehlt','completed',true)", [contact.nummer]);
      globalThis.__phoneMemoryQuery = q => sql.query(q);
      const a = await preparePhoneMemory('sql-first', { nummer: contact.nummer, richtung: 'ausgehend' }, 'public');
      assert.match(await a.recall('Hast du noch Interesse am Garten?'), /Garteninserat/);
      a.observe({ ...part, text: 'Besichtigung am Samstag.' }); await a.close();
      const b = await preparePhoneMemory('sql-second', { nummer: contact.nummer, richtung: 'eingehend' }, 'public');
      assert.match(JSON.stringify(b.input), /Samstag/); assert.match(await b.recall('Besichtigung'), /Samstag/); await b.close();
      assert.equal((await sql.query('SELECT count(*)::integer AS n FROM lukas_telefon_gedaechtnis')).rows[0].n, 1);
      assert.equal(await preparePhoneMemory('sql-private', { nummer: contact.nummer, richtung: 'eingehend' }, 'private'), undefined);
      await sql.query('UPDATE lukas_telefon_nummern SET aufnahme_zustimmung=false');
      const c = await preparePhoneMemory('sql-revoked', { nummer: contact.nummer, richtung: 'eingehend' }, 'public');
      assert.ok(!JSON.stringify(c.input).includes('Samstag')); c.observe(part); await c.close();
      await sql.query('DELETE FROM lukas_telefon_nummern');
      assert.equal((await sql.query('SELECT count(*)::integer AS n FROM lukas_telefon_gedaechtnis')).rows[0].n, 0);
      console.log('Phone memory: real PostgreSQL insert/upsert, full-text recall, scope, revocation and cascade deletion passed.');
    } finally { await sql.end(); await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end(); }
  }
} finally { await rm(directory, { recursive: true, force: true }); delete globalThis.__phoneMemoryQuery; }
