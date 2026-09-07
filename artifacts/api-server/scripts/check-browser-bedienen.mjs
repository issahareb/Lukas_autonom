/*
 * Prueft, dass Lukas eine Seite bedienen kann — und dass das Passwort dabei
 * nirgends hinkommt, wo es nicht hingehoert.
 *
 * Der Punkt, um den es hier wirklich geht: Lukas liest fremde Seiten. Kennte
 * er das Passwort, koennte eine praeparierte Seite ihn dazu bringen, es
 * hinzuschreiben — in ein Formular, in eine Antwort, in eine Notiz. Deshalb
 * steht im Schrittplan nur {{PASSWORT}}, und der echte Wert wird erst IM
 * CONTAINER eingesetzt. Was er nicht kennt, kann ihm niemand entlocken.
 *
 * Geprueft wird deshalb dreierlei:
 *  1. Der Plan kommt vollstaendig im Container an, mit dem Platzhalter.
 *  2. Der echte Wert geht als Umgebungsvariable an docker exec — und taucht
 *     NICHT im Plan auf.
 *  3. Die Sitzung ist ein benanntes Profil: gleiche Sitzung = gleiche
 *     Anmeldung beim naechsten Mal.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".browser-check-"));
const out = join(dir, "browser.mjs");
const attrappe = join(dir, "attrappe.mjs");

/*
 * Attrappe fuer die SSH-Verbindung zum Droplet. Sie merkt sich jeden Befehl
 * und jede Eingabe — genau daran laesst sich pruefen, was tatsaechlich
 * hinausgegangen waere.
 */
writeFileSync(
  attrappe,
  `globalThis.__ssh = [];
export async function sshExec(befehl, _timeout, eingabe) {
  globalThis.__ssh.push({ befehl, eingabe });
  // Der Container laeuft und der Browser ist einsatzbereit — hier geht es um
  // das Bedienen, nicht um die Einrichtung.
  if (befehl.includes('docker ps -a')) return { code: 0, stdout: 'running', stderr: '' };
  if (befehl.includes('executablePath')) return { code: 0, stdout: 'ja', stderr: '' };
  if (befehl.includes('chromium.launch')) return { code: 0, stdout: 'bereit', stderr: '' };
  if (befehl.includes('bedienen.cjs')) {
    return {
      code: 0,
      stdout: JSON.stringify({
        ok: true,
        url: 'https://higgsfield.ai/dashboard',
        titel: 'Higgsfield',
        schritte: [
          { nummer: 1, art: 'oeffne', ok: true, info: 'HTTP 200' },
          { nummer: 2, art: 'tippe', ok: true, info: 'ausgefüllt: input[name=email]' },
          { nummer: 3, art: 'klicke', ok: true, info: 'geklickt: Anmelden' },
        ],
        felder: ['button Neues Projekt', 'input:text Suche'],
        text: 'Willkommen zurück, Issa',
        bild: 'BILDSCHIRMFOTO-BASE64',
      }),
      stderr: '',
    };
  }
  return { code: 0, stdout: '', stderr: '' };
}
export function shQuote(s) { return "'" + String(s).replace(/'/g, "'\\\\''") + "'"; }
export const logger = { info() {}, warn() {}, error() {}, debug() {} };
`,
);

await build({
  entryPoints: ["src/lib/browser.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  plugins: [
    {
      name: "attrappen",
      setup(b) {
        b.onResolve({ filter: /(^|\/)(code-sandbox|logger)$/ }, () => ({ path: attrappe }));
      },
    },
  ],
  logLevel: "silent",
});

const { bedienePage } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

const GEHEIM = "supergeheimes-passwort-42";

globalThis.__ssh = [];
const ergebnis = await bedienePage(
  "higgsfield",
  [
    { art: "oeffne", url: "https://higgsfield.ai/login" },
    { art: "tippe", wahl: "input[name=email]", text: "{{BENUTZER}}" },
    { art: "tippe", wahl: "input[type=password]", text: "{{PASSWORT}}" },
    { art: "klicke", wahl: "Anmelden" },
  ],
  { BENUTZER: "issa@example.com", PASSWORT: GEHEIM },
);

// ── 1. Es kommt etwas Brauchbares zurück ─────────────────────────────────
pruefe("die Schritte laufen durch", ergebnis.ok === true);
pruefe("er weiß, wo er gelandet ist", ergebnis.url === "https://higgsfield.ai/dashboard");
pruefe("und was er getan hat", ergebnis.schritte?.length === 3);
pruefe(
  "die bedienbaren Elemente kommen mit — damit er den nächsten Schritt planen kann",
  (ergebnis.felder ?? []).some((f) => f.includes("Neues Projekt")),
);

/*
 * Das Bildschirmfoto muss durchgereicht werden — sonst arbeitet er blind.
 * Der Text einer Seite verraet nicht, ob ein Banner ueber dem Knopf liegt.
 */
pruefe("das Bildschirmfoto kommt mit", ergebnis.bild === "BILDSCHIRMFOTO-BASE64");

// ── 2. Der Plan geht vollständig hinüber ─────────────────────────────────
const planEingabe = globalThis.__ssh.find((a) => /plan-[0-9a-f]+\.json/.test(a.befehl))?.eingabe ?? "";
pruefe("der Plan wird im Container abgelegt", planEingabe.length > 0);
const plan = JSON.parse(planEingabe);
pruefe("mit allen vier Schritten", plan.length === 4);
pruefe("und mit dem Platzhalter statt des Werts", plan[2].text === "{{PASSWORT}}");

/*
 * Jeder Aufruf bekommt eine EIGENE Plandatei.
 *
 * Vorher schrieben alle nach /browser/plan.json. Zwei gleichzeitige Aufträge —
 * Issa im Chat und der autonome Lauf — überschrieben sich gegenseitig: der
 * eine führte den Plan des anderen aus. Auf einer Seite, auf der man
 * eingeloggt ist, ist das kein Schönheitsfehler.
 */
{
  const planBefehle = globalThis.__ssh.filter((a) => /plan-[0-9a-f]+\.json/.test(a.befehl));
  pruefe("die Plandatei trägt einen zufälligen Namen", planBefehle.length > 0);
  pruefe(
    "und heißt NICHT mehr für alle gleich",
    !globalThis.__ssh.some((a) => /\bplan\.json\b/.test(a.befehl)),
  );
  const laufBefehl = globalThis.__ssh.find((a) => a.befehl.includes("node bedienen.cjs"))?.befehl ?? "";
  pruefe("der Lauf benutzt genau diese Datei", /plan-[0-9a-f]+\.json/.test(laufBefehl));
  pruefe("und räumt sie danach weg", /rm -f plan-[0-9a-f]+\.json/.test(laufBefehl));
}

// ── 3. Das Passwort — die eigentliche Prüfung ────────────────────────────
pruefe("das Passwort steht NICHT im Schrittplan", !planEingabe.includes(GEHEIM));

const aufruf = globalThis.__ssh.find((a) => a.befehl.includes("node bedienen.cjs"))?.befehl ?? "";
pruefe(
  "es geht als Umgebungsvariable an den Container",
  aufruf.includes("-e LUKAS_WEB_PASSWORT=") && aufruf.includes(GEHEIM),
);
pruefe("der Benutzername ebenso", aufruf.includes("-e LUKAS_WEB_BENUTZER="));
// Doppelt gequotet, weil der Name durch zwei Schalen geht (docker exec → sh -lc).
pruefe(
  "und die Sitzung ist benannt — gleiche Sitzung, gleiche Anmeldung",
  /node bedienen\.cjs .*higgsfield/.test(aufruf),
);

// Ein Sitzungsname aus einer fremden Quelle darf keinen Befehl anhängen.
globalThis.__ssh = [];
await bedienePage("boese; rm -rf /", [{ art: "oeffne", url: "https://example.com" }]);
const boese = globalThis.__ssh.find((a) => a.befehl.includes("node bedienen.cjs"))?.befehl ?? "";
pruefe(
  "ein Sitzungsname mit Semikolon hängt keinen zweiten Befehl an",
  // Der Name steht in Anführungszeichen; nach dem Skriptaufruf folgt nur noch
  // die Plandatei, kein zweiter Befehl.
  // Entscheidend: direkt nach dem Skriptnamen muss ein Anführungszeichen
  // stehen. Ohne Quoting stünde dort "bedienen.cjs boese; rm -rf /" — und die
  // Shell führte den zweiten Teil als eigenen Befehl aus.
  /node bedienen\.cjs '/.test(boese) && /rm -rf/.test(boese),
);

// Nur erlaubte Variablennamen gehen durch.
globalThis.__ssh = [];
await bedienePage("test", [{ art: "oeffne", url: "https://example.com" }], {
  "BOESE; export PATH": "x",
  RICHTIG: "y",
});
const gefiltert = globalThis.__ssh.find((a) => a.befehl.includes("node bedienen.cjs"))?.befehl ?? "";
pruefe("ein krummer Variablenname fliegt raus", !gefiltert.includes("BOESE"));
pruefe("ein sauberer bleibt", gefiltert.includes("LUKAS_WEB_RICHTIG"));

// ── 4. Grenzen ───────────────────────────────────────────────────────────
pruefe("ohne Schritte passiert nichts", (await bedienePage("x", [])).ok === false);
pruefe(
  "und ein Plan mit 50 Schritten wird abgelehnt statt halb ausgeführt",
  (await bedienePage("x", Array.from({ length: 50 }, () => ({ art: "scrolle" })))).ok === false,
);

if (fehler > 0) process.exit(1);
console.log(
  "OK — Browser bedienen: Schritte kommen an, Sitzung bleibt benannt, das Passwort geht nie durch den Plan.",
);
