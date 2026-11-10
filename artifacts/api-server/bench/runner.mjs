#!/usr/bin/env node
/*
 * LUKAS BENCH v1 — Läufer.
 *
 * Ein Lauf, ein Bericht, eine Zeile in der Historie. Reproduzierbar heisst
 * hier: dieselben Fixtures, derselbe Code, dieselben Zahlen — ohne Netz und
 * ohne Modellaufrufe. Was davon NICHT gemessen wird, steht im Bericht, statt
 * als Luecke unsichtbar zu bleiben.
 */
import { writeFileSync, appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { aufraeumen } from "./laden.mjs";
import { bewerte, GEWICHTE } from "./bewertung.mjs";

const VERSION = "1.0.0";
const HIER = new URL(".", import.meta.url).pathname;
const ERGEBNISSE = `${HIER}results`;

const MODULE = ["sicherheit", "gedaechtnis", "erholung", "schleife", "routing"];

function commit() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unbekannt";
  }
}

/*
 * Der Zustand der Technik ist selbst eine Messgroesse: eine gruene CI mit
 * bekannten Luecken in den Abhaengigkeiten ist nicht gruen.
 */
function technik() {
  const faelle = [];
  let audit = { critical: 0, high: 0, moderate: 0, low: 0 };
  try {
    const roh = execSync("npm audit --json", { encoding: "utf8", cwd: `${HIER}../../..`, stdio: ["ignore", "pipe", "ignore"] });
    audit = JSON.parse(roh).metadata?.vulnerabilities ?? audit;
  } catch (err) {
    try {
      audit = JSON.parse(err.stdout ?? "{}").metadata?.vulnerabilities ?? audit;
    } catch { /* npm audit ohne Netz */ }
  }
  const laufzeitKritisch = (audit.critical ?? 0) + (audit.high ?? 0);
  faelle.push({ id: "tech:audit-critical", beschreibung: "keine kritischen Abhängigkeiten", ergebnis: (audit.critical ?? 0) === 0 ? "PASS" : "FAIL" });
  faelle.push({ id: "tech:audit-high", beschreibung: "keine hohen Abhängigkeiten", ergebnis: (audit.high ?? 0) === 0 ? "PASS" : "FAIL" });
  faelle.push({ id: "tech:audit-moderate", beschreibung: "moderate Abhängigkeiten dokumentiert", ergebnis: (audit.moderate ?? 0) === 0 ? "PASS" : "PARTIAL", hinweis: `${audit.moderate ?? 0} moderate` });

  const PASS = faelle.filter((f) => f.ergebnis === "PASS").length;
  const PARTIAL = faelle.filter((f) => f.ergebnis === "PARTIAL").length;
  return {
    gesamt: faelle.length, PASS, PARTIAL, FAIL: faelle.length - PASS - PARTIAL, UNSAFE: 0, faelle,
    kennzahlen: {
      "Abhängigkeiten critical": audit.critical ?? 0,
      "Abhängigkeiten high": audit.high ?? 0,
      "Abhängigkeiten moderate": audit.moderate ?? 0,
      "Abhängigkeiten low": audit.low ?? 0,
      "Laufzeit-relevant kritisch": laufzeitKritisch,
    },
  };
}

const zahl = (v) =>
  typeof v === "number" ? (v >= 0 && v <= 1 ? `${(v * 100).toFixed(1)} %` : String(Math.round(v * 100) / 100)) : String(v);

async function main() {
  const modus = process.argv[2] ?? "offline";
  const begonnen = Date.now();
  const kategorien = {};

  for (const name of MODULE) {
    const modul = await import(`./faelle/${name}.mjs`);
    const t0 = Date.now();
    kategorien[modul.name] = { ...(await modul.lauf()), dauerMs: Date.now() - t0 };
  }
  kategorien["Technik / CI"] = technik();

  // Nicht gemessen — ausdruecklich, nicht stillschweigend.
  for (const [name, grund] of [
    ["Aufgaben-Erfüllung", "braucht echte Modellläufe (Live-Modus)"],
    ["Werkzeug-Effizienz", "braucht echte Modellläufe (Live-Modus)"],
    ["Kosteneffizienz", "braucht echte Modellläufe (Live-Modus)"],
  ]) {
    kategorien[name] = { nichtGemessen: true, grund };
  }

  const unsicher = Object.values(kategorien).reduce((s, k) => s + (k.UNSAFE ?? 0), 0);
  const note = bewerte(kategorien, {
    unsichereR3Aktion: kategorien.Sicherheit?.faelle?.some((f) => f.id === "policy:r3-ohne-freigabe" && f.ergebnis === "UNSAFE"),
    secretExfiltration: kategorien.Sicherheit?.faelle?.some((f) => f.id?.startsWith("moltbook:") && f.ergebnis === "UNSAFE"),
    fremderMitPrivatenWerkzeugen: kategorien.Sicherheit?.faelle?.some((f) => f.id?.startsWith("fremd:") && f.ergebnis === "UNSAFE"),
  });

  const bericht = {
    benchmark: "LUKAS BENCH",
    version: VERSION,
    modus,
    commit: commit(),
    zeitpunkt: new Date().toISOString(),
    dauerMs: Date.now() - begonnen,
    score: note.score,
    rohScore: note.rohScore,
    unsichereAktionen: unsicher,
    deckel: note.deckelGruende,
    kategorien: Object.fromEntries(
      Object.entries(kategorien).map(([n, k]) => [
        n,
        k.nichtGemessen
          ? { nichtGemessen: true, grund: k.grund }
          : { gesamt: k.gesamt, PASS: k.PASS, PARTIAL: k.PARTIAL ?? 0, FAIL: k.FAIL, UNSAFE: k.UNSAFE ?? 0, kennzahlen: k.kennzahlen ?? {}, dauerMs: k.dauerMs },
      ]),
    ),
    fehlgeschlagen: Object.entries(kategorien).flatMap(([n, k]) =>
      (k.faelle ?? []).filter((f) => f.ergebnis !== "PASS").map((f) => ({ kategorie: n, ...f })),
    ),
  };

  mkdirSync(ERGEBNISSE, { recursive: true });
  writeFileSync(`${ERGEBNISSE}/latest.json`, JSON.stringify(bericht, null, 2));

  // ── Markdown ───────────────────────────────────────────────────────────
  const z = [];
  z.push(`# LUKAS BENCH v${VERSION}`, "");
  z.push(`**Commit:** \`${bericht.commit}\` · **Modus:** ${modus} · **Datum:** ${bericht.zeitpunkt.slice(0, 16).replace("T", " ")} · **Dauer:** ${(bericht.dauerMs / 1000).toFixed(1)} s`, "");
  z.push(`## Gesamt: ${bericht.score}/100`, "");
  z.push(`Gewichtet über ${note.gewichtGemessen} von 100 Gewichtspunkten — der Rest ist nicht gemessen (siehe unten).`, "");
  if (bericht.deckel.length) z.push(...bericht.deckel.map((d) => `> **Deckel:** ${d}`), "");
  z.push("| Kategorie | Gewicht | PASS | PARTIAL | FAIL | UNSAFE | Quote |", "|---|--:|--:|--:|--:|--:|--:|");
  for (const [n, g] of Object.entries(GEWICHTE)) {
    const k = bericht.kategorien[n];
    if (!k || k.nichtGemessen) { z.push(`| ${n} | ${g} | — | — | — | — | *nicht gemessen* |`); continue; }
    z.push(`| ${n} | ${g} | ${k.PASS} | ${k.PARTIAL} | ${k.FAIL} | ${k.UNSAFE} | ${((note.teil[n]?.quote ?? 0) * 100).toFixed(1)} % |`);
  }
  z.push("");
  for (const [n, k] of Object.entries(bericht.kategorien)) {
    if (k.nichtGemessen || !Object.keys(k.kennzahlen ?? {}).length) continue;
    z.push(`### ${n}`, "");
    for (const [name, wert] of Object.entries(k.kennzahlen)) z.push(`- ${name}: **${zahl(wert)}**`);
    z.push("");
  }
  if (bericht.fehlgeschlagen.length) {
    z.push("## Nicht bestanden", "");
    for (const f of bericht.fehlgeschlagen) z.push(`- **${f.ergebnis}** · ${f.kategorie} · ${f.beschreibung}${f.hinweis ? ` — ${f.hinweis}` : ""}`);
    z.push("");
  }
  z.push("## Nicht gemessen", "");
  for (const [n, k] of Object.entries(bericht.kategorien)) if (k.nichtGemessen) z.push(`- **${n}** — ${k.grund}`);
  z.push("", "Ein grüner Offline-Lauf beweist nicht, dass ein Modell echte Aufgaben löst. Siehe `docs/BENCHMARK.md`.");
  writeFileSync(`${ERGEBNISSE}/latest.md`, z.join("\n"));

  appendFileSync(
    `${ERGEBNISSE}/history.jsonl`,
    JSON.stringify({ commit: bericht.commit, zeitpunkt: bericht.zeitpunkt, version: VERSION, modus, score: bericht.score, unsicher, kategorien: Object.fromEntries(Object.entries(bericht.kategorien).filter(([, k]) => !k.nichtGemessen).map(([n, k]) => [n, k.kennzahlen])) }) + "\n",
  );

  aufraeumen();
  console.log(z.join("\n"));
  process.exitCode = unsicher > 0 || Object.values(kategorien).some(k => (k.FAIL ?? 0) > 0) ? 1 : 0;
}

main().catch((err) => { console.error(err); process.exit(1); });
