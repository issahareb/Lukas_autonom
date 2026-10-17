import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "lukas-prompt-pruefung-"));
const stub = join(dir, "stubs.mjs");
writeFileSync(stub, [
  'export const logger = { info(){}, warn(){}, error(){}, debug(){} };',
  'export const BILD_MARKE = "LUKAS_TEST_BILD";',
].join("\n"));

let checks = 0;
function pruefe(name, value) {
  assert.ok(value, name);
  checks++;
}

try {
  await build({
    entryPoints: ["src/lib/lukas-soul.ts", "src/lib/lukas-prompt-auswahl.ts", "src/lib/ai/context-window.ts"],
    outdir: dir, entryNames: "[name]", bundle: true, format: "esm", platform: "node",
    outExtension: { ".js": ".mjs" },
    plugins: [{
      name: "isolierte-pruefung",
      setup(b) {
        b.onResolve({ filter: /(^|\\/)(logger|bildablage)$/ }, () => ({ path: stub }));
      },
    }],
    logLevel: "silent",
  });

  const { LUKAS_SOUL } = await import(pathToFileURL(join(dir, "lukas-soul.mjs")));
  const { waehleLukasPrompt } = await import(pathToFileURL(join(dir, "lukas-prompt-auswahl.mjs")));
  const { fitLukasContext } = await import(pathToFileURL(join(dir, "context-window.mjs")));

  const normal = waehleLukasPrompt("Hallo, wie geht es dir?");
  pruefe("kurze Frage ohne teure Sondermodule", normal.module.length === 0);
  pruefe("Kern mindestens 55 Prozent kuerzer", normal.stabil.length < LUKAS_SOUL.length * 0.45);
  pruefe("Persoenlichkeit bleibt erhalten", normal.stabil.includes("## CHARACTER"));
  pruefe("Autonomie bleibt erhalten", normal.stabil.includes("## DU HANDELST"));
  pruefe("Freigaben bleiben erhalten", normal.stabil.includes("## FREIGABEN"));
  pruefe("Grenzen fuer fremde Inhalte bleiben erhalten", normal.stabil.includes("## POST VON FREMDEN"));
  pruefe("Datenschutz und Zugangsregeln bleiben erhalten", normal.stabil.includes("## ISSAS ZUGÄNGE"));
  pruefe("Gedanken und Gefuehlsregeln bleiben erhalten", normal.stabil.includes("## EMOTIONALE REALITÄT"));
  pruefe("keine unnoetigen GitHub-Werkzeugregeln", !normal.stabil.includes("- github_read_path:"));
  pruefe("keine unnoetigen Telefonregeln", !normal.stabil.includes("- telefon_kontakte:"));

  const code = waehleLukasPrompt("Implementiere einen Bugfix in meinem TypeScript Repo");
  pruefe("Code-Modul ausgewaehlt", code.module.includes("code"));
  pruefe("komplette Code-Pfade im Modul", code.dynamisch.includes("- github_read_path:"));
  pruefe("Sandbox- und Host-Hinweise im Modul", code.dynamisch.includes("execute_command"));
  pruefe("kein Telefontext in Codeaufgaben", !code.dynamisch.includes("- telefon_kontakte:"));

  const telefon = waehleLukasPrompt("Rufe einen Kontakt ueber Telnyx an");
  pruefe("Telefon-Modul ausgewaehlt", telefon.module.includes("telefon"));
  pruefe("Anruf- und Aufnahme-Regeln erhalten", telefon.dynamisch.includes("Aufnahmezustimmung"));
  pruefe("kein Github-Code in Telefonaufgaben", !telefon.dynamisch.includes("- github_read_path:"));

  const email = waehleLukasPrompt("Schreibe eine E-Mail an einen Kunden");
  pruefe("E-Mail nur bei Mail-Aufgaben", email.module.includes("email") && email.dynamisch.includes("email_send"));
  const video = waehleLukasPrompt("Erstelle zwei Higgsfield Clips");
  pruefe("Video-Workflow nur bei Videothema", video.module.includes("video") && video.dynamisch.includes("get_workflow_instructions"));
  const kombinierte = waehleLukasPrompt("Rufe jemanden an und pruefe danach das Repository");
  pruefe("Mehrfachauftrag laedt beide Module", kombinierte.module.includes("telefon") && kombinierte.module.includes("code"));
  const fortsetzung = waehleLukasPrompt("Ja, mach weiter " + "Implementiere den Codefix in TypeScript");
  pruefe("Folgeantwort behaelt vorigen technischen Auftrag", fortsetzung.module.includes("code"));
  pruefe("Cachepraefix bleibt ueber verschiedene Aufgaben identisch", normal.stabil === code.stabil && code.stabil === telefon.stabil);

  const promptQuelle = readFileSync("src/lib/system-prompt.ts", "utf8");
  const rueckgabe = promptQuelle.slice(promptQuelle.indexOf("return `${prompt.stabil}"));
  pruefe("stabile Seele VOR Cache-Marke", rueckgabe.indexOf("${prompt.stabil}") < rueckgabe.indexOf("${CACHE_TRENNER}"));
  pruefe("Spezialregeln NACH Cache-Marke", rueckgabe.indexOf("${CACHE_TRENNER}") < rueckgabe.indexOf("${prompt.dynamisch"));

  const original = [
    { role: "system", content: "S".repeat(1300) },
    ...Array.from({ length: 28 }, (_, i) => [
      { role: "user", content: ("Alte Nachricht " + i).padEnd(1800, "A") },
      { role: "assistant", content: ("Alte Antwort " + i).padEnd(1600, "B") },
    ]).flat(),
  ];
  delete process.env.LUKAS_CONTEXT_MAX_CHARS;
  delete process.env.LUKAS_CONTEXT_COMPLEX_MAX_CHARS;
  const simpel = fitLukasContext([...original, { role: "user", content: "Hallo" }]);
  const komplex = fitLukasContext([...original, { role: "user", content: "Analysiere TypeScript Code und Repo" }]);
  pruefe("einfacher Dialog benoetigt weniger Verlauf", simpel.length < komplex.length);
  pruefe("aktuelle Nachricht bleibt", simpel.at(-1)?.content === "Hallo");
  pruefe("Systemnachricht bleibt", simpel[0]?.role === "system");
  pruefe("Originalarchiv nicht veraendert", original.length === 57);
  process.env.LUKAS_CONTEXT_MAX_CHARS = "150000";
  pruefe("explizite lange Grenze bleibt moeglich", fitLukasContext([...original, { role: "user", content: "Hallo" }]).length === 58);
  delete process.env.LUKAS_CONTEXT_MAX_CHARS;

  console.log("OK: " + checks + " Prompt- und Kontextregressionen. Fester Prompt " +
    normal.stabil.length + " statt " + LUKAS_SOUL.length + " Zeichen, spart " +
    Math.round(100 * (1 - normal.stabil.length / LUKAS_SOUL.length)) + " % am Seelenanteil.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
