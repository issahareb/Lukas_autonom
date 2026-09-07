/*
 * Prueft, dass github_read_path mehrere Dateien in EINEM Aufruf liest.
 *
 * Anlass: Das Werkzeug las genau eine Datei pro Aufruf. Ein Repo zu verstehen
 * heisst aber, ein Dutzend Dateien anzusehen — und jede einzelne kostete eine
 * volle Runde durch das Modell, also den kompletten Prompt noch einmal.
 * Zwoelf Dateien waren damit zwoelf Prompts, nicht zwoelf Dateiabrufe.
 *
 * Drei Dinge muessen stimmen, und jedes davon faellt sonst still aus:
 *   1. Ein einzelner Pfad muss weiter funktionieren (alte Aufrufform).
 *   2. Mehrere Pfade teilen sich EIN Textbudget — sonst verschiebt das
 *      Buendeln die Kosten nur vom Prompt in das Ergebnis.
 *   3. Ein kaputter Pfad darf die anderen nicht mitreissen.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".ghbuendel-check-"));
const out = join(dir, "tools.mjs");
const attrappe = join(dir, "attrappe.mjs");

writeFileSync(
  attrappe,
  `
export const db = new Proxy({}, { get: () => () => ({}) });
export const memoriesTable = {}; export const goalsTable = {}; export const diaryTable = {};
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
export const logger = { warn() {}, info() {}, error() {} };

// Das Policy-Gate laesst hier alles durch; geprueft wird das Lesen, nicht die Freigabe.
export const checkPolicy = async () => ({ allow: true });
// policyHinweis haengt jedem Werkzeug an, was die Policy dazu sagt — hier ohne
// Belang, muss es aber geben, sonst laesst sich lukas-tools nicht buendeln.
export const policyHinweis = () => "";
// Der Netzschutz prueft Ziele gegen interne Adressen — hier ohne Belang, aber
// lukas-tools importiert ihn.
export const sicherFetch = (url, init) => fetch(url, init);
export const pruefeZiel = async (url) => new URL(url);
export const sendeSms = async () => ({ ok: true, status: "SUCCESS", nummer: "+49", segmente: 1 });
export const bedienePage = async () => ({ ok: true, url: "", titel: "", schritte: [], felder: [], text: "" });
export const merkeBild = () => {};
export const setMcpRiskTiers = () => {};

// Die eine Stelle, die der Test steuert: was GitHub antwortet.
export const githubRequest = async (pfad) => globalThis.__gh(pfad);
export const resolveGithubOwner = async (repo) => ({ owner: "issa", repo });
export const ownRepoRef = () => null;

export const MCP_TOOL_PREFIX = "mcp__";
export const activeServers = async () => [];
export const callMcpTool = async () => "";
export const ordneMcpWerkzeuge = (t) => t;
export const setLukasStatus = async () => {};
export const recordEmotion = async () => {};
export const queryRows = async () => [];
export const searchEmails = async () => []; export const readEmail = async () => "";
export const sendEmail = async () => "";
/* Die Versandsperre reicht hier durch: sie hat einen eigenen Test, und hier
   geht es um das GitHub-Buendel, nicht um Idempotenz. */
export const nurEinmal = async (art, schluessel, arbeit) => ({ wiederholung: false, ergebnis: await arbeit() });
/* Zugangsdaten gibt es in diesem Test nicht — browser_do wird hier nicht
   gefahren, und der Tresor hat seinen eigenen Test. */
export const zugangFuer = async () => ({});
export const fingerabdruck = (...teile) => teile.map(String).join("|");
export const executeCommand = async () => ""; export const resetSandbox = async () => "";
export const executeOnHost = async () => "";
export const renderPage = async () => "";
export const createProposal = async () => ({});
export const runSubagent = async () => ""; export const subagentUebersicht = async () => "";
export const createSubagent = async () => ""; export const fixError = async () => "";
export const meldeDichBeiIssa = async () => "";
export const starteAnruf = async () => "";
export const fehlerGruppen = async () => [];
export const verbrauchsUebersicht = () => [];
`,
);

await build({
  entryPoints: ["src/lib/lukas-tools.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  external: ["openai"],
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
  plugins: [
    {
      name: "attrappen",
      setup(b) {
        // Alles Lokale ausser der Einstiegsdatei durch die Attrappe ersetzen.
        b.onResolve({ filter: /^\.\// }, (args) =>
          args.importer.endsWith("lukas-tools.ts") ? { path: attrappe } : undefined,
        );
      },
    },
  ],
});

const { executeLukasTool } = await import(out);

let fehler = 0;
const pruefe = (bedingung, text) => {
  if (!bedingung) {
    console.error("FEHLER — " + text);
    fehler++;
  }
};

// GitHub-Attrappe: jede Datei liefert 40.000 Zeichen, damit das Budget greift.
const datei = (name) => ({ type: "file", encoding: "utf-8", content: `${name}:` + "x".repeat(40000) });
let abrufe = [];
globalThis.__gh = async (pfad) => {
  abrufe.push(pfad);
  if (pfad.includes("kaputt")) throw new Error("GitHub API 404: Not Found");
  return datei(pfad);
};

// ── 1. Einzelner Pfad, alte Aufrufform ─────────────────────────────────────
abrufe = [];
const einzeln = await executeLukasTool("github_read_path", { repo: "lukas", path: "src/a.ts" });
pruefe(abrufe.length === 1, `Ein Pfad = ein Abruf, waren: ${abrufe.length}`);
pruefe(einzeln.includes("[... gekürzt]"), "Eine grosse Datei muss weiterhin gekuerzt werden");
const einzelLaenge = einzeln.length;

// ── 2. Mehrere Pfade in einem Aufruf ───────────────────────────────────────
abrufe = [];
const viele = await executeLukasTool("github_read_path", {
  repo: "lukas",
  paths: ["src/a.ts", "src/b.ts", "src/c.ts"],
});
pruefe(abrufe.length === 3, `Drei Pfade = drei Abrufe in EINEM Werkzeugaufruf, waren: ${abrufe.length}`);
for (const p of ["src/a.ts", "src/b.ts", "src/c.ts"]) {
  pruefe(viele.includes(p), `Der Inhalt von ${p} muss im Ergebnis stehen`);
}
pruefe(
  viele.length < einzelLaenge * 2,
  `Drei Dateien duerfen nicht dreimal so viel Text liefern — sonst wandert die Last nur vom Prompt ins Ergebnis (${viele.length} vs. ${einzelLaenge})`,
);

// ── 3. Ein kaputter Pfad reisst die anderen nicht mit ──────────────────────
const gemischt = await executeLukasTool("github_read_path", {
  repo: "lukas",
  paths: ["src/a.ts", "src/kaputt.ts", "src/c.ts"],
});
pruefe(gemischt.includes("src/a.ts"), "Die heile Datei muss trotz Fehler geliefert werden");
pruefe(gemischt.includes("src/c.ts"), "Auch die Datei NACH dem Fehler muss geliefert werden");
pruefe(gemischt.includes("404"), "Der Fehler muss sichtbar bleiben statt still zu verschwinden");

// ── 4. Deckel gegen zu viele Pfade ─────────────────────────────────────────
abrufe = [];
await executeLukasTool("github_read_path", {
  repo: "lukas",
  paths: Array.from({ length: 20 }, (_, i) => `src/f${i}.ts`),
});
pruefe(abrufe.length <= 6, `Hoechstens 6 Pfade je Aufruf, waren: ${abrufe.length}`);

rmSync(dir, { recursive: true, force: true });

if (fehler > 0) {
  console.error(`\n${fehler} Fehler beim GitHub-Bündeln.`);
  process.exit(1);
}
console.log("OK — GitHub-Bündel: mehrere Dateien pro Aufruf, ein gemeinsames Budget, Fehler bleiben lokal.");
