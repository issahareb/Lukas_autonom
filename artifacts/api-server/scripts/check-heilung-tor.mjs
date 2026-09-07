/*
 * Prueft, dass die Selbstheilung das Tagesbudget respektiert.
 *
 * ANLASS: diese Kette laeuft alle zwei Stunden von selbst und startet, sobald
 * sich IRGENDEIN Fehler dreimal in 24 Stunden haeuft. Sie kostet dann vier
 * volle Agentenlaeufe — Analyst, Entwickler, Pruefer, dann Lukas' eigene
 * Entscheidung. Der autonome Lauf fragt an dieser Stelle seit jeher nach dem
 * Budget; die Selbstheilung tat es nicht, obwohl sie oefter feuert.
 *
 * Das Unangenehme daran ist die Richtung: an einem Tag mit vielen Stoerungen
 * haeuft sich mehr, also feuert sie oefter. Sie ist genau dann am teuersten,
 * wenn ohnehin etwas im Argen liegt — und an so einem Tag standen 228
 * Stoerungen und 4,2 Millionen Tokens auf der Uhr.
 *
 * Drei Eigenschaften:
 *  1. Bei erreichtem Budget laeuft die Kette GAR NICHT — nicht "kuerzer".
 *  2. Das Tor wird VOR dem Fehlerprotokoll gefragt. Ein Lauf, der ohnehin
 *     nicht laufen darf, soll nicht vorher noch die Datenbank belaesten.
 *  3. Unter dem Budget aendert sich nichts. Ein Tor, das im Normalfall bremst,
 *     waere schlimmer als keins.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".heilung-check-"));
const out = join(dir, "h.mjs");

const f = (n, i) => { const p = join(dir, n); writeFileSync(p, i); return p; };

// Jede Attrappe protokolliert, DASS sie gerufen wurde — daraus liest der Test
// die Reihenfolge ab.
const spuren = f(
  "spuren.mjs",
  `globalThis.__spur = [];
   export const merke = (was) => globalThis.__spur.push(was);`,
);
const budget = f(
  "budget.mjs",
  `import { merke } from "${spuren}";
   export async function budgetTor() {
     merke("tor");
     return process.env.T_BUDGET_VOLL === "1"
       ? { weiter: false, grund: "Tagesbudget erreicht", stand: {} }
       : { weiter: true, stand: {} };
   }`,
);
const debuglog = f(
  "debug.mjs",
  `import { merke } from "${spuren}";
   export function recordDebugEvent(){}
   export async function fehlerGruppen() {
     merke("fehlerprotokoll");
     return [{ signatur: "s1", scope: "netz", anzahl: 5, beispiel: "fetch failed", zuletzt: "jetzt" }];
   }`,
);
const subs = f(
  "subs.mjs",
  `import { merke } from "${spuren}";
   export async function fixError() { merke("kette"); return "Gutachten"; }`,
);
const brain = f(
  "brain.mjs",
  `import { merke } from "${spuren}";
   export async function runLukasTurn() { merke("lukas"); return "ok"; }`,
);
const logger = f("log.mjs", `export const logger = { info(){},warn(){},error(){},debug(){} };`);
const sperre = f("sperre.mjs", `export const mitSperre = (n, fn) => fn();`);

await build({
  entryPoints: ["src/lib/selbstheilung.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  external: ["node:async_hooks"],
  plugins: [
    {
      name: "attrappen",
      setup(b) {
        b.onResolve({ filter: /(^|\/)tagesbudget$/ }, () => ({ path: budget }));
        b.onResolve({ filter: /(^|\/)debug-log$/ }, () => ({ path: debuglog }));
        b.onResolve({ filter: /(^|\/)subagents$/ }, () => ({ path: subs }));
        b.onResolve({ filter: /(^|\/)lukas-brain$/ }, () => ({ path: brain }));
        b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: logger }));
        b.onResolve({ filter: /(^|\/)lauf-sperre$/ }, () => ({ path: sperre }));
      },
    },
  ],
});

const { runSelbstheilung } = await import(out);

const fehler = [];
const pruefe = (b, t) => { if (!b) fehler.push(t); };

/* 1. Budget voll: gar nichts. */
process.env.T_BUDGET_VOLL = "1";
globalThis.__spur = [];
await runSelbstheilung();
const voll = globalThis.__spur;
pruefe(voll.includes("tor"), "Das Tor muss gefragt werden");
pruefe(
  !voll.includes("kette"),
  "Bei erreichtem Budget darf die Kette NICHT laufen (Spur: " + JSON.stringify(voll) + ")",
);
pruefe(!voll.includes("lukas"), "Und Lukas' Zug danach auch nicht");
pruefe(
  !voll.includes("fehlerprotokoll"),
  "Das Tor gehört VOR das Fehlerprotokoll — ein Lauf, der nicht laufen darf, soll die Datenbank nicht belasten",
);
pruefe(voll[0] === "tor", "Das Tor muss das ERSTE sein");

/* 2. Budget frei: alles wie bisher. */
delete process.env.T_BUDGET_VOLL;
globalThis.__spur = [];
await runSelbstheilung();
const frei = globalThis.__spur;
pruefe(frei.includes("kette"), "Unter dem Budget muss die Kette laufen");
pruefe(frei.includes("lukas"), "Und Lukas muss danach entscheiden");
pruefe(
  frei.indexOf("kette") < frei.indexOf("lukas"),
  "Erst die Kette, dann Lukas — nicht die Kette entscheidet, sondern er",
);

rmSync(dir, { recursive: true, force: true });

if (fehler.length) {
  console.error("FEHLER — Selbstheilung/Budget:");
  for (const f of fehler) console.error("  - " + f);
  process.exit(1);
}
console.log(
  "OK — Selbstheilung: das Tagesbudget wird zuerst gefragt, bei erreichtem Budget " +
    "läuft die Kette gar nicht, darunter unverändert.",
);
