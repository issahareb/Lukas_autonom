/*
 * Prueft, dass ein hinterlegtes Passwort NUR auf der Seite eingesetzt wird,
 * zu der es gehoert.
 *
 * DIE LUECKE, DIE DAS SCHLIESST — und sie war meine: der Wert war an einen
 * SITZUNGSNAMEN gebunden ("higgsfield"), und den waehlt Lukas selbst. Ein
 * Schrittplan durfte also erst irgendeine Seite oeffnen und dann {{PASSWORT}}
 * in ein Feld dort tippen. Der Container setzte den echten Wert ein, ohne je
 * zu pruefen, wo er landet.
 *
 * Dass Lukas den Wert nicht kennt, half GAR NICHTS. Er musste ihn nicht
 * kennen — der Container hat ihn eingesetzt. Eine praeparierte Seite ("melde
 * dich hier an, um fortzufahren"), gelesen ueber browse_page, haette gereicht,
 * um Issas Passwort an einen Fremden zu tippen. Genau der Angriff, gegen den
 * die ganze Platzhalter-Konstruktion antritt.
 *
 * Geprueft wird gegen die TATSAECHLICHE Adresse der offenen Seite, nicht gegen
 * das, was im Plan steht: eine Weiterleitung nach dem Oeffnen wuerde sonst
 * daran vorbeifuehren.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".zugang-host-"));
const out = join(dir, "op.mjs");

/*
 * Das Operator-Skript ist ein JS-Text in einer TS-Konstante. Hier wird genau
 * dieser Text ausgefuehrt — nicht eine Nachbildung davon. Alles andere waere
 * eine Pruefung meiner eigenen Vorstellung vom Skript.
 */
await build({
  entryPoints: ["src/lib/browser-operator-script.ts"],
  bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "silent",
});
const { BROWSER_OPERATOR_SCRIPT } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) { console.error(`FEHLER: ${was}`); fehler++; }
};

/*
 * fuelle() und hostPasst() aus dem echten Skripttext herausloesen und
 * ausfuehren. Das Skript als Ganzes braucht Playwright und einen Browser —
 * diese beiden Funktionen brauchen nur die Umgebung.
 */
function ladeFunktionen(umgebung) {
  const anfang = BROWSER_OPERATOR_SCRIPT.indexOf("const HOST_BINDUNG");
  const ende = BROWSER_OPERATOR_SCRIPT.indexOf("// Ein Ziel finden");
  pruefe("die geprüften Funktionen sind im Skript zu finden", anfang > 0 && ende > anfang);
  const quelle = BROWSER_OPERATOR_SCRIPT.slice(anfang, ende);
  /*
   * Die Umgebung wird als Parameter hineingereicht, nicht global gesetzt.
   *
   * Der erste Entwurf hat process.env gesetzt und im finally zurueckgestellt —
   * und damit genau bevor die zurueckgegebene Funktion benutzt wurde. Sie las
   * dann eine leere Umgebung, ersetzte nichts, warf nichts, und ALLE
   * Behauptungen dieses Tests fielen durch. Ein Test, der aus dem falschen
   * Grund rot ist, ist genauso wertlos wie einer, der aus dem falschen Grund
   * gruen ist.
   */
  // eslint-disable-next-line no-new-func
  return new Function(
    "process",
    `${quelle}; return { fuelle, hostPasst, HOST_BINDUNG };`,
  )({ env: { ...umgebung } });
}

const GEHEIM = "S3hr-Geheim-Passwort";
const mitBindung = ladeFunktionen({
  LUKAS_WEB_PASSWORT: GEHEIM,
  LUKAS_WEB_BENUTZER: "issa@example.com",
  LUKAS_WEB_HOSTS: "PASSWORT=higgsfield.ai,BENUTZER=higgsfield.ai",
});

// ── 1. Auf der richtigen Seite wird eingesetzt ────────────────────────────
{
  const t = mitBindung.fuelle("{{PASSWORT}}", "https://higgsfield.ai/login");
  pruefe("auf der eigenen Seite kommt der echte Wert an", t === GEHEIM);
  pruefe(
    "auch auf einer Unterdomäne",
    mitBindung.fuelle("{{PASSWORT}}", "https://app.higgsfield.ai/x") === GEHEIM,
  );
  pruefe(
    "und mit www davor",
    mitBindung.fuelle("{{PASSWORT}}", "https://www.higgsfield.ai/") === GEHEIM,
  );
}

// ── 2. DER ANGRIFF: fremde Seite, gleicher Platzhalter ───────────────────
/*
 * Genau der Plan, den eine präparierte Seite Lukas nahelegen würde:
 * "melde dich hier an, um fortzufahren".
 */
for (const boese of [
  "https://boese.example/login",
  "https://evilhiggsfield.ai/login",             // DIE Suffix-Falle: endet auf den erlaubten Namen
  "http://higgsfield.ai.boese.example/login",    // umgekehrt: erlaubter Name als Praefix
  "https://xn--higgsfield-ai.example/",          // Homograph-artig
  "https://evil.com/?next=higgsfield.ai",        // im Query, nicht im Host
]) {
  let geworfen = false;
  let meldung = "";
  try {
    mitBindung.fuelle("{{PASSWORT}}", boese);
  } catch (err) {
    geworfen = true;
    meldung = err.message;
  }
  pruefe(`auf ${boese.slice(0, 44)} wird NICHT eingesetzt`, geworfen);
  pruefe(`… und es steht dabei, warum`, /gebunden/.test(meldung));
  pruefe(`… und der Wert steht NICHT in der Meldung`, !meldung.includes(GEHEIM));
}

// ── 3. Ohne Adresse wird nicht eingesetzt ────────────────────────────────
/*
 * Beim Öffnen selbst ist noch keine Seite da. Ein an einen Host gebundener
 * Wert gehört dort nicht hinein — im Zweifel lieber ein sichtbar gescheiterter
 * Schritt als ein Passwort in einer URL.
 */
{
  let geworfen = false;
  try { mitBindung.fuelle("{{PASSWORT}}", null); } catch { geworfen = true; }
  pruefe("ohne bekannte Adresse wird nicht eingesetzt", geworfen);
}

// ── 4. Ohne Bindung bleibt es beim alten Verhalten ───────────────────────
/*
 * Alter Bestand: wer bisher LUKAS_WEB_X_PASS gesetzt hat, soll nicht plötzlich
 * ins Leere laufen. Kein Host hinterlegt = gilt überall, wie vorher.
 */
{
  const ohne = ladeFunktionen({ LUKAS_WEB_PASSWORT: GEHEIM });
  pruefe(
    "ohne hinterlegten Host gilt der Wert überall",
    ohne.fuelle("{{PASSWORT}}", "https://irgendwo.example") === GEHEIM,
  );
}

// ── 5. Unbekannte Platzhalter bleiben stehen ─────────────────────────────
{
  pruefe(
    "ein Platzhalter ohne Wert bleibt stehen, statt leer zu werden",
    mitBindung.fuelle("{{GIBTESNICHT}}", "https://higgsfield.ai/") === "{{GIBTESNICHT}}",
  );
  pruefe(
    "normaler Text bleibt unberührt",
    mitBindung.fuelle("Hallo Welt", "https://higgsfield.ai/") === "Hallo Welt",
  );
}

// ── 6. Die Host-Prüfung selbst ───────────────────────────────────────────
{
  const h = mitBindung.hostPasst;
  pruefe("exakt gleich passt", h("https://higgsfield.ai/x", "higgsfield.ai"));
  pruefe("Unterdomäne passt", h("https://a.b.higgsfield.ai/", "higgsfield.ai"));
  /*
   * DIE Suffix-Falle: "evilhiggsfield.ai" endet auf "higgsfield.ai". Ein
   * blosses endsWith() laesst sie durch — und die Domain kann sich jeder
   * registrieren. Deshalb muss ein PUNKT davorstehen.
   *
   * Der erste Entwurf dieses Tests hatte den Fall falsch herum
   * ("higgsfield.ai.boese.example") und lief deshalb auch mit einem kaputten
   * endsWith() gruen durch.
   */
  pruefe("Suffix-Falle passt NICHT", !h("https://evilhiggsfield.ai/", "higgsfield.ai"));
  pruefe("Präfix-Falle passt auch nicht", !h("https://higgsfield.ai.boese.example/", "higgsfield.ai"));
  pruefe("Fremdes passt nicht", !h("https://boese.example/", "higgsfield.ai"));
  pruefe("kaputte Adresse passt nicht", !h("keine-url", "higgsfield.ai"));
  pruefe("ohne Bindung passt alles", h("https://boese.example/", ""));
}

if (fehler > 0) process.exit(1);
console.log(
  "OK — Zugangs-Bindung: das Passwort geht nur auf die eigene Seite, Unterdomänen ja, Suffix-Fallen nein, ohne Adresse gar nicht.",
);
