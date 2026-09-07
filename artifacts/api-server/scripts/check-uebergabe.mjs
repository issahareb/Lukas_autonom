/*
 * Prueft die Uebergabe vom Mitarbeiter zurueck an Lukas.
 *
 * ANLASS: hier stand ein blankes `text.slice(0, 8000)`. In einer Kette ist
 * das die schaedlichste Art zu kuerzen — der Fehleranalyst schreibt eine
 * Diagnose, der Entwickler bekommt davon 8.000 Zeichen und haelt sie fuer die
 * ganze. Er weiss nicht, dass ihm etwas fehlt, also fragt er auch nicht nach.
 * In verdichten.ts ist genau dieselbe Kuerzung seit jeher sichtbar; hier war
 * sie es nicht.
 *
 * Und: der Lauf hinterliess ein logger.info und einen Einsatzzaehler. Danach
 * war die Kette weg und nur ihr Ergebnis da. Ein schwaches Ergebnis liess
 * sich keinem Glied mehr zuordnen.
 *
 * Fuenf Eigenschaften:
 *  1. Kurze Antworten werden NICHT angefasst. Eine Marke, wo nichts fehlt,
 *     waere eine Luege in die andere Richtung.
 *  2. Lange werden gekuerzt UND sagen es, mit beiden Zahlen.
 *  3. Der Helfer laeuft unter eigener Herkunft, aber auf der Rechnung des
 *     Aufrufers.
 *  4. Jede Uebergabe wird protokolliert — auch die gescheiterte. Gerade die:
 *     ein Helfer, der wirft, ist der Fall, den man spaeter sucht.
 *  5. Die Antwort bleibt als GUTACHTEN gekennzeichnet. Der Helfer hat
 *     Webseiten gelesen; stuende sein Text ununterscheidbar in Lukas'
 *     Kontext, waere das ein bequemer Weg, ihm etwas unterzuschieben.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".uebergabe-check-"));
const out = join(dir, "s.mjs");

const f = (name, inhalt) => {
  const p = join(dir, name);
  writeFileSync(p, inhalt);
  return p;
};

// Was der Helfer zurueckgibt, steuert der Test ueber eine Umgebungsvariable —
// so laeuft der ECHTE Kuerzungscode aus subagents.ts, nicht seine Nachbildung.
const brain = f(
  "brain.mjs",
  `export async function runLukasTurn() {
     if (process.env.T_WIRFT === "1") throw new Error("Helfer abgestürzt");
     return "X".repeat(Number(process.env.T_LAENGE ?? 10));
   }`,
);
const tools = f(
  "tools.mjs",
  `export const LUKAS_TOOLS = [{ type: "function", function: { name: "web_search" } }];
   export const mitPolicyHinweis = (t) => t;`,
);
const logger = f("log.mjs", `export const logger = { info(){},warn(){},error(){},debug(){} };`);
const db = f(
  "db.mjs",
  `export const db = { select: () => ({ from: () => ({ where: () => [] }) }),
                       update: () => ({ set: () => ({ where: () => ({ catch(){} }) }) }) };
   export const subagentsTable = { slug: "slug", id: "id", einsaetze: "e", zuletztGenutzt: "z" };`,
);
const drizzle = f(
  "drizzle.mjs",
  `export const eq=()=>({}); export const desc=()=>({}); export const sql=()=>({});`,
);
// Das Protokoll sammelt der Test selbst ein.
const ueb = f(
  "ueb.mjs",
  `globalThis.__protokoll = [];
   export async function protokolliereUebergabe(u) { globalThis.__protokoll.push(u); }`,
);

await build({
  entryPoints: ["src/lib/subagents.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  external: ["node:async_hooks"],
  plugins: [
    {
      name: "attrappen",
      setup(b) {
        b.onResolve({ filter: /(^|\/)lukas-brain$/ }, () => ({ path: brain }));
        b.onResolve({ filter: /(^|\/)lukas-tools$/ }, () => ({ path: tools }));
        b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: logger }));
        b.onResolve({ filter: /(^|\/)uebergaben$/ }, () => ({ path: ueb }));
        b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: db }));
        b.onResolve({ filter: /^drizzle-orm$/ }, () => ({ path: drizzle }));
      },
    },
  ],
});

const { runSubagent } = await import(out);

const fehler = [];
const pruefe = (b, t) => { if (!b) fehler.push(t); };
const protokoll = () => globalThis.__protokoll;

/* 1. Kurz bleibt unangetastet. */
process.env.T_LAENGE = "100";
globalThis.__protokoll = [];
let antwort = await runSubagent("rechercheur", "Was ist Sache?");
pruefe(!antwort.includes("gekürzt"), "Eine kurze Antwort darf keine Kürzungsmarke bekommen");
pruefe(antwort.includes("Gutachten"), "Die Antwort muss als Gutachten gekennzeichnet bleiben");
pruefe(protokoll().length === 1, "Auch eine kurze Übergabe gehört ins Protokoll");
pruefe(protokoll()[0].gekuerzt === false, "gekuerzt muss hier falsch sein");
pruefe(protokoll()[0].ergebnisZeichen === 100, "Die volle Zeichenzahl gehört ins Protokoll");
pruefe(protokoll()[0].helfer === "rechercheur", "Der Helfer gehört ins Protokoll");

/* 2. Lang wird gekuerzt und sagt es. */
process.env.T_LAENGE = "20000";
globalThis.__protokoll = [];
antwort = await runSubagent("rechercheur", "Erzähl alles.");
pruefe(antwort.includes("[…gekürzt…]"), "Eine lange Antwort MUSS die Kürzung sichtbar machen");
pruefe(
  antwort.includes("20.000"),
  "Die echte Länge muss dastehen — sonst weiß Lukas nicht, wie viel ihm fehlt",
);
pruefe(antwort.includes("8.000"), "Die übergebene Länge muss dastehen");
pruefe(
  /frag .* gezielt nach dem fehlenden Teil/.test(antwort),
  "Es muss dastehen, wie man den Rest bekommt — eine Lücke ohne Ausweg ist nur eine Lücke",
);
pruefe(antwort.length < 12000, "Gekürzt heißt gekürzt");
pruefe(protokoll()[0].gekuerzt === true, "gekuerzt muss hier wahr sein");
pruefe(protokoll()[0].ergebnisZeichen === 20000, "Die VOLLE Länge gehört ins Protokoll, nicht die gekürzte");

/* 3. Auch der Absturz wird protokolliert. */
process.env.T_WIRFT = "1";
globalThis.__protokoll = [];
let geworfen = false;
try {
  await runSubagent("rechercheur", "Geh kaputt.");
} catch {
  geworfen = true;
}
delete process.env.T_WIRFT;
pruefe(geworfen, "Ein Fehler des Helfers muss weitergereicht werden, nicht verschluckt");
pruefe(protokoll().length === 1, "Eine gescheiterte Übergabe gehört ins Protokoll — gerade die");
pruefe(
  /*
   * Defensiv, weil das Protokoll hier leer sein KANN — genau das ist ja der
   * Fall, den diese Zeile ausschliessen soll. Ein Test, der beim Fehlschlag
   * abstuerzt statt ihn zu benennen, verschweigt die anderen Befunde.
   */
  protokoll()[0]?.fehler?.includes("abgestürzt") === true,
  "Der Grund des Scheiterns gehört ins Protokoll",
);

/* 4. Unbekannter Helfer: Hinweis statt stiller Fehlschlag. */
process.env.T_LAENGE = "10";
let hinweis = "";
try {
  await runSubagent("gibtesnicht", "Hallo");
} catch (err) {
  hinweis = err.message;
}
pruefe(hinweis.includes("gibtesnicht"), "Der unbekannte Name muss im Fehler stehen");
pruefe(
  hinweis.includes("create_subagent"),
  "Es muss dastehen, wie man sich einen passenden einstellt",
);

/* 5. Der Quelltext selbst: kein blankes slice mehr. */
const roh = await import("node:fs").then((fs) =>
  fs.readFileSync("src/lib/subagents.ts", "utf8"),
);
/*
 * Kommentare raus, bevor behauptet wird.
 *
 * Die Behauptung gilt dem CODE. Ohne diesen Schritt schlaegt sie beim ersten
 * Mal an — weil oben in subagents.ts genau die alte Zeile als Erklaerung
 * zitiert wird, warum es sie nicht mehr geben darf.
 */
const quelle = roh.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
pruefe(
  !/text\.slice\(0,\s*8000\)/.test(quelle),
  "Das blanke text.slice(0, 8000) darf nicht zurückkommen — es kürzt still",
);
pruefe(
  /imZug\(\s*\{\s*herkunft:\s*`mitarbeiter:/.test(quelle),
  "Der Helfer muss unter eigener Herkunft laufen, sonst ist er in der Rechnung unsichtbar",
);

rmSync(dir, { recursive: true, force: true });

if (fehler.length) {
  console.error("FEHLER — Übergabe:");
  for (const f of fehler) console.error("  - " + f);
  process.exit(1);
}
console.log(
  "OK — Übergabe: kurz bleibt ganz, lang wird sichtbar gekürzt mit beiden Zahlen, " +
    "jede Übergabe steht im Protokoll — auch die gescheiterte.",
);
