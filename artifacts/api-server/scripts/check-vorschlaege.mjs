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
export const inArray = () => ({});
export const logger = { info() {}, warn() {}, error() {} };
export function selfBranch() { return "main"; }
export async function resolveGithubOwner() { return { owner: "fpissaip-source", repo: "Lukas_autonom" }; }
globalThis.__kopf ??= "commit-kopf";     // Kopf-Commit des Zielbranches
globalThis.__baeume ??= [];              // erzeugte Baeume (je EIN Aufruf = alle Dateien)
globalThis.__commits ??= [];             // erzeugte Commits mit ihren Eltern
globalThis.__branches ??= [];            // angelegte Referenzen — erst DAS ist sichtbar
globalThis.__prs ??= [];
globalThis.__fehlerBei ??= null;         // Pfadfragment, bei dem die API scheitern soll

export async function githubRequest(pfad, opts) {
  if (globalThis.__fehlerBei && pfad.includes(globalThis.__fehlerBei)) {
    throw new Error("GitHub sagt nein (nachgestellt)");
  }

  // ── Git-Data-API: der Weg, den das Annehmen jetzt geht ──────────────────
  if (pfad.includes("/git/ref/heads/")) {
    return { object: { sha: globalThis.__kopf } };
  }
  if (pfad.includes("/git/commits/") && !opts) {
    return { tree: { sha: "baum-von-" + pfad.split("/git/commits/")[1] } };
  }
  if (pfad.endsWith("/git/trees") && opts?.method === "POST") {
    globalThis.__baeume.push(opts.body);
    return { sha: "baum-neu-" + globalThis.__baeume.length };
  }
  if (pfad.endsWith("/git/commits") && opts?.method === "POST") {
    globalThis.__commits.push(opts.body);
    return { sha: "commit-neu-" + globalThis.__commits.length, html_url: "https://example.test/c" };
  }
  if (pfad.endsWith("/git/refs") && opts?.method === "POST") {
    globalThis.__branches.push(opts.body.ref);
    // Erst mit der Referenz ist die Aenderung ueberhaupt sichtbar. Genau das
    // zaehlt dieser Test als "geschrieben".
    for (const e of globalThis.__baeume[globalThis.__baeume.length - 1].tree) {
      globalThis.__geschrieben.push(e.path);
    }
    return { ref: opts.body.ref };
  }
  if (pfad.endsWith("/pulls") && opts?.method === "POST") {
    globalThis.__prs.push(opts.body);
    return { html_url: "https://example.test/pr/1" };
  }

  // ── Contents-API: nur noch zum Lesen der Blob-SHA ───────────────────────
  const datei = decodeURIComponent(pfad.split("/contents/")[1]?.split("?")[0] ?? "");
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
pruefe("als GENAU EIN Commit", globalThis.__commits.length === 1);
pruefe("auf einem eigenen Branch", globalThis.__branches[0] === "refs/heads/lukas/vorschlag-1");
pruefe("mit einem Pull Request", globalThis.__prs.length === 1);

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


// ── Fall 5: Der Elternteil ist der BASISCOMMIT, nicht der aktuelle Kopf. ──
//
// Das war das offene Fenster: geprueft wurde gegen die Basis, geschrieben
// gegen den aktuellen Stand. Wer dazwischen etwas aenderte, war ueberschrieben.
// Jetzt haengt der Commit an genau dem Stand, den Lukas vor sich hatte — laeuft
// der Zielbranch weiter, meldet der Pull Request den Konflikt statt ihn zu
// ueberfahren.
globalThis.__repo = { "c.ts": "sha-c" };
globalThis.__geschrieben = []; globalThis.__commits = []; globalThis.__branches = [];
globalThis.__prs = []; globalThis.__baeume = [];
globalThis.__kopf = "commit-zum-zeitpunkt-des-vorschlags";
const gebunden = await createProposal({
  repo: "Lukas_autonom", title: "Gebunden", summary: "…", reasoning: "…",
  files: [{ path: "c.ts", content: "// c" }],
});
globalThis.__zeile = { ...gebunden, status: "pending" };
pruefe(
  "der Basiscommit wird beim Anlegen festgehalten",
  globalThis.__zeile.baseCommit === "commit-zum-zeitpunkt-des-vorschlags",
);

// Der Zielbranch laeuft weiter, die Datei selbst bleibt unberuehrt.
globalThis.__kopf = "commit-inzwischen-weitergelaufen";
await decideProposal(1, "accept");
pruefe(
  "der Commit haengt am Basiscommit, nicht am inzwischen weitergelaufenen Kopf",
  globalThis.__commits[0]?.parents?.[0] === "commit-zum-zeitpunkt-des-vorschlags",
);

// ── Fall 6: Scheitert die API mittendrin, wird NICHTS sichtbar. ──────────
//
// Vorher schrieb jede Datei ihren eigenen Commit: scheiterte die zweite, war
// die erste schon drin, und das Repository stand in einem Zustand, den niemand
// beschlossen hatte. Jetzt haengen Baum und Commit an keinem Branch, solange
// die Referenz nicht steht — bricht es davor ab, ist nichts passiert.
globalThis.__repo = { "d.ts": "sha-d", "e.ts": "sha-e" };
globalThis.__geschrieben = []; globalThis.__commits = []; globalThis.__branches = [];
globalThis.__prs = []; globalThis.__baeume = [];
globalThis.__kopf = "commit-kopf";
const zweiDateien = await createProposal({
  repo: "Lukas_autonom", title: "Zwei", summary: "…", reasoning: "…",
  files: [{ path: "d.ts", content: "// d" }, { path: "e.ts", content: "// e" }],
});
globalThis.__zeile = { ...zweiDateien, status: "pending" };

globalThis.__fehlerBei = "/git/refs";   // genau der Schritt, der sichtbar macht
const abgebrochen = await decideProposal(1, "accept");
globalThis.__fehlerBei = null;

pruefe("bricht das Anlegen ab, ist KEINE Datei sichtbar", globalThis.__geschrieben.length === 0);
pruefe("und kein Branch entstanden", globalThis.__branches.length === 0);
pruefe("der Vorschlag gilt nicht als übernommen", abgebrochen.status !== "accepted");

// ── Fall 7: Alle Dateien liegen in EINEM Baum, nicht in mehreren. ────────
globalThis.__repo = { "f.ts": "sha-f", "g.ts": "sha-g", "h.ts": "sha-h" };
globalThis.__geschrieben = []; globalThis.__commits = []; globalThis.__branches = [];
globalThis.__prs = []; globalThis.__baeume = [];
const drei = await createProposal({
  repo: "Lukas_autonom", title: "Drei", summary: "…", reasoning: "…",
  files: [
    { path: "f.ts", content: "// f" },
    { path: "g.ts", content: "// g" },
    { path: "h.ts", content: "// h" },
  ],
});
globalThis.__zeile = { ...drei, status: "pending" };
await decideProposal(1, "accept");
pruefe("drei Dateien ergeben EINEN Baum", globalThis.__baeume.length === 1);
pruefe("mit allen drei Dateien darin", globalThis.__baeume[0]?.tree?.length === 3);
pruefe("und EINEN Commit", globalThis.__commits.length === 1);

if (fehler > 0) process.exit(1);
console.log("OK — Vorschläge: veraltete werden zurückgeschickt, aktuelle übernommen, nie ein halber Stand.");
