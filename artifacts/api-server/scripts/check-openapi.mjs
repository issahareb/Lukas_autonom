/*
 * Prueft, dass die OpenAPI-Spezifikation und der Server sich nicht
 * widersprechen — und dass der Abstand zwischen beiden nicht waechst.
 *
 * ANLASS. Die Spec beschreibt einen Teil der Routen, der Server hat mehr.
 * Daran ist nichts falsch: nicht jede Route braucht einen typisierten
 * Client. Falsch war, dass NICHTS die Uebereinstimmung erzwungen hat — weder
 * ein Test noch CI. Eine Spec, die niemand prueft, driftet ab, und man merkt
 * es an der Stelle, an der ein erzeugter Client ins Leere greift.
 *
 * ZWEI RICHTUNGEN, DIE NICHT GLEICH GEFAEHRLICH SIND:
 *
 *  1. Die Spec verspricht etwas, das es nicht gibt. Das ist die schlimme
 *     Richtung: aus `openapi.yaml` wird der typisierte Client erzeugt, den
 *     die Dashboard-Seiten benutzen. Steht dort eine Route, die der Server
 *     nicht hat, compiliert die Oberflaeche fehlerfrei und faellt zur
 *     Laufzeit auf 404. Das ist hier ein harter Fehlschlag.
 *
 *  2. Der Server hat etwas, das die Spec nicht kennt. Das ist bloss
 *     undokumentiert — unschoen, aber es bricht nichts. Ein harter Fehler
 *     waere hier sinnlos: es sind aktuell Dutzende, der Check waere ab der
 *     ersten Minute rot und wuerde abgeschaltet statt beachtet.
 *
 * DESHALB EINE RATSCHE. Fuer Richtung 2 steht unten eine Zahl: so viele
 * undokumentierte Routen gibt es. Werden es MEHR, wird der Check rot — die
 * Luecke darf nicht mit jeder neuen Route weiter wachsen. Werden es weniger,
 * wird der Check ebenfalls rot und verlangt, die Zahl zu senken. Sonst
 * verrottet die Ratsche nach unten und bewacht irgendwann nichts mehr.
 *
 * KEINE ABHAENGIGKEITEN. Absichtlich kein YAML-Paket und kein esbuild: der
 * Check liest beide Seiten als Text. Eine Pruefung, die selbst erst ein
 * Build braucht, laeuft im Zweifel nicht.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Stand der undokumentierten Routen.
 *
 * Diese Zahl ist eine Schuld, kein Ziel. Wer eine Route in die Spec
 * aufnimmt, senkt sie. Wer eine neue Route ohne Spec hinzufuegt, muss sie
 * bewusst erhoehen — und genau dieser bewusste Schritt ist der Zweck.
 */
const UNDOKUMENTIERT_ERWARTET = 48;

const WURZEL = new URL("..", import.meta.url).pathname;
const ROUTEN_DIR = join(WURZEL, "src/routes");
const SPEC = join(WURZEL, "../../lib/api-spec/openapi.yaml");

const METHODEN = ["get", "post", "put", "patch", "delete"];

let fehler = 0;
const pruefe = (bedingung, text) => {
  if (!bedingung) {
    console.error("FEHLER — " + text);
    fehler++;
  }
};

/*
 * Ein Pfad, bei dem der Name des Parameters keine Rolle mehr spielt.
 *
 * Die Spec schreibt `/lukas/goals/{id}`, Express schreibt
 * `/lukas/goals/:id`. Das ist dieselbe Route. Waeren die Namen Teil des
 * Vergleichs, wuerde ein umbenannter Parameter als fehlende Route gemeldet —
 * ein Fehlalarm, der den Check unglaubwuerdig macht.
 */
function normalisiere(pfad) {
  return pfad.replace(/\{[^}]+\}/g, "{}").replace(/:[^/]+/g, "{}");
}

/*
 * Die Spec lesen.
 *
 * Nach Einrueckung statt mit einem YAML-Paket: Pfade stehen auf Ebene 2
 * (`  /lukas/goals:`), ihre Methoden auf Ebene 4 (`    get:`). Tiefer
 * eingerueckte `get:`-Zeilen — etwa in einem Schema — haben mehr als vier
 * Leerzeichen und werden dadurch nicht mitgelesen.
 */
function specOperationen() {
  const zeilen = readFileSync(SPEC, "utf8").split("\n");
  const operationen = new Set();
  let inPaths = false;
  let pfad = null;

  for (const zeile of zeilen) {
    if (/^paths:/.test(zeile)) {
      inPaths = true;
      continue;
    }
    if (!inPaths) continue;
    // Ein Schluessel ganz links beendet den paths-Block.
    if (/^[a-zA-Z]/.test(zeile)) break;

    const pfadTreffer = zeile.match(/^ {2}(\/\S*):\s*$/);
    if (pfadTreffer) {
      pfad = pfadTreffer[1];
      continue;
    }
    const methodeTreffer = zeile.match(/^ {4}([a-z]+):\s*$/);
    if (methodeTreffer && pfad && METHODEN.includes(methodeTreffer[1])) {
      operationen.add(`${methodeTreffer[1]} ${normalisiere(pfad)}`);
    }
  }
  return operationen;
}

/*
 * Die Routen des Servers lesen.
 *
 * Zeilenkommentare werden vorher entfernt: eine auskommentierte
 * `router.get(...)`-Zeile ist keine Route, wuerde sonst aber als eine
 * gezaehlt und die Ratsche verfaelschen.
 */
function serverOperationen() {
  const operationen = new Set();
  for (const datei of readdirSync(ROUTEN_DIR).filter((d) => d.endsWith(".ts"))) {
    const quelle = readFileSync(join(ROUTEN_DIR, datei), "utf8").replace(/^\s*\/\/.*$/gm, "");
    const muster = new RegExp(`router\\.(${METHODEN.join("|")})\\(\\s*"([^"]+)"`, "g");
    for (const treffer of quelle.matchAll(muster)) {
      operationen.add(`${treffer[1]} ${normalisiere(treffer[2])}`);
    }
  }
  return operationen;
}

const spec = specOperationen();
const server = serverOperationen();

// Ohne Fund stimmt der Leser nicht, nicht der Server. Sonst ginge der Check
// gruen durch, weil er nichts gefunden hat — die gefaehrlichste Art Fehler.
pruefe(spec.size > 0, "keine einzige Operation in openapi.yaml gelesen — der Spec-Leser ist kaputt");
pruefe(server.size > 0, "keine einzige Route in src/routes gelesen — der Routen-Leser ist kaputt");

// ── Richtung 1: die Spec verspricht etwas, das der Server nicht hat ────────
const versprochen = [...spec].filter((op) => !server.has(op)).sort();
for (const op of versprochen) {
  console.error(`FEHLER — openapi.yaml beschreibt "${op}", der Server hat diese Route nicht.`);
}
fehler += versprochen.length;

// ── Richtung 2: die Ratsche ───────────────────────────────────────────────
const undokumentiert = [...server].filter((op) => !spec.has(op)).sort();

if (undokumentiert.length > UNDOKUMENTIERT_ERWARTET) {
  console.error(
    `FEHLER — ${undokumentiert.length} undokumentierte Routen, erwartet waren hoechstens ` +
      `${UNDOKUMENTIERT_ERWARTET}. Neue Routen gehoeren in lib/api-spec/openapi.yaml. ` +
      `Soll die Route bewusst undokumentiert bleiben, erhoehe UNDOKUMENTIERT_ERWARTET ` +
      `in dieser Datei — mit Begruendung im Commit.`,
  );
  for (const op of undokumentiert.slice(0, 100)) console.error(`    ${op}`);
  fehler++;
} else if (undokumentiert.length < UNDOKUMENTIERT_ERWARTET) {
  console.error(
    `FEHLER — nur noch ${undokumentiert.length} undokumentierte Routen (erwartet ` +
      `${UNDOKUMENTIERT_ERWARTET}). Das ist gut: setze UNDOKUMENTIERT_ERWARTET in dieser ` +
      `Datei auf ${undokumentiert.length}, damit die Ratsche den neuen Stand bewacht.`,
  );
  fehler++;
}

if (fehler > 0) process.exit(1);
console.log(
  `OK — OpenAPI: ${spec.size} Operationen in der Spec, alle im Server vorhanden; ` +
    `${undokumentiert.length} Routen bewusst undokumentiert.`,
);
