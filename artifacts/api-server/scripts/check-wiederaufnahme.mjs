/*
 * Was passiert, wenn Lukas mitten in der Arbeit abgeschnitten wird.
 *
 * DER FALL ist der Normalfall, nicht der Sonderfall: ein autonomer Lauf darf
 * bis zu fuenfundzwanzig Minuten dauern, und Railway startet bei jedem Deploy
 * neu. Bis hierher war der Lauf dann einfach weg — die Episode blieb FUER
 * IMMER offen, und Lukas erfuhr beim naechsten Start nichts davon. Hatte der
 * abgerissene Lauf schon eine Mail geschickt oder einen Befehl abgesetzt,
 * konnte er es wiederholen, ohne es zu wissen.
 *
 * Geprueft werden fuenf Eigenschaften. Die dritte und die vierte sind die,
 * an denen so etwas kippt:
 *
 *  1. Ein abgerissener Lauf wird gefunden und abgeschlossen.
 *  2. Der Vermerk sagt, was WIRKLICH bekannt ist — dass er abriss. Keine
 *     erfundene Zusammenfassung: es KANN ein Ergebnis gegeben haben, es
 *     steht nur nirgends.
 *  3. Ein Lauf, der GERADE LAEUFT, wird NICHT angefasst. Waehrend eines
 *     Deploys laeuft der alte Prozess kurz weiter; wuerde man dessen Episode
 *     abschliessen, waere das schlimmer als das Problem.
 *  4. Der Hinweis warnt vor dem WIEDERHOLEN. Ein Hinweis, der nur "mach
 *     weiter" sagt, laedt zur doppelten Mail ein — und die Versandsperre
 *     deckt nur zehn Minuten ab, ein Neustart kann laenger her sein.
 *  5. Eine unerreichbare Datenbank bremst nichts aus. Der Start darf daran
 *     nicht scheitern.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".wiederaufnahme-check-"));
const out = join(dir, "w.mjs");
const attrappe = join(dir, "db.mjs");

writeFileSync(
  attrappe,
  `globalThis.__episoden = [];
globalThis.__dbKaputt = false;
const t = (n) => new Proxy({ __name: n }, { get: (o, k) => (k === "__name" ? n : String(k)) });
export const episodesTable = t("episoden");
export const eq = (f, w) => (z) => z[f] === w;
export const isNull = (f) => (z) => z[f] === null || z[f] === undefined;
export const lt = (f, w) => (z) => new Date(z[f]).getTime() < new Date(w).getTime();
export const and = (...b) => (z) => b.filter(Boolean).every((fn) => fn(z));
export const db = {
  select: () => ({ from: () => ({ where: async (b) => {
    if (globalThis.__dbKaputt) throw new Error("DB weg");
    return globalThis.__episoden.filter(b);
  } }) }),
  update: () => ({ set: (w) => ({ where: async (b) => {
    for (const z of globalThis.__episoden.filter(b)) Object.assign(z, w);
  } }) }),
};
export const logger = { info(){}, warn(){}, error(){}, debug(){} };`,
);

await build({
  entryPoints: ["src/lib/lauf-wiederaufnahme.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
  plugins: [
    { name: "a", setup(b) { b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: attrappe })); } },
  ],
  logLevel: "silent",
});

const { abgerisseneLaeufeAbschliessen, unterbrechungsHinweis } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

const vorMinuten = (m) => new Date(Date.now() - m * 60 * 1000);

// ── 1. und 2. Ein abgerissener Lauf wird gefunden und ehrlich vermerkt ───
globalThis.__episoden = [
  { id: 7, kind: "autonomer_lauf", startedAt: vorMinuten(90), endedAt: null, summary: "" },
];
{
  const gefunden = await abgerisseneLaeufeAbschliessen();
  pruefe("der abgerissene Lauf wird gefunden", gefunden.length === 1 && gefunden[0].id === 7);
  pruefe("er wird abgeschlossen", globalThis.__episoden[0].endedAt instanceof Date);
  pruefe(
    "der Vermerk sagt, dass er ABGEBROCHEN wurde",
    /Abgebrochen/.test(globalThis.__episoden[0].summary),
  );
  pruefe(
    "und er behauptet NICHT, es habe kein Ergebnis gegeben",
    /steht nirgends|nachgesehen/.test(globalThis.__episoden[0].summary),
  );
  pruefe("die Laufzeit steht dabei", gefunden[0].minuten >= 89 && gefunden[0].minuten <= 91);
}

// ── 3. Ein LAUFENDER Lauf wird nicht angefasst ───────────────────────────
/*
 * Waehrend eines Deploys laeuft der alte Prozess kurz weiter. Wuerde hier
 * dessen Episode abgeschlossen, waere die Reparatur schlimmer als der
 * Schaden: Lukas bekaeme gemeldet, seine eigene laufende Arbeit sei
 * abgebrochen — und wuerde anfangen, sie zu wiederholen.
 */
globalThis.__episoden = [
  { id: 8, kind: "autonomer_lauf", startedAt: vorMinuten(4), endedAt: null, summary: "" },
];
{
  const gefunden = await abgerisseneLaeufeAbschliessen();
  pruefe("ein Lauf von vor vier Minuten gilt NICHT als abgerissen", gefunden.length === 0);
  pruefe("und er bleibt offen", globalThis.__episoden[0].endedAt === null);
}

// Und eine Episode ANDERER Art gehört nicht hierher.
globalThis.__episoden = [
  { id: 9, kind: "chat", startedAt: vorMinuten(300), endedAt: null, summary: "" },
];
{
  const gefunden = await abgerisseneLaeufeAbschliessen();
  pruefe("ein offener Chat ist kein abgerissener autonomer Lauf", gefunden.length === 0);
  pruefe("er wird nicht angefasst", globalThis.__episoden[0].endedAt === null);
}

// Und ein bereits abgeschlossener Lauf wird nicht erneut erfasst.
globalThis.__episoden = [
  { id: 10, kind: "autonomer_lauf", startedAt: vorMinuten(300), endedAt: vorMinuten(280), summary: "fertig" },
];
{
  const gefunden = await abgerisseneLaeufeAbschliessen();
  pruefe("ein abgeschlossener Lauf wird nicht noch einmal erfasst", gefunden.length === 0);
  pruefe("und sein Ergebnis bleibt stehen", globalThis.__episoden[0].summary === "fertig");
}

// ── 4. Der Hinweis warnt vor dem Wiederholen ─────────────────────────────
{
  pruefe("ohne Abbruch gibt es keinen Hinweis", unterbrechungsHinweis([]) === null);

  const text = unterbrechungsHinweis([{ id: 7, begonnen: vorMinuten(90), minuten: 90 }]);
  pruefe("mit Abbruch steht ein Hinweis da", typeof text === "string" && text.length > 50);
  /*
   * Das ist der eigentliche Punkt. Ein Hinweis, der nur "mach weiter" sagt,
   * ist schlimmer als keiner: er laedt dazu ein, eine Mail ein zweites Mal
   * zu schicken.
   */
  pruefe(
    "er warnt ausdrücklich davor, etwas mit Außenwirkung zu wiederholen",
    /[Ww]iederhol/.test(text) && /Außenwirkung/.test(text),
  );
  pruefe("er sagt, zuerst NACHZUSEHEN", /[Ss]ieh nach|nachsehen/.test(text));
  pruefe("und er nennt, wann es war", /\d{1,2}\.\d{1,2}\.\d{2,4}|\d{1,2}:\d{2}/.test(text));

  const zwei = unterbrechungsHinweis([
    { id: 7, begonnen: vorMinuten(90), minuten: 90 },
    { id: 8, begonnen: vorMinuten(200), minuten: 25 },
  ]);
  pruefe("bei zweien steht die Anzahl dabei", /2 frühere Läufe/.test(zwei));
}

// ── 5. Ohne Datenbank bremst es nichts aus ───────────────────────────────
globalThis.__episoden = [
  { id: 11, kind: "autonomer_lauf", startedAt: vorMinuten(90), endedAt: null, summary: "" },
];
globalThis.__dbKaputt = true;
{
  let geworfen = false;
  let gefunden = null;
  try {
    gefunden = await abgerisseneLaeufeAbschliessen();
  } catch {
    geworfen = true;
  }
  pruefe("eine kaputte Datenbank wirft nicht durch", !geworfen);
  pruefe("es kommt eine leere Liste zurück, kein Fehler", Array.isArray(gefunden) && gefunden.length === 0);
}
globalThis.__dbKaputt = false;

if (fehler > 0) process.exit(1);
console.log(
  "OK — Wiederaufnahme: abgerissene Läufe werden gefunden und ehrlich vermerkt, " +
    "laufende nicht angefasst, und der Hinweis warnt vor dem Wiederholen.",
);
