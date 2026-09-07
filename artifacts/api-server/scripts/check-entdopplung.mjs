/*
 * Prueft, dass dieselbe Erinnerung nicht zweimal im Prompt steht.
 *
 * Der System-Prompt traegt die zehn wichtigsten und die zehn neuesten
 * Erinnerungen. Die Suche daneben lieferte dieselben Zeilen ein zweites Mal —
 * in einem anderen Format, weshalb es beim Lesen nie auffiel.
 *
 * Doppelt ist dabei nicht nur teuer. Eine zweimal genannte Erinnerung wirkt
 * auf ein Modell WICHTIGER als eine einmal genannte; die Wiederholung hat
 * also auch das Gewicht verschoben. Genau deshalb reicht es nicht, das als
 * Kostenfrage zu behandeln.
 *
 * Und die zweite Haelfte, ohne die der Schutz eine Verschlechterung waere:
 * die frei gewordenen Plaetze werden NACHGEFUELLT. Wer nur streicht, laesst
 * von acht Treffern vielleicht fuenf uebrig — dann bestraft sich die Suche
 * fuer jede Erinnerung, die ohnehin schon wichtig genug war.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".entdopp-check-"));
const out = join(dir, "m.mjs");
const attrappe = join(dir, "a.mjs");

/*
 * searchMemory wird ersetzt, nicht nachgebaut: geprueft wird hier die
 * Entdopplung, nicht die Suche. Die hat ihren eigenen Test.
 */
writeFileSync(
  attrappe,
  `export const db = new Proxy({}, { get: () => () => ({}) });
export default new Proxy({}, { get: () => () => ({}) });
export const logger = { info(){},warn(){},error(){},debug(){} };
export const memoriesTable = {}; export const claimsTable = {}; export const episodesTable = {};
export const conversations = {}; export const messages = {}; export const memActionsTable = {};
export const knownAgentsTable = {}; export const strategiesTable = {}; export const goalsTable = {};
export const diaryTable = {};
export const eq = () => ({}); export const ne = () => ({}); export const and = () => ({});
export const isNotNull = (f) => (z) => z[f] !== null && z[f] !== undefined;
export const not = (b) => (z) => !b(z);
export const lt = (f, w) => (z) => z[f] < w;
export const notInArray = (f, w) => (z) => !(w ?? []).includes(z[f]);
export const like = () => () => true;
export const or = () => ({}); export const desc = () => ({}); export const asc = () => ({});
export const gte = () => ({}); export const lte = () => ({}); export const sql = () => ({});
export const inArray = () => ({}); export const ilike = () => ({}); export const isNull = () => ({});
export const graphTreffer = async () => ({ einstieg: [], treffer: [] });
export const knotenFuer = async () => [];
export const erinnerungenZuKnoten = async () => [];
export const episodenZuIds = async () => [];
`,
);

await build({
  entryPoints: ["src/lib/memory-retrieval.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
  plugins: [
    {
      name: "a",
      setup(b) {
        b.onResolve({ filter: /(^|\/)(logger|memory-graph|gehirn)$/ }, () => ({ path: attrappe }));
      },
    },
  ],
  logLevel: "silent",
}).catch((e) => {
  console.error("Bundle fehlgeschlagen:", String(e.message).slice(0, 300));
  process.exit(1);
});

const mod = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) { console.error(`FEHLER: ${was}`); fehler++; }
};

/*
 * Die Suche wird von aussen ersetzt. Das geht, weil memoryContextOhne sie
 * ueber das Modul aufruft — und genau diese Verdrahtung ist das, was geprueft
 * werden soll.
 */
const alleTreffer = Array.from({ length: 20 }, (_, i) => ({
  kind: "memory",
  id: i + 1,
  text: `[Erinnerung|fakt] Erinnerung Nummer ${i + 1}`,
  score: 1 - i / 100,
}));

const { waehleOhneDoppel } = mod;

// ── 1. Was schon im Prompt steht, kommt nicht noch einmal ────────────────
{
  const schonDa = new Set([1, 2, 3]);
  // So viele wie memoryContextOhne holt: limit + Groesse der Ausschlussmenge.
  const geholt = alleTreffer.slice(0, 8 + schonDa.size);
  const uebrig = waehleOhneDoppel(geholt, 8, schonDa);

  pruefe("die doppelten fliegen raus", uebrig.every((h) => !schonDa.has(h.id)));
  pruefe("und es bleiben trotzdem acht", uebrig.length === 8);
  pruefe("nachgefüllt wird von hinten", uebrig[uebrig.length - 1].id === 11);
}

// ── 2. Ohne Überschneidung ändert sich nichts ───────────────────────────
{
  const uebrig = waehleOhneDoppel(alleTreffer.slice(0, 8), 8, new Set([99]));
  pruefe("ohne Doppel bleiben es dieselben acht", uebrig.length === 8 && uebrig[0].id === 1);
}

// ── 3. Nur Erinnerungen werden verglichen ───────────────────────────────
/*
 * IDs sind pro Tabelle vergeben. Eine Episode mit id 3 ist NICHT die
 * Erinnerung mit id 3 — wer nur die Zahl vergleicht, wirft Richtiges weg,
 * und zwar unbemerkt: es fehlt ja nur etwas, es steht nichts Falsches da.
 */
{
  const gemischt = [
    { kind: "memory", id: 3, text: "Erinnerung 3", score: 1 },
    { kind: "episode", id: 3, text: "Episode 3", score: 0.9 },
    { kind: "claim", id: 3, text: "Behauptung 3", score: 0.8 },
    { kind: "graph", id: 3, text: "Knoten 3", score: 0.7 },
  ];
  const uebrig = waehleOhneDoppel(gemischt, 8, new Set([3]));
  pruefe("die Erinnerung 3 fliegt raus", !uebrig.some((h) => h.kind === "memory"));
  pruefe("die Episode 3 bleibt", uebrig.some((h) => h.kind === "episode"));
  pruefe("die Behauptung 3 auch", uebrig.some((h) => h.kind === "claim"));
  pruefe("und der Graph-Knoten 3 ebenso", uebrig.some((h) => h.kind === "graph"));
  pruefe("es bleiben also drei von vier", uebrig.length === 3);
}

// ── 3b. Das Nachfüllen muss wirklich nachfüllen ─────────────────────────
/*
 * Die Gegenprobe dazu: wer nur so viel holt, wie er zeigen will, hat nach dem
 * Streichen zu wenig. Genau das war der erste Entwurf.
 */
{
  const knapp = waehleOhneDoppel(alleTreffer.slice(0, 8), 8, new Set([1, 2, 3]));
  pruefe(
    "aus knapp geholten acht bleiben nach dem Streichen nur fünf — deshalb wird breiter geholt",
    knapp.length === 5,
  );
}

// ── 3c. Breiter geholt wird wirklich ────────────────────────────────────
/*
 * Das laesst sich an der reinen Auswahl nicht pruefen — sie bekommt die
 * Treffer ja schon fertig. Also am Quelltext, und das steht hier ausdruecklich
 * so: es ist die schwaechere Sorte Pruefung, aber die Alternative waere, die
 * halbe Suche samt Einbettungen und Graph nachzubauen, nur um eine Zahl zu
 * bestaetigen. Ohne diese Zeile fiel die Gegenprobe "nicht breiter holen"
 * gruen durch.
 */
{
  const mrQuelle = await import("node:fs").then((fs) =>
    fs.readFileSync("src/lib/memory-retrieval.ts", "utf8"),
  );
  pruefe(
    "memoryContextOhne holt limit + Ausschlussmenge, nicht nur limit",
    /searchMemory\(query,\s*limit \+ ausser\.size\)/.test(mrQuelle),
  );
}

// ── 4. Die Funktion gibt es überhaupt und sie ist verdrahtet ─────────────
pruefe("memoryContextOhne wird exportiert", typeof mod.memoryContextOhne === "function");
pruefe("und die Auswahl ist für sich prüfbar", typeof waehleOhneDoppel === "function");
pruefe("memoryContextFor bleibt für andere Aufrufer", typeof mod.memoryContextFor === "function");

const quelle = await import("node:fs").then((fs) =>
  fs.readFileSync("src/lib/system-prompt.ts", "utf8"),
);
pruefe(
  "der System-Prompt benutzt die entdoppelnde Fassung",
  quelle.includes("memoryContextOhne"),
);
pruefe(
  "und übergibt die IDs, die schon drinstehen",
  /new Set\(memories\.map\(\(m\) => m\.id\)\)/.test(quelle),
);
pruefe(
  "die alte, doppelnde Fassung wird dort nicht mehr aufgerufen",
  !/memoryContextFor\(userQuery/.test(quelle),
);

if (fehler > 0) process.exit(1);
console.log(
  "OK — Entdopplung: nichts steht zweimal im Prompt, die Plätze werden nachgefüllt, IDs nur je Tabelle verglichen.",
);
