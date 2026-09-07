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
globalThis.__herkunft = [];
const t = (n) => new Proxy({ __name: n }, { get: (o, k) => (k === "__name" ? n : String(k)) });
export const tageskostenTable = t("tageskosten");
/*
 * Zwei Buecher, und die Attrappe muss sie auseinanderhalten.
 *
 * Seit die Buchhaltung neben den Tageskosten je Modell auch den Verbrauch je
 * HERKUNFT fuehrt, schreibt ein einziger Modellaufruf in beide Tabellen. Eine
 * Attrappe, die jede Einfuegung in denselben Topf legt, zaehlt danach jeden
 * Aufruf doppelt und meldet einen Fehler, den es im Code nicht gibt.
 */
export const verbrauchHerkunftTable = t("herkunft");
export const uebergabenTable = t("uebergaben");
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
  // Lesen muss die Tabelle genauso unterscheiden wie Schreiben — sonst
  // beantwortet die Attrappe eine Frage aus dem falschen Buch.
  select: () => ({
    from: (tab) => ({
      where: (b) =>
        Promise.resolve(
          (tab?.__name === "herkunft" ? globalThis.__herkunft : globalThis.__zeilen).filter(
            b ?? (() => true),
          ),
        ),
    }),
  }),
  insert: (tab) => ({
    values: (v) => ({
      onConflictDoUpdate: async ({ set }) => {
        const inHerkunft = tab?.__name === "herkunft";
        const ziel = inHerkunft ? globalThis.__herkunft : globalThis.__zeilen;
        const vorhanden = ziel.find((z) =>
          inHerkunft
            ? z.tag === v.tag && z.herkunft === v.herkunft
            : z.tag === v.tag && z.provider === v.provider && z.model === v.model,
        );
        if (!vorhanden) { ziel.push({ ...v }); return; }
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

const { verbucheTag, tagesstand, budgetTor, budgetHinweis, herkunftHeute } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => { if (!bedingung) { console.error(`FEHLER: ${was}`); fehler++; } };

// ── 1. Zählen und Aufaddieren ────────────────────────────────────────────
globalThis.__zeilen = [];
globalThis.__herkunft = [];
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

// ── 5. Wohin der Tag ging ────────────────────────────────────────────────
/*
 * Die Frage, die an dem Tag mit 4,2 Millionen Tokens unbeantwortbar war.
 * "Welches Modell" stand da; "wer hat es geschickt" nicht — Chat, autonomer
 * Lauf, Selbstheilung und neun Mitarbeiter laufen alle ueber denselben
 * Modellpfad.
 */
globalThis.__zeilen = [];
globalThis.__herkunft = [];
await verbucheTag({ provider: "openai", model: "gpt-5.6", rein: 100, raus: 10, herkunft: "chat" });
await verbucheTag({ provider: "openai", model: "gpt-5.6", rein: 900, raus: 90, herkunft: "mitarbeiter:scraper" });
await verbucheTag({ provider: "anthropic", model: "claude", rein: 400, raus: 40, herkunft: "mitarbeiter:scraper" });
await verbucheTag({ provider: "openai", model: "gpt-5.6", rein: 50, raus: 5 });
{
  const woher = await herkunftHeute();
  pruefe("die Herkunft wird gebucht", woher.length === 3);
  pruefe(
    "das Teuerste steht oben",
    woher[0]?.herkunft === "mitarbeiter:scraper" && woher[0]?.tokens === 1430,
  );
  pruefe("gleiche Herkunft über verschiedene Modelle fällt zusammen", woher[0]?.aufrufe === 2);
  pruefe(
    "ohne Angabe landet es unter 'unbekannt', nicht im Nichts",
    woher.some((z) => z.herkunft === "unbekannt" && z.tokens === 55),
  );
  pruefe("das Herkunftsbuch verfälscht die Tageskosten nicht", (await tagesstand()).tokens === 1595);
}

if (fehler > 0) process.exit(1);
console.log("OK — Tagesbudget: zählt über Neustarts, bremst autonome Läufe, nicht Issa und nicht das lokale Modell.");
