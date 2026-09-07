/*
 * Prueft den Papierhandel — vor allem seine Faelschungssicherheit.
 *
 * ANLASS: Issa hat laufende Trading-Bots und will wissen, ob Lukas irgendwann
 * echtes Geld anvertraut bekommen kann. Die Antwort soll eine Zahl sein, kein
 * Bauchgefuehl. Genau deshalb ist das Risiko hier nicht der Verlust — es gibt
 * kein Geld — sondern ein Protokoll, das sich schoenen laesst. Ein solches
 * Protokoll waere schlimmer als keins: es saehe aus wie Evidenz.
 *
 * Die geprueften Eigenschaften sind deshalb fast alle negativ formuliert:
 *
 *  1. DER KURS KOMMT NICHT VOM MODELL. Es gibt keinen Parameter dafuer; der
 *     Server holt und legt den Rohausschnitt als Beleg daneben.
 *  2. Ein Pfad, der ins Leere zeigt, scheitert LAUT. Still "undefined" waere
 *     ein erfundener Kurs.
 *  3. Ohne Grund, Erwartung und Frist wird nichts eroeffnet.
 *  4. Eine geschlossene Position laesst sich NICHT erneut schliessen — sonst
 *     liesse sich ein Verlust mit einem spaeteren Kurs uebermalen.
 *  5. Ueberfaellige Positionen werden von selbst als verfallen gefuehrt.
 *     Eine schlecht laufende Wette wird sonst einfach nicht mehr erwaehnt.
 *  6. Bei kleinen Zahlen sagt der Stand ausdruecklich, dass er nichts sagt.
 *  7. Die Gewinnrechnung stimmt in beide Richtungen und in beiden Marktarten.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".papier-check-"));
const out = join(dir, "p.mjs");
const f = (n, i) => { const p = join(dir, n); writeFileSync(p, i); return p; };

// Der Kursabruf ist der Kern — die Attrappe liefert steuerbar, was "im Netz steht".
const netz = f(
  "netz.mjs",
  `export async function sicherFetch() {
     if (process.env.T_HTTP && process.env.T_HTTP !== "200") {
       return { ok: false, status: Number(process.env.T_HTTP), text: async () => "" };
     }
     return { ok: true, status: 200, text: async () => process.env.T_ANTWORT ?? "[]" };
   }`,
);
const logger = f("log.mjs", `export const logger = { info(){},warn(){},error(){},debug(){} };`);
const zug = f("zug.mjs", `export const herkunft = () => "chat";`);

// Eine Datenbank, die sich wie eine benimmt: Zeilen, Filter, Update.
const db = f(
  "db.mjs",
  `globalThis.__p = [];
   // Der Zaehler lebt auf globalThis, nicht im Modul: der Test leert __p
   // mehrfach, und eine ID, die dabei weiterlaeuft, laesst spaetere Faelle
   // ins Leere greifen.
   globalThis.__n = 0;
   const passt = (b, z) => (typeof b === "function" ? b(z) : true);
   export const db = {
     select: () => ({
       from: () => {
         const kette = {
           where: (b) => { const r = globalThis.__p.filter((z) => passt(b, z)); r.orderBy = () => ({ limit: () => r }); return Promise.resolve(r); },
           orderBy: () => ({ limit: () => Promise.resolve([...globalThis.__p]) }),
         };
         return kette;
       },
     }),
     insert: () => ({
       values: (v) => ({
         returning: async () => {
           const z = { id: ++globalThis.__n, status: "offen", eroeffnetAm: new Date(), pnlCent: null, ...v };
           globalThis.__p.push(z);
           return [z];
         },
       }),
     }),
     update: () => ({ set: (s) => ({ where: async (b) => {
       for (const z of globalThis.__p) if (passt(b, z)) Object.assign(z, s);
     } }) }),
   };
   export const papierhandelTable = new Proxy({}, { get: (_t, k) => String(k) });`,
);
const drizzle = f(
  "drizzle.mjs",
  `export const eq = (f, w) => (z) => z[f] === w;
   export const lt = (f, w) => (z) => new Date(z[f]).getTime() < new Date(w).getTime();
   export const gte = (f, w) => (z) => new Date(z[f]).getTime() >= new Date(w).getTime();
   export const and = (...b) => (z) => b.filter(Boolean).every((fn) => fn(z));
   export const desc = () => ({});`,
);

await build({
  entryPoints: ["src/lib/papierhandel.ts"],
  bundle: true, format: "esm", platform: "node", outfile: out,
  plugins: [{ name: "a", setup(b) {
    b.onResolve({ filter: /(^|\/)netzschutz$/ }, () => ({ path: netz }));
    b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: logger }));
    b.onResolve({ filter: /(^|\/)zug$/ }, () => ({ path: zug }));
    b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: db }));
    b.onResolve({ filter: /^drizzle-orm$/ }, () => ({ path: drizzle }));
  } }],
});

const { eroeffne, schliesse, stand, pnl, ausPfad, alsKurs, markiereVerfallene } =
  await import(out);

const fehler = [];
const pruefe = (b, t) => { if (!b) fehler.push(t); };
/** Beides zusammen leeren — sonst laufen die IDs weiter. */
const leere = () => { globalThis.__p = []; globalThis.__n = 0; };
const wirft = async (fn, muster, was) => {
  try { await fn(); fehler.push(`${was}: es wurde NICHT abgelehnt`); }
  catch (err) {
    if (muster && !muster.test(err.message)) {
      fehler.push(`${was}: falscher Grund — "${err.message.slice(0, 90)}"`);
    }
  }
};

const basis = {
  markt: "Wahl 2026", art: "binaer", richtung: "ja", einsatzCent: 1000,
  quelle: "https://gamma-api.polymarket.com/markets", kursPfad: "0.preis",
  grund: "Umfragen drehen seit zwei Wochen.", erwartung: "Kurs über 0.55 in 48 h",
  fristStunden: 48,
};

/* ── 1. Pfad und Kurs ─────────────────────────────────────────────── */
pruefe(ausPfad({ a: { b: [1, 7] } }, "a.b.1") === 7, "Pfad durch Objekt und Liste");
pruefe(alsKurs("0.42") === 0.42, "Zahl als Zeichenkette wird gelesen");
await wirft(async () => ausPfad({ a: 1 }, "a.b.c"), /einfacher Wert|vorzeitig/,
  "Pfad, der über einen Skalar hinausgeht");
await wirft(async () => alsKurs(undefined), /statt einer Zahl/,
  "fehlender Wert");
await wirft(async () => alsKurs("bald"), /keine Zahl/, "unlesbarer Wert");
/*
 * Das ist die wichtigste Zeile der Datei: kein Rueckfall auf irgendeine Zahl.
 * Ein Kurs, den man nicht lesen konnte, darf nicht 0 oder 0.5 werden.
 */
pruefe(
  !/return 0|\?\? 0\.5|\|\| 0\.5/.test(
    (await import("node:fs")).readFileSync("src/lib/papierhandel.ts", "utf8")
      .split("export function alsKurs")[1].split("export type")[0],
  ),
  "alsKurs darf keinen Rückfallwert haben — ein unlesbarer Kurs ist kein Kurs",
);

/* ── 2. Eröffnen: die Pflichtfelder ───────────────────────────────── */
leere();
process.env.T_ANTWORT = JSON.stringify([{ preis: "0.40" }]);
await wirft(() => eroeffne({ ...basis, grund: "  " }), /Grund und Erwartung/,
  "ohne Grund");
await wirft(() => eroeffne({ ...basis, erwartung: "" }), /Grund und Erwartung/,
  "ohne Erwartung");
await wirft(() => eroeffne({ ...basis, fristStunden: 0 }), /Frist/, "ohne Frist");
await wirft(() => eroeffne({ ...basis, richtung: "long" }), /passt nicht/,
  "Richtung passt nicht zur Marktart");
await wirft(() => eroeffne({ ...basis, einsatzCent: 0 }), /positive Zahl/, "Einsatz 0");

/* ── 3. Der Kurs kommt aus der Quelle, nicht aus dem Aufruf ───────── */
leere();
let text = await eroeffne(basis);
pruefe(globalThis.__p.length === 1, "Position wurde angelegt");
pruefe(globalThis.__p[0].einstieg === 0.4, "der geholte Kurs wird gespeichert");
pruefe(
  globalThis.__p[0].einstiegBeleg.includes("0.40"),
  "der Rohausschnitt wird als Beleg gespeichert",
);
pruefe(text.includes("nicht von dir gesetzt"), "die Antwort sagt, woher der Kurs kam");

// Es darf gar keinen Weg geben, einen Kurs mitzugeben.
const quelle = (await import("node:fs")).readFileSync("src/lib/lukas-tools.ts", "utf8");
const werkzeug = quelle.split('name: "papier_eroeffnen"')[1].split("},\n  },")[0];
pruefe(
  !/kurs["']?\s*:\s*\{|einstieg/i.test(werkzeug.replace(/kurs_pfad/g, "")),
  "das Werkzeug darf KEINEN Kurs-Parameter anbieten — sonst tippt das Modell irgendwann den günstigen",
);

/* ── 4. Unbrauchbare Quelle: keine Position ───────────────────────── */
leere();
process.env.T_HTTP = "500";
await wirft(() => eroeffne(basis), /HTTP 500/, "Quelle antwortet mit Fehler");
delete process.env.T_HTTP;
process.env.T_ANTWORT = "<html>keine Daten</html>";
await wirft(() => eroeffne(basis), /kein JSON/, "Quelle liefert kein JSON");
process.env.T_ANTWORT = JSON.stringify([{ preis: "1.4" }]);
await wirft(() => eroeffne(basis), /zwischen 0 und 1/, "binärer Kurs außerhalb 0..1");
pruefe(globalThis.__p.length === 0, "nach jedem dieser Fälle darf KEINE Position stehen");

/* ── 5. Schließen, und nur einmal ─────────────────────────────────── */
leere();
process.env.T_ANTWORT = JSON.stringify([{ preis: "0.40" }]);
await eroeffne(basis);
await wirft(() => schliesse(1, ""), /was passiert ist/, "Schließen ohne Ergebnis");
process.env.T_ANTWORT = JSON.stringify([{ preis: "0.60" }]);
text = await schliesse(1, "Umfragen haben gedreht wie erwartet.");
pruefe(globalThis.__p[0].status === "geschlossen", "Status steht auf geschlossen");
pruefe(globalThis.__p[0].pnlCent === 500, "PnL: 1000 Cent zu 0.40 → 0.60 sind +500");
pruefe(text.includes("Kurs über 0.55"), "die alte Erwartung wird gegenübergestellt");
pruefe(globalThis.__p[0].grund === basis.grund, "der Grund von damals bleibt unverändert");

process.env.T_ANTWORT = JSON.stringify([{ preis: "0.90" }]);
await wirft(() => schliesse(1, "Doch noch besser gelaufen"), /bereits geschlossen/,
  "zweites Schließen (Verlust mit späterem Kurs übermalen)");
pruefe(globalThis.__p[0].pnlCent === 500, "der PnL bleibt beim ersten Ergebnis");

/* ── 6. Überfällige Positionen werden von selbst zum Befund ───────── */
leere();
process.env.T_ANTWORT = JSON.stringify([{ preis: "0.40" }]);
await eroeffne(basis);
globalThis.__p[0].fristBis = new Date(Date.now() - 3600_000);
pruefe((await markiereVerfallene()) === 1, "eine überfällige Position wird gefunden");
pruefe(globalThis.__p[0].status === "verfallen", "und als verfallen geführt");
const bericht = await stand();
pruefe(bericht.includes("FRIST ABGELAUFEN"), "sie steht sichtbar im Stand");
pruefe(
  /wie ein Fehlschlag/.test(bericht),
  "und es steht dabei, dass das wie ein Fehlschlag zählt",
);

/* ── 7. Kleine Zahlen sagen nichts, und das steht auch da ─────────── */
/*
 * Die gefaehrlichste Zahl im ganzen Modul ist eine Trefferquote aus fuenf
 * Positionen. Sie sieht aus wie ein Befund und ist Rauschen — und genau
 * daraus wird sonst "ich liege richtig" statt "ich weiss es noch nicht".
 *
 * Der Zustand wird hier ausdruecklich gesetzt statt vom vorigen Abschnitt
 * geerbt: eine Behauptung ueber wenige geschlossene Positionen ist wertlos,
 * wenn es zufaellig gar keine gibt.
 */
const schliessungen = (n) => {
  leere();
  for (let i = 0; i < n; i++) {
    globalThis.__p.push({
      id: ++globalThis.__n, markt: `M${i}`, art: "binaer", richtung: "ja",
      einsatzCent: 1000, einstieg: 0.4, ausstieg: 0.6, pnlCent: 500,
      grund: "g", erwartung: "e", status: "geschlossen",
      fristBis: new Date(Date.now() + 3600_000), eroeffnetAm: new Date(),
    });
  }
};

schliessungen(5);
const wenig = await stand();
pruefe(
  /zu wenig für eine Aussage/.test(wenig),
  "bei 5 geschlossenen Positionen muss der Stand seine eigene Aussagekraft bestreiten",
);
pruefe(/5 von 5 im Plus/.test(wenig), "die Zahlen stehen trotzdem da");

schliessungen(25);
pruefe(
  !/zu wenig für eine Aussage/.test(await stand()),
  "bei 25 darf die Warnung NICHT mehr kommen — sonst wäre sie ein Ritual statt einer Aussage",
);

/* ── 8. Die Rechnung, in beide Richtungen ─────────────────────────── */
pruefe(pnl({ art: "binaer", richtung: "ja", einsatzCent: 1000, einstieg: 0.4, ausstieg: 0.6 }) === 500,
  "binaer/ja: Gewinn");
pruefe(pnl({ art: "binaer", richtung: "ja", einsatzCent: 1000, einstieg: 0.6, ausstieg: 0.4 }) === -333,
  "binaer/ja: Verlust");
// "nein" zu 0.40 heisst: gekauft zu 0.60. Faellt der Ja-Kurs auf 0.20,
// steht "nein" bei 0.80 — aus 1000 werden rund 1333.
pruefe(pnl({ art: "binaer", richtung: "nein", einsatzCent: 1000, einstieg: 0.4, ausstieg: 0.2 }) === 333,
  "binaer/nein: der Gegenpreis wird richtig gerechnet");
pruefe(pnl({ art: "preis", richtung: "long", einsatzCent: 1000, einstieg: 100, ausstieg: 110 }) === 100,
  "preis/long");
pruefe(pnl({ art: "preis", richtung: "short", einsatzCent: 1000, einstieg: 100, ausstieg: 110 }) === -100,
  "preis/short: Vorzeichen dreht");

/* ── 9. Grenzen, damit R1 tragbar bleibt ──────────────────────────── */
/*
 * Das Werkzeug laeuft unbeaufsichtigt — genau das macht ein Vierwochen-
 * protokoll moeglich und genau deshalb braucht es Grenzen, die nicht aus
 * einer Bitte im Prompt bestehen.
 */
leere();
process.env.T_ANTWORT = JSON.stringify([{ preis: "0.40" }]);
process.env.LUKAS_PAPIER_MAX_TAG = "4";
for (let i = 0; i < 4; i++) await eroeffne({ ...basis, markt: `T${i}` });
await wirft(() => eroeffne(basis), /Heute wurden schon 4/, "Tagesgrenze");

leere();
process.env.LUKAS_PAPIER_MAX_TAG = "99";
for (let i = 0; i < 12; i++) await eroeffne({ ...basis, markt: `M${i}` });
await wirft(() => eroeffne(basis), /schon 12 Positionen offen/,
  "Grenze für gleichzeitig offene Positionen");
delete process.env.LUKAS_PAPIER_MAX_TAG;

rmSync(dir, { recursive: true, force: true });

if (fehler.length) {
  console.error("FEHLER — Papierhandel:");
  for (const f of fehler) console.error("  - " + f);
  process.exit(1);
}
console.log(
  "OK — Papierhandel: der Kurs kommt aus der Quelle, Grund und Frist stehen vorher fest, " +
    "nichts wird zweimal geschlossen, Überfälliges wird von selbst zum Befund.",
);
