/*
 * Sagt Lukas die Wahrheit ueber seine eigenen Grenzen?
 *
 * Anlass war ein echter Fund: in der Beschreibung von execute_on_host stand
 * "Jeder einzelne Befehl braucht Issas Freigabe" — waehrend policy.ts daneben
 * R1 sagte, also gar keine. Dieselbe Behauptung stand in einem Kommentar und
 * in der Architekturdoku. Drei Texte, eine Wirklichkeit, und die stimmte mit
 * keinem davon ueberein.
 *
 * Das ist gefaehrlicher als eine veraltete Doku: eine veraltete Doku liest ein
 * Mensch. Eine veraltete Tool-Beschreibung liest das MODELL — und rechnet dann
 * mit einem Netz, das nicht gespannt ist.
 *
 * Deshalb zwei Invarianten, beide maschinell:
 *
 *  1. Keine Tool-Beschreibung darf von Hand eine Freigabe versprechen. Der Satz
 *     wird aus der Einstufung erzeugt (policyHinweis) und kann damit nicht mehr
 *     veralten.
 *  2. Was erzeugt wird, muss zur Einstufung passen — auch wenn ein Schalter
 *     die Stufe zur Laufzeit aendert (LUKAS_HOST_APPROVAL).
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".policy-check-"));
const out = join(dir, "policy.mjs");
const attrappe = join(dir, "attrappe.mjs");

writeFileSync(
  attrappe,
  `export const approvals = {};
export const db = { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }) };
export const and = () => ({});
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
export const gt = () => ({});
export const desc = () => ({});
export const sql = () => ({});
export const logger = { info() {}, warn() {}, error() {}, debug() {} };
// Der Container-Weg ist die Standard-Ausfuehrungsumgebung; ueber die Attrappe
// laesst sich beides durchspielen.
globalThis.__isoliert = true;
export const isIsolatedBackend = () => globalThis.__isoliert;
export const isLinkFromEmail = () => false;
`,
);

await build({
  entryPoints: ["src/lib/policy.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
  plugins: [
    {
      name: "attrappen",
      setup(b) {
        b.onResolve({ filter: /(^|\/)(logger|code-sandbox|email)$/ }, () => ({ path: attrappe }));
      },
    },
  ],
  logLevel: "silent",
});

const { riskFor, needsApproval, policyHinweis } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

// ── Die Beschreibungen aus dem Quelltext ──────────────────────────────────
const quelle = readFileSync(join(process.cwd(), "src/lib/lukas-tools.ts"), "utf-8");
const werkzeuge = [];
for (const m of quelle.matchAll(/name:\s*"([a-z0-9_]+)",\s*\n\s*description:\s*\n?\s*("(?:[^"\\]|\\.)*")/g)) {
  werkzeuge.push({ name: m[1], beschreibung: JSON.parse(m[2]) });
}
pruefe(`die Werkzeuge werden gefunden (gefunden: ${werkzeuge.length})`, werkzeuge.length >= 25);

// ── 1. Keine handgeschriebene Zusage ──────────────────────────────────────
const zusage = /freigabe|freigeben|genehmig|erlaubnis|zustimmung|braucht issas ok/i;
for (const w of werkzeuge) {
  pruefe(
    `"${w.name}" verspricht keine Freigabe von Hand (das erzeugt policyHinweis)`,
    !zusage.test(w.beschreibung),
  );
}

// ── 2. Der erzeugte Satz passt zur Stufe ──────────────────────────────────
for (const w of werkzeuge) {
  const stufe = riskFor(w.name);
  const hinweis = policyHinweis(w.name);
  if (needsApproval(stufe)) {
    pruefe(`"${w.name}" ist ${stufe} — Lukas erfährt von der Freigabe`, zusage.test(hinweis));
  } else {
    pruefe(`"${w.name}" ist ${stufe} — es wird ihm keine Freigabe versprochen`, hinweis === "");
  }
}

// ── 3. Der Schalter wirkt in beide Richtungen ─────────────────────────────
/*
 * OHNE Konfiguration ist der Host R1 — Issas Entscheidung: der Droplet ist
 * leer, gehoert ihm, und Lukas hat dort ohnehin root. Diese Zeile stand fuer
 * die Dauer eines Commits andersherum, weil eine externe Bewertung es so
 * empfahl. Das war falsch und ist zurueckgedreht; sie steht hier als
 * Festhalter, damit es nicht noch einmal still passiert.
 */
delete process.env.LUKAS_HOST_APPROVAL;
pruefe("ohne Schalter ist der Host R1 — Issas Entscheidung", riskFor("execute_on_host") === "R1");
pruefe("und Lukas wird keine Freigabe versprochen", policyHinweis("execute_on_host") === "");

process.env.LUKAS_HOST_APPROVAL = "true";
pruefe("mit Schalter ist der Host R3", riskFor("execute_on_host") === "R3");
pruefe("und Lukas erfährt es im selben Moment", zusage.test(policyHinweis("execute_on_host")));
delete process.env.LUKAS_HOST_APPROVAL;

// ── 4. Isolation aus heisst Host — auch fuer execute_command ──────────────
globalThis.__isoliert = true;
pruefe("im Container ist execute_command R1", riskFor("execute_command") === "R1");
globalThis.__isoliert = false;
/*
 * Mit dem Schalter AN geprueft, und das ist kein Detail: steht er aus, sind
 * Host und Container beide R1 — dann sieht ein Vergleich der beiden richtig
 * aus, auch wenn die Abzweigung gar nicht mehr greift. Genau das ist mir bei
 * der Gegenprobe passiert.
 */
process.env.LUKAS_HOST_APPROVAL = "true";
pruefe(
  "ohne Container ist execute_command dasselbe wie ein Host-Befehl",
  riskFor("execute_command") === "R3",
);
delete process.env.LUKAS_HOST_APPROVAL;
pruefe(
  "und folgt dem Schalter auch nach unten",
  riskFor("execute_command") === riskFor("execute_on_host"),
);
globalThis.__isoliert = true;

// ── 5. Unbekanntes bleibt fail closed ─────────────────────────────────────
pruefe("ein unbekanntes Werkzeug ist R2", riskFor("irgendwas_neues") === "R2");
pruefe("und wird als freigabepflichtig angesagt", zusage.test(policyHinweis("irgendwas_neues")));

// ── 6. Kein zweiter Wahrheitsanspruch in der Doku ─────────────────────────
// Die Architekturdoku darf die Stufe nennen, aber nicht behaupten, jeder
// einzelne Host-Befehl brauche eine Freigabe, solange die Policy das nicht
// hergibt.
const doku = readFileSync(join(process.cwd(), "..", "..", "docs", "architektur-entscheidungen.md"), "utf-8");
const hostZusage = /`execute_on_host`[^\n]*\n?[^\n]*Jeder einzelne Befehl braucht Issas Freigabe/;
pruefe(
  "die Architekturdoku behauptet keine Freigabepflicht, die es nicht gibt",
  needsApproval(riskFor("execute_on_host")) || !hostZusage.test(doku),
);

if (fehler > 0) process.exit(1);
console.log(
  `OK — Policy-Wahrheit: ${werkzeuge.length} Werkzeuge, keine handgeschriebene Zusage, jeder Hinweis stimmt mit seiner Stufe überein.`,
);
