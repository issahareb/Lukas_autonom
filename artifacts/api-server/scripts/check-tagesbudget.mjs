/*
 * Prueft die Kostengrenze pro Tag — und vor allem, dass sie das Richtige
 * bremst.
 *
 * Es gab bisher nur ein Budget pro ZUG. Ein Zug kann diszipliniert sein und
 * trotzdem achtundvierzig Mal am Tag laufen; die Rechnung entsteht aus der
 * Summe. Bemerkt haette man das erst auf der Abrechnung.
 *
 * Drei Dinge, und das dritte ist das, woran so etwas meistens scheitert:
 *  1. Es zaehlt ueber Neustarts hinweg (Datenbank statt Arbeitsspeicher).
 *  2. Es bremst autonome Laeufe.
 *  3. Es bremst NICHT Issas eigene Anfragen und nicht das lokale Modell.
 *     Eine Grenze, die den Besitzer aussperrt oder kostenlose Arbeit
 *     verhindert, wird beim ersten Aerger abgeschaltet — und dann gibt es
 *     gar keine mehr.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".budget-check-"));
const out = join(dir, "budget.mjs");
const attrappe = join(dir, "db.mjs");

writeFileSync(
  attrappe,
  `globalThis.__zeilen = [];
const t = (n) => new Proxy({ __name: n }, { get: (o, k) => (k === "__name" ? n : String(k)) });
export const tageskostenTable = t("tageskosten");
export const eq = (f, w) => (z) => z[f] === w;
export const isNull = (f) => (z) => z[f] === null || z[f] === undefined;
export const isNotNull = (f) => (z) => z[f] !== null && z[f] !== undefined;
export const or = (...b) => (z) => b.filter(Boolean).some((fn) => fn(z));
export const not = (b) => (z) => !b(z);
export const ne = (f, w) => (z) => z[f] !== w;
export const lt = (f, w) => (z) => z[f] < w;
export const lte = (f, w) => (z) => z[f] <= w;
export const notInArray = (f, w) => (z) => !(w ?? []).includes(z[f]);
export const like = () => () => true;
export const asc = () => ({});
export const and = (...b) => (z) => b.filter(Boolean).every((fn) => fn(z));
export const sql = (teile, ...werte) => ({ __sql: true, teile, werte });
export const db = {
  select: () => ({ from: () => ({ where: (b) => Promise.resolve(globalThis.__zeilen.filter(b ?? (() => true))) }) }),
  insert: () => ({
    values: (v) => ({
      onConflictDoUpdate: async ({ set }) => {
        const vorhanden = globalThis.__zeilen.find(
          (z) => z.tag === v.tag && z.provider === v.provider && z.model === v.model,
        );
        if (!vorhanden) { globalThis.__zeilen.push({ ...v }); return; }
        // Aufaddieren wie im echten SQL.
        vorhanden.aufrufe += 1;
        vorhanden.rein += v.rein;
        vorhanden.raus += v.raus;
        vorhanden.ausCache += v.ausCache ?? 0;
        vorhanden.inCache += v.inCache ?? 0;
      },
    }),
  }),
};
export const logger = { info(){}, warn(){}, error(){}, debug(){} };`,
);

await build({
  entryPoints: ["src/lib/tagesbudget.ts"],
  bundle: true, format: "esm", platform: "node", outfile: out,
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
  plugins: [{ name: "a", setup(b) { b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: attrappe })); } }],
  logLevel: "silent",
});

const { verbucheTag, tagesstand, budgetTor, budgetHinweis } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => { if (!bedingung) { console.error(`FEHLER: ${was}`); fehler++; } };

// ── 1. Zählen und Aufaddieren ────────────────────────────────────────────
globalThis.__zeilen = [];
await verbucheTag({ provider: "openai", model: "gpt-5.6", rein: 1000, raus: 200 });
await verbucheTag({ provider: "openai", model: "gpt-5.6", rein: 500, raus: 100 });
await verbucheTag({ provider: "anthropic", model: "claude", rein: 300, raus: 50 });
{
  const s = await tagesstand();
  pruefe("Tokens werden aufaddiert", s.tokens === 1000 + 200 + 500 + 100 + 300 + 50);
  pruefe("Aufrufe ebenso", s.aufrufe === 3);
  pruefe("und je Modell getrennt", s.jeModell.length === 2);
  pruefe("das teuerste Modell steht oben", s.jeModell[0].model === "gpt-5.6");
}

// ── 2. Kostenlose Arbeit zählt NICHT ─────────────────────────────────────
{
  const vorher = (await tagesstand()).tokens;
  await verbucheTag({ provider: "local", model: "lokal", rein: 999999, raus: 999999 });
  pruefe("das lokale Modell zählt nicht aufs Budget", (await tagesstand()).tokens === vorher);
}

// ── 3. Die Schwellen ─────────────────────────────────────────────────────
process.env.LUKAS_TAGESBUDGET_WARNUNG = "1000";
delete process.env.LUKAS_TAGESBUDGET_STOPP;
{
  const s = await tagesstand();
  pruefe("die Warnschwelle greift", s.ueberWarnung === true);
  pruefe("ohne gesetzten Stopp gibt es keinen", s.ueberStopp === false);
  const tor = await budgetTor({ istIssa: false });
  pruefe("und die Warnung allein bremst nichts", tor.weiter === true);
  pruefe("der Hinweis landet im Prompt", /HEUTIGER VERBRAUCH/.test(await budgetHinweis()));
}

process.env.LUKAS_TAGESBUDGET_STOPP = "1000";
{
  pruefe("mit gesetztem Stopp wird der autonome Lauf gebremst", (await budgetTor({ istIssa: false })).weiter === false);
  /*
   * Die wichtigste Zeile: Issa wird NICHT ausgesperrt. Eine Grenze, die den
   * Besitzer trifft, wird beim ersten Ärger abgeschaltet — und dann gibt es
   * gar keine mehr.
   */
  pruefe("Issas eigene Anfrage läuft weiter", (await budgetTor({ istIssa: true })).weiter === true);
  pruefe("und die Meldung nennt Zahl und Grenze", /1\.000|1000/.test((await budgetTor({ istIssa: false })).grund ?? ""));
}

process.env.LUKAS_TAGESBUDGET_STOPP = "99999999";
pruefe("weit unter der Grenze läuft alles normal", (await budgetTor({ istIssa: false })).weiter === true);
delete process.env.LUKAS_TAGESBUDGET_STOPP;
delete process.env.LUKAS_TAGESBUDGET_WARNUNG;

// ── 4. Ohne Datenbank kein Absturz ───────────────────────────────────────
{
  const kaputt = { get: () => { throw new Error("DB weg"); } };
  globalThis.__zeilen = new Proxy([], kaputt);
  let geworfen = false;
  try { await tagesstand(); } catch { geworfen = true; }
  globalThis.__zeilen = [];
  pruefe("eine kaputte Datenbank kippt die Budgetprüfung nicht", !geworfen);
}

if (fehler > 0) process.exit(1);
console.log("OK — Tagesbudget: zählt über Neustarts, bremst autonome Läufe, nicht Issa und nicht das lokale Modell.");
