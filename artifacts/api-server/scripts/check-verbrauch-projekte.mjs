import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "lukas-verbrauch-"));
const stub = join(dir, "db.mjs");
try {
  await writeFile(stub, `
export const db = {};
export const tageskostenTable = {}, liveVerbrauchTable = {}, openaiGuthabenTable = {};
export const meldungen = {id: 'id'};
export const gte = () => {};
export const asc = x => x;
export const eq = (k,v) => row => row[k] === v;
export const inArray = (k,v) => row => v.includes(row[k]);
export const sql = (parts, ...values) => ({parts, values});
`);
  const outfile = join(dir, "test.mjs");
  await build({ stdin: { contents: `
export * from './src/lib/verbrauchsbericht';
export * from './src/lib/projekt-aliasse';
export * from './src/lib/meldungs-status';
export * from './src/lib/meldungen-merge';
export * from './src/lib/live-verbrauch';
export * from '@workspace/db';
`, resolveDir: process.cwd() }, outfile, bundle: true, platform: "node", format: "esm", alias: { "@workspace/db": stub, "drizzle-orm": stub }, logLevel: "silent" });
  const m = await import(outfile);
  const jetzt = new Date("2026-10-05T00:01:00Z");
  const costs = [
    { tag: "2026-10-04", provider: "openai", model: "same", aufrufe: 4, rein: 1_000_000, raus: 200_000, ausCache: 400_000, inCache: 0 },
    { tag: "2026-10-04", provider: "openai", model: "same", quelle: "chat", aufrufe: 2, rein: 10, raus: 20, ausCache: 30, inCache: 40 },
    { tag: "2026-09-01", provider: "openai", model: "old", aufrufe: 1, rein: 9999, raus: 0, ausCache: 0, inCache: 0 },
  ];
  const live = [
    { model: "gpt-live-1", quelle: "telefon", sekunden: 90, beendet: true, gestartetAt: new Date("2026-10-04T23:59:00Z") },
    { model: "gpt-live-1", quelle: "telefon", sekunden: null, beendet: false, gestartetAt: jetzt },
  ];
  const r = m.fasseVerbrauchZusammen(costs, live, 14, jetzt);
  assert.equal(r.tageswerte.length, 14);
  const yesterday = r.tageswerte.at(-2), today = r.tageswerte.at(-1);
  assert.equal(yesterday.gesamt, 1_600_100, "each cache class counted once");
  assert.equal(yesterday.erfasst, true);
  assert.equal(today.erfasst, false, "no rows do not prove zero consumption");
  assert.equal(today.liveOhneMesswert, 1); assert.equal(today.liveOffen, 1);
  assert.equal(yesterday.liveSekunden, 90, "Live stays separate from tokens");
  assert.deepEqual(r.modelle.map(x => x.quelle), ["unzugeordnet", "chat"]);
  assert.equal(r.liveModelle[0].sitzungen, 2);
  assert.equal(r.liveModelle[0].sekunden, 90);

  for (const alias of ["TaxiBB", "Taxi BB", "Taxi-BB Essen", "taxibbessen.de", "https://www.taxibbessen.de/", "issahareb/Taxibbessen", "https://github.com/issahareb/Taxibbessen"]) {
    assert.equal(m.projektSchluessel(alias), "taxibb", alias);
    assert.equal(m.projekteImText(`Was weißt du über ${alias}?`)[0]?.id, "taxibb", alias);
  }
  assert.equal(m.projekteImText("Prüfe TaxiBB.").length, 1);
  assert.equal(m.projekteImText("https://taxibbessen.de/kontakt").length, 1);
  for (const unrelated of ["TaxiBot", "TaxibbExtra", "https://taxibbessen.de.evil.example/", "https://github.com/other/Taxibbessen", "https://github.com/issahareb/Taxibbessen-other"]) {
    assert.equal(m.projektFuerAlias(unrelated), undefined);
    assert.equal(m.projekteImText(unrelated).length, 0, unrelated);
  }
  assert.ok(m.aliasSchluessel(["taxibb"]).includes("taxi_bb"));
  assert.match(m.projektKontext("Taxi BB"), /issahareb\/Taxibbessen/);
  assert.equal(m.projektKontext("TaxiBot"), "");

  const old = { createdAt: new Date("2026-09-01"), geprueftAt: null };
  assert.equal(m.meldungIstVeraltet(old, jetzt.getTime()), true);
  assert.equal(m.meldungIstVeraltet({ ...old, geprueftAt: jetzt }, jetzt.getTime()), false);
  assert.equal(m.normalisiereBetreff("  TAXIBB — Zugang fehlt! "), m.normalisiereBetreff("TaxiBB: Zugang fehlt"));

  let rows = [
    { id: 1, betreff: "Doppel", text: "Quelle vollständig", dringend: true, status: "offen", createdAt: jetzt },
    { id: 2, betreff: "Ziel", text: "Ziel vollständig", dringend: false, status: "offen", createdAt: jetzt },
  ];
  const tx = {
    select: () => ({ from: () => ({ where: pred => ({ orderBy: () => ({ for: async lock => { assert.equal(lock, "update"); return rows.filter(pred); } }) }) }) }),
    update: () => ({ set: values => ({ where: async pred => rows.filter(pred).forEach(row => Object.assign(row, values)) }) }),
  };
  m.db.transaction = async fn => { const copy = structuredClone(rows); try { return await fn(tx); } catch(e) { rows = copy; throw e; } };
  await m.fuehreMeldungenZusammen(1,2);
  assert.equal(rows[1].status, "offen"); assert.equal(rows[1].dringend, true);
  assert.match(rows[1].text, /Ziel vollständig[\s\S]*Quelle vollständig/);
  assert.equal(rows[0].gelesen, true, "merge is not an invented owner answer");
  assert.equal(rows[0].status, "erledigt");
  await assert.rejects(m.fuehreMeldungenZusammen(1,2), /offene/);
  await assert.rejects(m.fuehreMeldungenZusammen(2,2), /verschiedene/);

  let balance;
  m.db.insert = () => ({ values: value => ({ onConflictDoUpdate: ({set}) => ({ returning: async () => { balance = {...value, ...set}; return [balance]; } }) }) });
  await m.bestaetigeGuthaben(17.25, "Test organisation");
  assert.equal(balance.usd, 17.25); assert.equal(balance.id, 1); assert.ok(balance.bestaetigtAt instanceof Date);
  console.log("OK — Verbrauch exakt, Messlücken sichtbar, Projektaliase begrenzt, Meldungszusammenführung bleibt offen, Guthaben datiert.");
} finally { await rm(dir, { recursive: true, force: true }); }
