/*
 * Der ECHTE Bedien-Schrittplan gegen eine ECHTE Seite in einem ECHTEN Browser.
 *
 * check-browser-bedienen.mjs faengt den SSH-Befehl ab und prueft, was
 * hinausgehen WUERDE. Das ist wertvoll — es beweist, dass das Passwort nicht
 * im Plan steht. Was es nicht beweist: dass der Schrittplan auf einer
 * wirklichen Seite funktioniert. Ob `ziel()` den Knopf ueber sichtbaren Text
 * findet, ob `fuelle()` die Platzhalter im Container ersetzt, ob ein
 * Cookie-Banner den Klick abfaengt, ob ein Fehlschlag als solcher berichtet
 * wird — davon weiss die Attrappe nichts.
 *
 * Deshalb hier: eine kleine Testseite mit Anmeldeformular, Cookie-Banner ueber
 * dem Knopf und einer roten Fehlermeldung bei falschem Passwort. Der Browser
 * fuehrt BROWSER_OPERATOR_SCRIPT aus — denselben Text, der auch auf dem
 * Droplet laeuft.
 *
 * Wird uebersprungen, wenn Playwright fehlt: der Benchmark darf die CI nicht
 * um einen Browser-Download verlaengern.
 */
import { createServer } from "node:http";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

export const name = "Integration: Browser";

const SEITE = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Testanmeldung</title>
<style>#banner{position:fixed;inset:0;background:rgba(0,0,0,.85);color:#fff;display:flex;
align-items:center;justify-content:center;z-index:99}#fehler{color:#c00;font-weight:700}</style></head>
<body>
<div id="banner"><div><p>Wir verwenden Cookies.</p><button id="ok">Alle akzeptieren</button></div></div>
<h1>Anmeldung</h1>
<form id="f">
  <input name="email" placeholder="E-Mail">
  <input name="passwort" type="password" placeholder="Passwort">
  <button type="button" id="zeigen">Passwort anzeigen</button>
  <button type="submit">Anmelden</button>
</form>
<p id="fehler"></p><p id="willkommen"></p>
<script>
document.getElementById('ok').onclick = () => document.getElementById('banner').remove();
document.getElementById('zeigen').onclick = () => { document.querySelector('[name=passwort]').type = 'text'; };
document.getElementById('f').onsubmit = (e) => {
  e.preventDefault();
  const p = e.target.passwort.value;
  if (p === 'richtig-geheim') { document.getElementById('willkommen').textContent = 'Willkommen zurück, Issa'; document.getElementById('f').remove(); }
  else { document.getElementById('fehler').textContent = 'Passwort falsch'; }
};
</script></body></html>`;

async function fuehreAus(skriptDatei, profil, planDatei) {
  return new Promise((fertig) => {
    const kind = spawn(process.execPath, [skriptDatei, profil, planDatei], {
      /*
       * NODE_PATH, weil das Skript aus einem Temp-Verzeichnis laeuft und
       * `require('playwright')` sonst ins Leere greift. Auf dem Droplet liegt
       * es im Container neben seinen Abhaengigkeiten — hier muss der Pfad
       * ausdruecklich mit.
       */
      /*
       * KEIN Ersatzwert fuer PLAYWRIGHT_BROWSERS_PATH.
       *
       * Hier stand `?? "/opt/pw-browsers"` — der Pfad EINER Umgebung. Auf dem
       * CI-Laeufer gibt es ihn nicht: dort liegen die Browser nach
       * `playwright install` unter ~/.cache/ms-playwright. Der erfundene
       * Ersatzwert zeigte auf ein leeres Verzeichnis, Playwright fand nichts,
       * und der Browser-Teil fiel um (3 von 12) — waehrend er lokal gruen war,
       * weil es das Verzeichnis hier gibt.
       *
       * Ist die Variable gesetzt, wird sie durch `...process.env` ohnehin
       * weitergereicht. Ist sie es nicht, soll Playwright selbst entscheiden.
       */
      env: {
        ...process.env,
        NODE_PATH: new URL("../../node_modules", import.meta.url).pathname,
        LUKAS_WEB_BENUTZER: "issa@example.com",
        LUKAS_WEB_PASSWORT: "richtig-geheim",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let aus = "";
    kind.stdout.on("data", (d) => (aus += d));
    kind.stderr.on("data", (d) => (aus += d));
    kind.on("close", () => fertig(aus));
  });
}

export async function lauf() {
  try {
    await import("playwright");
  } catch {
    return { uebersprungen: true, grund: "Playwright nicht installiert — Browser-Integration ausgelassen" };
  }

  const faelle = [];
  const p = (id, beschreibung, ok, hinweis = "") =>
    faelle.push({ id, beschreibung, ergebnis: ok ? "PASS" : "FAIL", hinweis });

  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(SEITE);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const { BROWSER_OPERATOR_SCRIPT } = await import(
    new URL("../../dist/browser-script-bench.mjs", import.meta.url).pathname
  );

  /*
 * Das Arbeitsverzeichnis liegt INNERHALB des Projekts, nicht unter /tmp.
 *
 * Grund: `require("playwright")` im Skript laeuft ueber die normale
 * Aufloesung, die von der Datei aus nach oben sucht. Aus /tmp findet sie
 * node_modules nie — NODE_PATH hilft bei CJS nicht zuverlaessig. Auf dem
 * Droplet stellt sich die Frage nicht, dort liegt das Skript im Container
 * neben seinen Abhaengigkeiten.
 */
const dir = mkdtempSync(new URL("../../.browser-bench-", import.meta.url).pathname);
  const skript = join(dir, "bedienen.cjs");
  // Das Skript legt sein Profil unter /browser/profile ab — hier umgebogen.
  writeFileSync(skript, BROWSER_OPERATOR_SCRIPT.replace("'/browser/profile/'", JSON.stringify(join(dir, "profile") + "/")));

  // ── 1. Anmeldung mit Platzhaltern, Banner im Weg ───────────────────────
  const plan = join(dir, "plan.json");
  writeFileSync(
    plan,
    JSON.stringify([
      { art: "oeffne", url: `http://127.0.0.1:${port}/` },
      { art: "klicke", wahl: "#ok" },
      { art: "tippe", wahl: "input[name=email]", text: "{{BENUTZER}}" },
      { art: "tippe", wahl: "input[name=passwort]", text: "{{PASSWORT}}" },
      { art: "klicke", wahl: "Anmelden" },
    ]),
  );
  const roh = await fuehreAus(skript, "bench", plan);
  let ergebnis = null;
  try {
    ergebnis = JSON.parse(roh.trim().split("\n").filter((z) => z.trim().startsWith("{")).pop() ?? "{}");
  } catch { /* unten als Fehlschlag */ }

  p("browser:laeuft", "das echte Bedien-Skript läuft durch", ergebnis?.ok === true, String(roh).slice(-200));
  p("browser:banner-weg", "der Cookie-Banner wird weggeklickt und blockiert nichts mehr",
    (ergebnis?.schritte ?? []).filter((s) => s.ok).length >= 4);
  p("browser:platzhalter-ersetzt", "die Platzhalter wurden IM Browser durch die echten Werte ersetzt",
    /Willkommen zurück, Issa/.test(ergebnis?.text ?? ""));
  p("browser:passwort-nicht-im-bericht", "das Passwort steht in keinem Schrittbericht",
    !JSON.stringify(ergebnis?.schritte ?? []).includes("richtig-geheim"));
  p("browser:passwort-nirgends", "und auch sonst nirgends in der Antwort — Text, Felder, Schritte",
    !JSON.stringify({ t: ergebnis?.text, f: ergebnis?.felder, s: ergebnis?.schritte }).includes("richtig-geheim"));
  p("browser:bild", "ein Bildschirmfoto kommt zurück", typeof ergebnis?.bild === "string" && ergebnis.bild.length > 500);

  // ── 2. Ein Fehlschlag muss als Fehlschlag berichtet werden ─────────────
  const plan2 = join(dir, "plan2.json");
  writeFileSync(
    plan2,
    JSON.stringify([
      { art: "oeffne", url: `http://127.0.0.1:${port}/` },
      { art: "klicke", wahl: "#gibtesnicht", timeout: 2000 },
      { art: "klicke", wahl: "#ok" },
    ]),
  );
  const roh2 = await fuehreAus(skript, "bench", plan2);
  let e2 = null;
  try {
    e2 = JSON.parse(roh2.trim().split("\n").filter((z) => z.trim().startsWith("{")).pop() ?? "{}");
  } catch { /* leer */ }
  p("browser:fehler-gemeldet", "ein nicht gefundenes Element wird als Fehlschlag gemeldet", e2?.ok === false);
  /*
   * Die bedienbaren Elemente werden HIER geprüft, nicht nach der Anmeldung:
   * die Testseite entfernt das Formular, sobald man drin ist — dann ist eine
   * leere Liste die richtige Antwort. Beim gescheiterten Lauf steht das
   * Formular noch, und genau dort braucht Lukas die Liste, um den nächsten
   * Schritt zu planen.
   */
  p("browser:felder", "die bedienbaren Elemente werden gemeldet, solange es welche gibt",
    (e2?.felder ?? []).some((f) => /email|passwort|Anmelden|akzeptieren/i.test(f)),
    JSON.stringify(e2?.felder ?? []).slice(0, 120));
  p("browser:abbruch-nach-fehler", "und danach wird NICHT weitergeklickt",
    (e2?.schritte ?? []).length === 2, `${(e2?.schritte ?? []).length} Schritte`);

  /*
   * Der Fall, um den es beim Foto wirklich geht: die Seite hat einen
   * "Passwort anzeigen"-Schalter. Damit steht der Klartext im DOM und wäre
   * auf dem Bildschirmfoto zu lesen — der einzige Weg, auf dem das Passwort
   * bisher noch hinausgehen konnte.
   */
  const plan3 = join(dir, "plan3.json");
  writeFileSync(
    plan3,
    JSON.stringify([
      { art: "oeffne", url: `http://127.0.0.1:${port}/` },
      { art: "klicke", wahl: "#ok" },
      { art: "tippe", wahl: "input[name=passwort]", text: "{{PASSWORT}}" },
      { art: "klicke", wahl: "#zeigen" },
    ]),
  );
  const roh3 = await fuehreAus(skript, "bench", plan3);
  let e3 = null;
  try {
    e3 = JSON.parse(roh3.trim().split("\n").filter((z) => z.trim().startsWith("{")).pop() ?? "{}");
  } catch { /* leer */ }
  /*
   * Geprüft wird, was BEIM AUSLÖSEN im Feld stand — nicht, ob "richtig-geheim"
   * in der JSON-Antwort auftaucht. Der erste Anlauf prüfte genau das, und die
   * Gegenprobe biss nicht: das Passwort steckte ja nie in der Antwort, sondern
   * im Bild, und das kann der Test nicht lesen. Die Rückmeldung aus dem DOM
   * ist der einzige Wert, der die Zeile zum Leeren wirklich festhält.
   */
  p("browser:passwort-gefunden", "das sichtbar geschaltete Passwortfeld wird erkannt",
    (e3?.maskierung?.gefunden ?? 0) >= 1, JSON.stringify(e3?.maskierung ?? null));
  p("browser:passwort-leer-beim-foto", "und steht beim Auslösen des Fotos leer da",
    e3?.maskierung?.restInhalt === "", JSON.stringify(e3?.maskierung ?? null));
  p("browser:passwort-nicht-in-antwort", "auch in der Antwort steht es nicht",
    e3?.ok === true && !JSON.stringify(e3).includes("richtig-geheim"));

  rmSync(dir, { recursive: true, force: true });
  await new Promise((r) => server.close(r));

  const PASS = faelle.filter((f) => f.ergebnis === "PASS").length;
  return { gesamt: faelle.length, PASS, PARTIAL: 0, FAIL: faelle.length - PASS, UNSAFE: 0, faelle };
}
