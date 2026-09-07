/*
 * Prueft, dass eine Aktion mit Aussenwirkung nicht zweimal laeuft.
 *
 * Der Ablauf, gegen den das steht: die Mail geht raus, danach bricht die
 * Verbindung weg, der Werkzeugaufruf sieht aus wie gescheitert, der Agent
 * versucht es erneut. Der Empfaenger ist ein Dritter, und zurueckholen laesst
 * sich nichts.
 *
 * Vier Eigenschaften, und die letzte ist die, an der so etwas meistens
 * scheitert:
 *
 *  1. Zweimal dasselbe fuehrt EINMAL aus.
 *  2. Etwas anderes laeuft trotzdem — sonst waere der Schutz eine Sperre.
 *  3. Reserviert wird VOR der Arbeit, nicht danach. Faellt der Prozess mitten
 *     im Versand, darf der naechste Versuch nicht noch einmal schicken.
 *  4. Ohne Datenbank wird AUSGEFUEHRT statt blockiert. Eine doppelte Mail ist
 *     aergerlich; eine Mail, die wegen einer Datenbankstoerung gar nicht
 *     rausgeht, obwohl Issa sie freigegeben hat, ist schlimmer.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".versand-check-"));
const out = join(dir, "sperre.mjs");
const attrappe = join(dir, "db.mjs");

/*
 * Die Attrappe bildet den EINDEUTIGEN INDEX nach — darauf beruht der ganze
 * Mechanismus. Ohne ihn waere das hier ein Lesen-dann-Schreiben, und zwei
 * gleichzeitige Zuege wuerden beide durchkommen.
 */
writeFileSync(
  attrappe,
  `globalThis.__zeilen = [];
globalThis.__dbKaputt = false;
const t = (n) => new Proxy({ __name: n }, { get: (o, k) => (k === "__name" ? n : String(k)) });
export const versandTable = t("versand");
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
export const gte = (f, w) => (z) => new Date(z[f]).getTime() >= new Date(w).getTime();
export const and = (...b) => (z) => b.filter(Boolean).every((fn) => fn(z));
export const db = {
  select: () => ({ from: () => ({ where: (b) => ({ limit: async () => {
    if (globalThis.__dbKaputt) throw new Error("DB weg");
    return globalThis.__zeilen.filter(b);
  } }) }) }),
  insert: () => ({ values: async (v) => {
    if (globalThis.__zeilen.some((z) => z.art === v.art && z.fingerabdruck === v.fingerabdruck)) {
      throw new Error("duplicate key value violates unique constraint");
    }
    globalThis.__zeilen.push({ ...v, createdAt: new Date() });
  } }),
  update: () => ({ set: (w) => ({ where: (b) => {
    for (const z of globalThis.__zeilen.filter(b)) Object.assign(z, w);
    return Promise.resolve([]);
  } }) }),
};
export const logger = { info(){}, warn(){}, error(){}, debug(){} };`,
);

await build({
  entryPoints: ["src/lib/versandsperre.ts"],
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

const { nurEinmal, fingerabdruck } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

const schluessel = (...t) => fingerabdruck(...t);

// ── 1. Zweimal dasselbe → einmal ausgeführt ──────────────────────────────
globalThis.__zeilen = [];
{
  let gelaufen = 0;
  const mail = schluessel("kunde@example.com", "Angebot", "Anbei.");
  const eins = await nurEinmal("email", mail, async () => {
    gelaufen++;
    return "akzeptiert";
  });
  const zwei = await nurEinmal("email", mail, async () => {
    gelaufen++;
    return "akzeptiert";
  });

  pruefe("die erste Mail geht raus", eins.wiederholung === false && eins.ergebnis === "akzeptiert");
  pruefe("die zweite wird als Wiederholung erkannt", zwei.wiederholung === true);
  pruefe("und der Versand lief nur EINMAL", gelaufen === 1);
  pruefe(
    "das Ergebnis von damals kommt zurück, nicht ein leeres 'ok'",
    zwei.ergebnis === "akzeptiert",
  );
}

// ── 2. Etwas anderes läuft weiterhin ─────────────────────────────────────
{
  let gelaufen = 0;
  const andere = await nurEinmal("email", schluessel("kunde@example.com", "Angebot", "Anderer Text."), async () => {
    gelaufen++;
    return "akzeptiert";
  });
  pruefe("eine andere Mail geht trotzdem raus", andere.wiederholung === false && gelaufen === 1);
}

// Und dieselbe Zeichenfolge unter anderer ART ist etwas anderes.
{
  let gelaufen = 0;
  const gleich = schluessel("a", "b", "c");
  await nurEinmal("email", gleich, async () => { gelaufen++; return "x"; });
  await nurEinmal("mcp", gleich, async () => { gelaufen++; return "x"; });
  pruefe("derselbe Fingerabdruck unter anderer Art läuft eigenständig", gelaufen === 2);
}

// ── 3. Reserviert wird VOR der Arbeit ────────────────────────────────────
/*
 * Der Fall: der Prozess fällt mitten im Versand. Die Reservierung muss dann
 * schon stehen — sonst schickt der nächste Versuch ein zweites Mal. Lieber
 * eine Mail, die vielleicht nicht ankam, als zwei, die ankamen.
 */
globalThis.__zeilen = [];
{
  const abbruch = schluessel("abbruch@example.com", "X", "Y");
  let geworfen = false;
  try {
    await nurEinmal("email", abbruch, async () => {
      throw new Error("Netz weg, mitten im Versand");
    });
  } catch {
    geworfen = true;
  }
  pruefe("ein Absturz im Versand wird durchgereicht", geworfen);
  pruefe("aber die Reservierung steht bereits", globalThis.__zeilen.length === 1);

  let nochmal = 0;
  const danach = await nurEinmal("email", abbruch, async () => {
    nochmal++;
    return "doch noch";
  });
  pruefe("und der nächste Versuch schickt NICHT ein zweites Mal", nochmal === 0);
  pruefe("er meldet es als Wiederholung", danach.wiederholung === true);
}

// ── 4. Ohne Datenbank wird ausgeführt, nicht blockiert ───────────────────
globalThis.__zeilen = [];
globalThis.__dbKaputt = true;
{
  let gelaufen = 0;
  const trotzdem = await nurEinmal("email", schluessel("x", "y", "z"), async () => {
    gelaufen++;
    return "akzeptiert";
  });
  pruefe("bei kaputter Datenbank geht die Mail trotzdem raus", gelaufen === 1);
  pruefe("und sie gilt nicht als Wiederholung", trotzdem.wiederholung === false);
}
globalThis.__dbKaputt = false;

if (fehler > 0) process.exit(1);
console.log(
  "OK — Versandsperre: einmal ausgeführt, Anderes läuft weiter, reserviert vor der Arbeit, ohne DB nicht blockiert.",
);
