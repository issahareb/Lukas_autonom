/*
 * Prueft, dass ein angenommener Vorschlag nichts stillschweigend
 * ueberschreibt.
 *
 * Der reale Fall: Lukas' Vorschlag #3 wurde gegen einen aelteren Stand
 * geschrieben. Zwischen Vorschlag und Annahme kam eine Zeile in dieselbe Datei.
 * Ein Vorschlag enthaelt den VOLLSTAENDIGEN neuen Dateiinhalt — beim Annehmen
 * war die Zeile weg. Niemand hat es bemerkt, und "Issa hat zugestimmt" war
 * faktisch "Issa hat zugestimmt, dass die Arbeit der letzten Stunde geloescht
 * wird".
 *
 * Beide Richtungen zaehlen: ein veralteter Vorschlag darf NICHT durchgehen,
 * und ein aktueller MUSS durchgehen. Eine Sperre, die auch Gueltiges blockiert,
 * waere genauso kaputt.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".vorschlag-check-"));
const out = join(dir, "proposals.mjs");

const attrappe = join(dir, "attrappe.mjs");
writeFileSync(
  attrappe,
  `globalThis.__repo ??= {};        // Pfad -> aktuelle SHA
globalThis.__geschrieben ??= [];   // was tatsaechlich committet wurde
globalThis.__zeile ??= null;       // letzter DB-Stand

export const codeProposals = { id: "id", createdAt: "createdAt" };
export const db = {
  insert: () => ({ values: (v) => ({ returning: async () => [{ id: 1, ...v }] }) }),
  select: () => ({ from: () => ({ where: async () => [globalThis.__zeile], orderBy: () => ({ limit: async () => [] }) }) }),
  update: () => ({ set: (v) => ({ where: () => ({ returning: async () => {
    globalThis.__zeile = { ...globalThis.__zeile, ...v };
    return [globalThis.__zeile];
  } }) }) }),
};
export const desc = () => ({});
export const eq = () => ({});
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
export const inArray = () => ({});
export const logger = { info() {}, warn() {}, error() {} };
export function selfBranch() { return "main"; }
export async function resolveGithubOwner() { return { owner: "fpissaip-source", repo: "Lukas_autonom" }; }
export async function githubRequest(pfad, opts) {
  const datei = decodeURIComponent(pfad.split("/contents/")[1]?.split("?")[0] ?? "");
  if (opts?.method === "PUT") {
    globalThis.__geschrieben.push(datei);
    globalThis.__repo[datei] = "sha-neu-" + globalThis.__geschrieben.length;
    return { commit: { html_url: "https://example.test/commit" } };
  }
  const sha = globalThis.__repo[datei];
  if (!sha) throw new Error("404");
  return { sha };
}
`,
);

await build({
  entryPoints: ["src/lib/proposals.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
  plugins: [
    {
      name: "attrappen",
      setup(b) {
        b.onResolve({ filter: /(^|\/)(logger|github)$/ }, () => ({ path: attrappe }));
      },
    },
  ],
  logLevel: "silent",
});

const { createProposal, decideProposal } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

const neuerVorschlag = async () => {
  const row = await createProposal({
    repo: "Lukas_autonom",
    title: "Sandbox nutzbar machen",
    summary: "…",
    reasoning: "…",
    files: [{ path: "src/lib/lukas-brain.ts", content: "// Lukas' Fassung, ohne die neue Zeile" }],
  });
  globalThis.__zeile = { ...row, status: "pending" };
  return row;
};

// ── Fall 1: DER echte Fall. Datei aendert sich zwischen Vorschlag und Annahme.
globalThis.__repo = { "src/lib/lukas-brain.ts": "sha-alt" };
globalThis.__geschrieben = [];
await neuerVorschlag();

pruefe("die Basis-SHA wird beim Anlegen festgehalten", globalThis.__zeile.files[0].baseSha === "sha-alt");

globalThis.__repo["src/lib/lukas-brain.ts"] = "sha-inzwischen-geaendert";
const veraltet = await decideProposal(1, "accept");

pruefe("ein veralteter Vorschlag wird NICHT geschrieben", globalThis.__geschrieben.length === 0);
pruefe("er wird nicht als übernommen markiert", veraltet.status !== "accepted");
pruefe("sondern geht zurück an Lukas", veraltet.status === "revision");
pruefe("mit einer nachvollziehbaren Begründung", veraltet.comment?.includes("geändert"));
pruefe("die die Datei benennt", veraltet.comment?.includes("lukas-brain.ts"));

// ── Fall 2: Nichts hat sich geaendert — dann MUSS es durchgehen.
globalThis.__repo = { "src/lib/lukas-brain.ts": "sha-alt" };
globalThis.__geschrieben = [];
await neuerVorschlag();
const aktuell = await decideProposal(1, "accept");

pruefe("ein aktueller Vorschlag wird übernommen", aktuell.status === "accepted");
pruefe("und wirklich geschrieben", globalThis.__geschrieben.includes("src/lib/lukas-brain.ts"));

// ── Fall 3: Neue Datei, die es inzwischen schon gibt.
globalThis.__repo = {};
globalThis.__geschrieben = [];
const neu = await createProposal({
  repo: "Lukas_autonom",
  title: "Neue Datei",
  summary: "…",
  reasoning: "…",
  files: [{ path: "src/lib/neu.ts", content: "// neu" }],
});
globalThis.__zeile = { ...neu, status: "pending" };
pruefe("bei einer neuen Datei ist die Basis-SHA null", globalThis.__zeile.files[0].baseSha === null);

globalThis.__repo["src/lib/neu.ts"] = "jemand-war-schneller";
const kollision = await decideProposal(1, "accept");
pruefe("eine inzwischen angelegte Datei wird nicht überschrieben", globalThis.__geschrieben.length === 0);
pruefe("und der Grund steht dabei", kollision.comment?.includes("noch nicht"));

// ── Fall 4: Teilweise veraltet -> GAR NICHTS wird geschrieben.
globalThis.__repo = { "a.ts": "sha-a", "b.ts": "sha-b" };
globalThis.__geschrieben = [];
const zwei = await createProposal({
  repo: "Lukas_autonom",
  title: "Zwei Dateien",
  summary: "…",
  reasoning: "…",
  files: [
    { path: "a.ts", content: "// a" },
    { path: "b.ts", content: "// b" },
  ],
});
globalThis.__zeile = { ...zwei, status: "pending" };
globalThis.__repo["b.ts"] = "sha-b-geaendert";
await decideProposal(1, "accept");
pruefe(
  "ist EINE Datei veraltet, wird KEINE geschrieben (kein halber Stand)",
  globalThis.__geschrieben.length === 0,
);

if (fehler > 0) process.exit(1);
console.log("OK — Vorschläge: veraltete werden zurückgeschickt, aktuelle übernommen, nie ein halber Stand.");
