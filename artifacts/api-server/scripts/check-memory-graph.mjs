/*
 * Prueft den gezielten Zugriff aufs Gedaechtnis ueber den Graphen.
 *
 * Anlass: Jede Erinnerungsfrage las bisher 500 Erinnerungen, 300 Claims, 150
 * Episoden und bis zu 300 Chat-Zeilen und bewertete alles in JavaScript — ein
 * voller Durchlauf pro Nachricht, der mit jeder neuen Erinnerung teurer wird.
 * Gefragt ist das Gegenteil: beim genannten Ding einsteigen und von dort aus
 * weitergehen.
 *
 * Zwei Dinge muessen dafuer stimmen, und beide sind hier geprueft:
 *   1. Aus der Frage wird der RICHTIGE Einstieg gebildet — "Hareb Digital"
 *      als ein Knoten, nicht "mein" oder "was".
 *   2. Der Lauf folgt Kanten in BEIDE Richtungen. "issa gruendete Hareb
 *      Digital" verbindet dieselben zwei Knoten wie "hareb_digital
 *      gegruendet_von issa" — wer nur ueber das Subjekt sucht, findet die
 *      halbe Nachbarschaft nicht.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".graph-check-"));
const out = join(dir, "graph.mjs");
const attrappe = join(dir, "attrappe.mjs");

// Nur so viel Attrappe, dass das Modul laedt: geprueft wird die reine Logik.
writeFileSync(
  attrappe,
  "export const db = new Proxy({}, { get: () => () => ({}) });\n" +
    "export const claimsTable = { value: {} }; export const memoriesTable = {};\n" +
    "export const episodesTable = {};\n" +
    "export const logger = { warn() {}, info() {}, error() {} };\n" +
    "export const and = () => ({}); export const eq = () => ({});\n" +
    "export const or = () => ({}); export const desc = () => ({});\n" +
    "export const inArray = () => ({});\n" +
    "export const sql = (...a) => ({ raw: a });\n",
);

await build({
  entryPoints: ["src/lib/memory-graph.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
  plugins: [
    {
      name: "attrappen",
      setup(b) {
        b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: attrappe }));
      },
    },
  ],
});

const { entitaetskandidaten, laufeGraph, normEntitaet } = await import(out);

let fehler = 0;
const pruefe = (bedingung, text) => {
  if (!bedingung) {
    console.error("FEHLER — " + text);
    fehler++;
  }
};

// ── 1. Einstieg aus der Frage ──────────────────────────────────────────────
const frage = "Was weißt du über mein Unternehmen Hareb Digital?";
const kandidaten = entitaetskandidaten(frage);

pruefe(
  kandidaten.includes("hareb_digital"),
  'Die Wortfolge "Hareb Digital" muss als ein Knoten entstehen, nicht als zwei',
);
pruefe(
  kandidaten.indexOf("hareb_digital") < kandidaten.indexOf("hareb"),
  "Die laengere Wortfolge muss vor der kuerzeren stehen — sonst landet der Einstieg auf dem allgemeineren Knoten",
);
for (const wort of ["was", "mein", "über", "du"]) {
  pruefe(!kandidaten.includes(wort), `Allerweltswort "${wort}" darf kein Einstieg werden`);
}

// ── 2. Lauf durch den Graphen ──────────────────────────────────────────────
const claim = (id, subject, predicate, value, extra = {}) => ({
  id,
  subject,
  predicate,
  value,
  confidence: 0.8,
  status: "unverified",
  episodeId: null,
  observedAt: new Date(),
  ...extra,
});

const claims = [
  claim(1, "hareb_digital", "branche", "Marketing"),
  // Umgekehrte Richtung: der gesuchte Knoten steht hier im WERT.
  claim(2, "issa", "gruendete", "Hareb Digital", { episodeId: 7 }),
  // Zweiter Schritt: haengt an issa, nicht am Einstieg.
  claim(3, "issa", "arbeitet_an", "StudyForge"),
  // Nachbar des Nachbarn — darf bei Tiefe 2 NICHT mehr auftauchen.
  claim(4, "studyforge", "nutzt", "React"),
  // Voellig unbeteiligt.
  claim(5, "moltbook", "ist", "Plattform"),
];

const tiefe1 = laufeGraph(["hareb_digital"], claims, 1, 24);
const ids1 = tiefe1.kanten.map((k) => k.claim.id).sort();
pruefe(
  JSON.stringify(ids1) === JSON.stringify([1, 2]),
  `Schritt 1 muss genau die direkten Kanten liefern (beide Richtungen), war: ${JSON.stringify(ids1)}`,
);
pruefe(tiefe1.episodenIds.includes(7), "Die Episode der gefundenen Aussage muss mitkommen");

const tiefe2 = laufeGraph(["hareb_digital"], claims, 2, 24);
const ids2 = tiefe2.kanten.map((k) => k.claim.id).sort();
pruefe(
  JSON.stringify(ids2) === JSON.stringify([1, 2, 3]),
  `Schritt 2 muss ueber issa auch dessen Aussage holen, aber nicht weiter, war: ${JSON.stringify(ids2)}`,
);
pruefe(
  !ids2.includes(5),
  "Ein unbeteiligter Knoten darf nie mitkommen — genau das ist der Unterschied zum Alles-Durchsuchen",
);
pruefe(
  !ids2.includes(4),
  "Tiefe 2 heisst zwei Schritte: der Nachbar des Nachbarn bleibt draussen",
);
pruefe(
  tiefe2.kanten.filter((k) => k.claim.id === 2).length === 1,
  "Eine Aussage, deren beide Seiten passen, darf nur einmal gezaehlt werden",
);
pruefe(
  tiefe2.kanten.find((k) => k.claim.id === 3)?.schritt === 2,
  "Der Abstand zum Einstieg muss stimmen, sonst laesst sich Nahes nicht hoeher gewichten",
);

// Existing subject/value variants must form one neighbourhood, without rewriting history.
const taxi = laufeGraph(["taxibb"], [
  claim(200, "taxi_bb", "domain", "taxibbessen.de"),
  claim(201, "issa", "arbeitet_an", "Taxi BB Essen"),
  claim(202, "issahareb/Taxibbessen", "branch", "main"),
  claim(203, "taxibot", "nutzt", "React"),
], 1, 24);
pruefe(JSON.stringify(taxi.kanten.map(k => k.claim.id)) === "[200,201,202]", "Projektaliase treffen beide Kantenrichtungen, TaxiBot bleibt getrennt");
pruefe(entitaetskandidaten("Was ist bei https://taxibbessen.de los?")[0] === "taxibb", "Domain steigt am kanonischen Projekt ein");

// ── 3. Deckel ──────────────────────────────────────────────────────────────
const viele = Array.from({ length: 100 }, (_, i) => claim(100 + i, "hareb_digital", "hat", "Ding" + i));
const gedeckelt = laufeGraph(["hareb_digital"], viele, 2, 10);
pruefe(gedeckelt.kanten.length === 10, "Der Deckel muss halten — sonst kippt der Kontext wieder um");

// ── 4. Normalisierung passt zu memory-writer ───────────────────────────────
pruefe(normEntitaet("  Hareb   Digital ") === "hareb_digital", "Normalisierung muss zu upsertClaim passen");

rmSync(dir, { recursive: true, force: true });

if (fehler > 0) {
  console.error(`\n${fehler} Fehler im Graph-Gedächtnis.`);
  process.exit(1);
}
console.log(
  `OK — Graph-Gedächtnis: Einstieg trifft "hareb_digital", Lauf folgt beiden Richtungen, Fremdes bleibt draußen.`,
);
