/*
 * Prueft, was auf der Startseite als "wartet auf dich" landet.
 *
 * Die eine Regel, auf die es ankommt: eine ABGELAUFENE Freigabe darf dort
 * nicht auftauchen. "pending" heisst nur, dass niemand entschieden hat —
 * nicht, dass man noch entscheiden KANN. Wer sie trotzdem anbietet, laesst
 * Issa auf "Erlauben" druecken, zeigt keinen Fehler, und der haelt fuer
 * erledigt, was weiter offen ist. Lukas wartet derweil auf etwas, das nie
 * kommt.
 *
 * Dazu zwei Dinge, die im Betrieb den Unterschied machen:
 *
 *  - Die Zahl "gesamt" zaehlt die WIRKLICH offenen, nicht die rohen Zeilen.
 *    Sonst steht auf der Startseite "9 Freigaben", von denen acht abgelaufen
 *    sind — und man sucht die restlichen acht, bis man aufgibt.
 *  - Dringendes zuerst, danach das Aelteste. Was am laengsten liegt,
 *    blockiert Lukas am laengsten.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".wartet-check-"));
const out = join(dir, "w.mjs");
const attrappe = join(dir, "attrappe.mjs");

writeFileSync(
  attrappe,
  `const t = (n) => new Proxy({ __name: n }, { get: (o, k) => (k === "__name" ? n : String(k)) });
export const approvals = t("approvals");
export const meldungen = t("meldungen");
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
export const and = (...b) => (z) => b.filter(Boolean).every((fn) => fn(z));
export const desc = (f) => ({ feld: String(f), richtung: -1 });
export const asc = (f) => ({ feld: String(f), richtung: 1 });
export const logger = { info(){}, warn(){}, error(){}, debug(){} };

globalThis.__freigaben = [];
globalThis.__meldungen = [];

const vergleiche = (ordnung) => (a, b) => {
  for (const o of ordnung) {
    const x = a[o.feld], y = b[o.feld];
    const wert = (v) => (v instanceof Date ? v.getTime() : v === true ? 1 : v === false ? 0 : v);
    const d = wert(x) < wert(y) ? -1 : wert(x) > wert(y) ? 1 : 0;
    if (d !== 0) return d * o.richtung;
  }
  return 0;
};

export const db = {
  select: () => ({ from: (tab) => {
    const alle = () => (tab.__name === "approvals" ? globalThis.__freigaben : globalThis.__meldungen);
    const bau = (bed, ordnung) => ({
      where: (b) => bau(b, ordnung),
      orderBy: (...o) => bau(bed, o),
      limit: async (n) => {
        let r = alle().filter((z) => (bed ? bed(z) : true));
        if (ordnung?.length) r = [...r].sort(vergleiche(ordnung));
        return r.slice(0, n);
      },
    });
    return bau(null, null);
  } }),
};`,
);

await build({
  entryPoints: ["src/lib/wartet.ts"],
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

const { wartendes } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) { console.error(`FEHLER: ${was}`); fehler++; }
};

const JETZT = Date.now();
const freigabe = (id, minutenBisAblauf, tool = "email_send") => ({
  id,
  tool,
  riskTier: "R3",
  argumentsPreview: `an: "kunde${id}@example.com"`,
  status: "pending",
  createdAt: new Date(JETZT - id * 1000),
  expiresAt: new Date(JETZT + minutenBisAblauf * 60_000),
});
const meldung = (id, dringend, alterMin, betreff = `Betreff ${id}`) => ({
  id,
  betreff,
  text: `Text ${id}`,
  dringend,
  status: "offen",
  createdAt: new Date(JETZT - alterMin * 60_000),
});

// ── 1. Abgelaufene Freigaben tauchen NICHT auf ────────────────────────────
globalThis.__meldungen = [];
globalThis.__freigaben = [
  freigabe(1, 30),        // gültig
  freigabe(2, -5),        // vor fünf Minuten abgelaufen
  freigabe(3, -1440),     // gestern
  freigabe(4, 60),        // gültig
];
{
  const w = await wartendes(JETZT);
  const ids = w.freigaben.map((f) => f.id).sort();
  pruefe("nur die gültigen kommen durch", ids.join() === "1,4");
  pruefe("die Gesamtzahl zählt auch nur die gültigen", w.gesamt.freigaben === 2);
  pruefe("die Argumente sind dabei", /kunde1@example\.com/.test(w.freigaben[0].argumentsPreview));
  pruefe("und die Stufe", w.freigaben[0].riskTier === "R3");
}

// ── 2. Genau am Ablaufzeitpunkt ist sie weg ───────────────────────────────
/*
 * Die Grenze selbst, weil hier ein > gegen ein >= steht. Eine Freigabe, die
 * genau jetzt ablaeuft, ist abgelaufen — sie danach noch anzubieten, waere
 * ein Rennen gegen die Uhr, das Issa verliert.
 */
globalThis.__freigaben = [{ ...freigabe(9, 0), expiresAt: new Date(JETZT) }];
{
  const w = await wartendes(JETZT);
  pruefe("genau abgelaufen zählt als abgelaufen", w.freigaben.length === 0);
}

// ── 3. Nur Offenes, nichts Entschiedenes ──────────────────────────────────
globalThis.__freigaben = [
  freigabe(1, 30),
  { ...freigabe(2, 30), status: "allowed" },
  { ...freigabe(3, 30), status: "denied" },
  { ...freigabe(4, 30), status: "used" },
];
{
  const w = await wartendes(JETZT);
  pruefe("Entschiedenes wartet nicht mehr", w.freigaben.map((f) => f.id).join() === "1");
}

// ── 4. Meldungen: Dringendes zuerst, dann das Älteste ─────────────────────
globalThis.__freigaben = [];
globalThis.__meldungen = [
  meldung(1, false, 10, "neu und normal"),
  meldung(2, false, 600, "alt und normal"),
  meldung(3, true, 5, "frisch und dringend"),
];
{
  const w = await wartendes(JETZT);
  pruefe("Dringendes steht oben", w.meldungen[0].betreff === "frisch und dringend");
  pruefe(
    "danach das Älteste — es blockiert Lukas am längsten",
    w.meldungen[1].betreff === "alt und normal",
  );
  pruefe("der Text kommt mit, nicht nur der Betreff", w.meldungen[0].text === "Text 3");
}

// ── 5. Gekürzt wird, aber ehrlich ─────────────────────────────────────────
globalThis.__freigaben = Array.from({ length: 9 }, (_, i) => freigabe(i + 1, 30));
{
  const w = await wartendes(JETZT);
  pruefe("gezeigt werden höchstens fünf", w.freigaben.length === 5);
  pruefe("die Gesamtzahl nennt alle neun", w.gesamt.freigaben === 9);
}

// ── 6. Nichts offen ist ein gültiges Ergebnis, kein Fehler ───────────────
globalThis.__freigaben = [];
globalThis.__meldungen = [];
{
  const w = await wartendes(JETZT);
  pruefe("leer geht durch", w.meldungen.length === 0 && w.freigaben.length === 0);
  pruefe("und die Zahlen stehen auf null", w.gesamt.meldungen === 0 && w.gesamt.freigaben === 0);
}

if (fehler > 0) process.exit(1);
console.log(
  "OK — Startseite: nur wirklich entscheidbare Freigaben, Dringendes zuerst, gekürzt aber ehrlich gezählt.",
);
