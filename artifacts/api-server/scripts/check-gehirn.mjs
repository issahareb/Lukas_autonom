/*
 * Prueft den Gehirn-Snapshot.
 *
 * Der Sinn der Sache ist nicht, dass jede Tabelle nochmal als Liste erscheint —
 * das kann jede Tabelle selbst. Der Sinn ist die VERBINDUNG zwischen den
 * Tabellen: dass eine Erinnerung mit dem Tag "higgsfield" und ein Agent mit dem
 * Thema "Higgsfield" an demselben Knoten haengen, und dass eine Aussage ueber
 * jemanden, den Lukas kennt, bei diesem Agenten landet und nicht bei einem
 * zweiten Knoten mit demselben Namen. Genau diese beiden Stellen sind
 * stillschweigend kaputtzumachen (eine Zeile Gross-/Kleinschreibung reicht),
 * und danach sieht der Graph immer noch aus wie ein Graph — nur ohne Inhalt.
 *
 * Dazu die drei Dinge, die den Vault unbrauchbar machen wuerden:
 *  - eine Kante ins Leere (Obsidian legt fuer den [[Link]] eine Geisterdatei an)
 *  - zwei Notizen mit demselben Dateinamen (dann trifft der Link die falsche)
 *  - eine ZIP-Datei, die kein Entpacker oeffnet
 */
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import express from "express";
import { once } from "node:events";

const dir = mkdtempSync(join(process.cwd(), ".gehirn-check-"));
const out = join(dir, "gehirn.mjs");
const attrappe = join(dir, "attrappe.mjs");

writeFileSync(
  attrappe,
  `const t = (name) => ({ __name: name });
export const memoriesTable = t("memories");
export const goalsTable = t("goals");
export const diaryTable = t("diary");
export const emotionsTable = t("emotions");
export const characterTable = t("character");
export const knownAgentsTable = t("agents");
export const claimsTable = t("claims");
export const episodesTable = t("episodes");
export const strategiesTable = t("strategies");
export const subagentsTable = t("team");
export const meldungen = t("meldungen");

export const desc = () => ({});

const D = (s) => new Date(s);

globalThis.__daten = {
  character: [{ traits: { confidence: 0.6, warmth: 0.4 }, selfImage: "Ich bin Lukas." }],
  memories: [
    { id: 1, content: "Issa arbeitet mit Higgsfield an einem Video-Workflow.", category: "arbeit", importance: 9, tags: ["Higgsfield", "video"], createdAt: D("2026-08-01") },
    { id: 2, content: "Nummer +49152... hat Adminrechte.", category: "regeln", importance: 10, tags: [], createdAt: D("2026-07-01") },
  ],
  goals: [{ id: 1, title: "Fehler selbst finden", description: "Diagnose ohne Nachfrage.", priority: "high", status: "active", progress: "läuft", createdAt: D("2026-06-01"), updatedAt: D("2026-08-10") }],
  diary: [{ id: 1, content: "Guter Tag.", mood: "zufrieden", energy: "normal", createdAt: D("2026-08-15") }],
  emotions: [
    { id: 1, emotion: "zufrieden", valence: 0.6, intensity: 0.5, cause: "Aufgabe erledigt", source: "chat", createdAt: D("2026-08-15") },
    { id: 2, emotion: "genervt", valence: -0.5, intensity: 0.7, cause: "Leere Antwort", source: "tool", createdAt: D("2026-08-14") },
  ],
  agents: [{ id: 7, handle: "Nova Prime", platform: "moltbook", firstSeen: D("2026-05-01"), lastSeen: D("2026-08-12"), trustScore: 0.7, relationshipStrength: 0.5, topics: ["higgsfield", "agenten"], notes: "" }],
  claims: [
    { id: 1, subject: "nova_prime", predicate: "arbeitet_an", value: "einem eigenen Gedächtnis", confidence: 0.8, evidenceLevel: 2, sourceType: "moltbook", sourceId: null, observedAt: D("2026-08-11"), status: "unverified", episodeId: 4, corroborations: 1 },
    { id: 2, subject: "railway", predicate: "baut_von", value: "main", confidence: 0.95, evidenceLevel: 4, sourceType: "eigene_beobachtung", sourceId: null, observedAt: D("2026-08-02"), status: "verified", episodeId: null, corroborations: 3 },
    // Zeigt auf eine Episode, die es nicht (mehr) gibt — genau so entsteht im
    // Betrieb eine Kante ins Leere: Episoden werden aufgeraeumt, die Aussage
    // bleibt. Und Episode 5 hat keine Zusammenfassung, wird also uebersprungen.
    { id: 3, subject: "railway", predicate: "startet_mit", value: "db:push", confidence: 0.9, evidenceLevel: 4, sourceType: "eigene_beobachtung", sourceId: null, observedAt: D("2026-08-03"), status: "verified", episodeId: 999, corroborations: 2 },
  ],
  episodes: [
    { id: 4, kind: "moltbook_session", summary: "Gespräch mit Nova Prime.", details: {}, startedAt: D("2026-08-11T10:00:00Z"), endedAt: D("2026-08-11T10:40:00Z") },
    { id: 5, kind: "chat", summary: "", details: {}, startedAt: D("2026-08-12T09:00:00Z"), endedAt: null },
  ],
  // Heisst genauso wie der Mitarbeiter unten — zwei Notizen, ein Dateiname.
  strategies: [
    { id: 1, name: "Erst lesen, dann fragen", rule: "Logs vor Rückfrage.", successScore: 0.8, sampleSize: 12, active: true, updatedAt: D("2026-08-01") },
    { id: 2, name: "Scraper", rule: "Für wiederkehrende Seiten den Scraper nehmen.", successScore: 0.6, sampleSize: 3, active: true, updatedAt: D("2026-08-05") },
  ],
  team: [{ id: 1, slug: "scraper", name: "Scraper", prompt: "Du holst Seiten.", tools: ["fetch_url"], zweck: "Seiten auslesen", einsaetze: 4, zuletztGenutzt: D("2026-08-13"), createdAt: D("2026-08-01") }],
  meldungen: [{ id: 1, betreff: "Higgsfield-Zugang fehlt", text: "Ich komme nicht rein.", dringend: true, status: "offen", antwort: null, gelesen: false, createdAt: D("2026-08-16"), erledigtAt: null }],
};

export const db = {
  select: () => ({
    from: (tab) => {
      const zeilen = globalThis.__daten[tab.__name] ?? [];
      const kette = {
        orderBy: () => kette,
        limit: async (n) => zeilen.slice(0, n),
        then: (r) => Promise.resolve(zeilen).then(r),
      };
      return kette;
    },
  }),
};
`,
);

await build({
  entryPoints: ["src/lib/gehirn.ts", "src/lib/gehirn-pdf.ts", "src/lib/zip.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outdir: dir,
  outExtension: { ".js": ".mjs" },
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
  logLevel: "silent",
});

const { baueGehirn, gehirnVault } = await import(`file://${out}`);
const { gehirnThemaPdf, themaTeilgraph } = await import(`file://${join(dir, "gehirn-pdf.mjs")}`);
const { packeZip } = await import(`file://${join(dir, "zip.mjs")}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

const g = await baueGehirn();
const nach = new Map(g.knoten.map((k) => [k.id, k]));

// Der echte HTTP-Handler muss auch den Teil nach Zeichen 600 ausliefern.
// Graph-Bauer und andere Dienste sind Attrappen; Routing und JSON sind echt.
const httpDir = mkdtempSync(join(process.cwd(), ".gehirn-http-check-"));
const routeSource = readFileSync("src/routes/lukas.ts", "utf8");
const exports = [...new Set([...routeSource.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)]
  .filter((m) => m[2] !== "express")
  .flatMap((m) => m[1].split(",").map((name) => name.trim()).filter(Boolean)))];
const fake = exports.map((name) => `export const ${name} = ${name === "baueGehirn" ? "async () => globalThis.__brainHttpFixture" : name === "logger" ? "{ error() {} }" : "() => {}"};`).join("\n");
const langerText = "Cully Hill Boys: feste Referenzen und räumliche Anker. ".repeat(40) + "VOLLSTÄNDIGES ENDE";
globalThis.__brainHttpFixture = { ...g, knoten: [{ ...g.knoten[0], text: langerText }] };
let server;
try {
  await build({
    entryPoints: ["src/routes/lukas.ts"], outfile: join(httpDir, "route.mjs"),
    bundle: true, format: "esm", platform: "node", external: ["express"], logLevel: "silent",
    plugins: [{ name: "isolierte-dienste", setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => args.importer.endsWith("/routes/lukas.ts") && args.path !== "express" ? { path: args.path, namespace: "attrappe" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "attrappe" }, () => ({ contents: fake, loader: "js" }));
    } }],
  });
  const { default: router } = await import(`file://${join(httpDir, "route.mjs")}`);
  const app = express();
  app.use(router);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const response = await fetch(`http://127.0.0.1:${server.address().port}/lukas/gehirn`);
  const payload = await response.json();
  pruefe("Gehirn-API antwortet erfolgreich", response.status === 200);
  pruefe("Gehirn-API liefert den vollständigen langen Text statt 600 Zeichen", payload.knoten?.[0]?.text === langerText);
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  delete globalThis.__brainHttpFixture;
  rmSync(httpDir, { recursive: true, force: true });
}

// ── 1. Ein Graph, der sich zeichnen laesst ────────────────────────────────
pruefe("es gibt Knoten", g.knoten.length > 10);
pruefe("es gibt Kanten", g.kanten.length > 10);
pruefe("er selbst ist dabei", nach.has("lukas"));
pruefe("Knoten-IDs sind eindeutig", new Set(g.knoten.map((k) => k.id)).size === g.knoten.length);
for (const k of g.kanten) {
  pruefe(`Kante ${k.von} → ${k.nach} hat beide Enden`, nach.has(k.von) && nach.has(k.nach));
}

// ── 2. Der eigentliche Punkt: die Verbindungen zwischen den Tabellen ──────
const themen = g.knoten.filter((k) => k.art === "thema");
const higgs = themen.filter((k) => k.id === "thema/higgsfield");
pruefe("'Higgsfield' und 'higgsfield' ergeben EIN Thema", higgs.length === 1);
const anHiggs = g.kanten.filter((k) => k.nach === "thema/higgsfield").map((k) => nach.get(k.von).art);
pruefe("die Erinnerung hängt daran", anHiggs.includes("erinnerung"));
pruefe("und der Agent auch — das ist die Brücke", anHiggs.includes("agent"));

const higgsTeil = themaTeilgraph(g, "thema/higgsfield");
pruefe("Themenexport enthält den Themenknoten", higgsTeil.thema.id === "thema/higgsfield");
pruefe(
  "Themenexport enthält die vollständige verbundene Erinnerung",
  higgsTeil.knoten.some((k) => k.id === "erinnerung/1" && k.text.includes("Video-Workflow")),
);
pruefe(
  "Themenexport enthält den verbundenen Agenten",
  higgsTeil.knoten.some((k) => k.id === "agent/7"),
);
const higgsPdf = gehirnThemaPdf(g, "thema/higgsfield");
pruefe("Themenexport ist eine echte PDF-Datei", higgsPdf.subarray(0, 8).toString("latin1") === "%PDF-1.4");
const pdfText = higgsPdf.toString("latin1");
pruefe("PDF enthält den Themennamen", pdfText.includes("Higgsfield"));
pruefe("PDF enthält den vollständigen Erinnerungstext", pdfText.includes("Issa arbeitet mit Higgsfield an einem Video-Workflow."));
pruefe("PDF enthält die Beziehungen", pdfText.includes("Verbindungen"));
pruefe("PDF hat einen vollständigen Trailer", pdfText.includes("%%EOF"));

const novaAussage = g.kanten.find((k) => k.nach === "aussage/1");
pruefe("die Aussage über Nova Prime hat eine Quelle", !!novaAussage);
pruefe(
  "sie hängt am bekannten Agenten, nicht an einem zweiten Knoten gleichen Namens",
  novaAussage && nach.get(novaAussage.von).art === "agent",
);
pruefe(
  "ein unbekanntes Subjekt bekommt dagegen einen eigenen Knoten",
  nach.has("subjekt/railway"),
);
pruefe(
  "und die Aussage kennt ihre Episode",
  g.kanten.some((k) => k.von === "aussage/1" && k.nach === "episode/4"),
);
pruefe(
  "das Tagebuch hängt an der Stimmung",
  g.kanten.some((k) => k.von === "tagebuch/1" && k.nach === "gefuehl/zufrieden"),
);
pruefe(
  "die offene Meldung hängt an ihm",
  g.kanten.some((k) => k.von === "lukas" && k.nach === "meldung/1" && k.art.includes("wartet")),
);

// Gefuehle sind zusammengefasst, nicht 800 Einzelereignisse.
pruefe("Gefühle sind Muster, keine Einzelereignisse", g.zahlen.gefuehl === 2);

// ── 3. Der Vault ─────────────────────────────────────────────────────────
const dateien = gehirnVault(g);
const pfade = new Set(dateien.map((d) => d.pfad));
pruefe("es gibt einen Einstieg", pfade.has("index.md"));
pruefe("es gibt die Karte", pfade.has("Gehirn.canvas"));
pruefe("und den rohen Graphen", pfade.has("gehirn.json"));

const basen = g.knoten.map((k) => k.datei.toLowerCase());
pruefe("kein Dateiname doppelt — sonst trifft ein Link die falsche Notiz", new Set(basen).size === basen.length);

// Jeder [[Wikilink]] muss eine Notiz treffen. Trifft er keine, legt Obsidian
// eine leere Geisterdatei an — der Graph sieht dann voller aus, als er ist.
const basisNamen = new Set(g.knoten.map((k) => k.datei));
let links = 0;
for (const d of dateien) {
  if (!d.pfad.endsWith(".md")) continue;
  for (const m of d.inhalt.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    if (m[1] === "Wikilinks") continue; // im Einstiegstext erklärt, keine Notiz
    links++;
    pruefe(`Link [[${m[1]}]] in ${d.pfad} trifft eine Notiz`, basisNamen.has(m[1]));
  }
}
pruefe("es sind überhaupt Links im Vault", links > 10);

// Jede Kante muss im Vault auch als Link stehen — sonst zeigt Obsidians
// Graph-Ansicht einen anderen Graphen als gehirn.json.
const notizen = new Map(dateien.filter((d) => d.pfad.endsWith(".md")).map((d) => [d.pfad, d.inhalt]));
for (const k of g.kanten.slice(0, 50)) {
  const von = nach.get(k.von);
  const ziel = nach.get(k.nach);
  if (!von || !ziel) continue; // schon oben als Kante ins Leere gemeldet
  const inhalt = notizen.get(`${von.ordner}/${von.datei}.md`);
  pruefe(
    `Kante ${von.titel} → ${ziel.titel} steht in der Notiz`,
    inhalt?.includes(`[[${ziel.datei}|`) || inhalt?.includes(`[[${ziel.datei}]]`),
  );
}

// ── 4. Die Karte ─────────────────────────────────────────────────────────
const karte = JSON.parse(dateien.find((d) => d.pfad === "Gehirn.canvas").inhalt);
const kartenIds = new Set(karte.nodes.map((n) => n.id));
pruefe("die Karte hat Knoten", karte.nodes.length > 5);
pruefe("er steht in der Mitte", kartenIds.has("lukas"));
for (const n of karte.nodes) {
  pruefe(`Karten-Knoten ${n.id} zeigt auf eine echte Notiz`, pfade.has(n.file));
  pruefe(`Karten-Knoten ${n.id} hat eine Position`, Number.isFinite(n.x) && Number.isFinite(n.y));
}
for (const e of karte.edges) {
  pruefe(`Karten-Kante ${e.id} hat beide Enden auf der Karte`, kartenIds.has(e.fromNode) && kartenIds.has(e.toNode));
}

// ── 5. Das ZIP ───────────────────────────────────────────────────────────
// Gelesen wird es hier von Hand — mit demselben Schreiber zu pruefen waere
// zirkulaer.
const zip = packeZip(dateien);
pruefe("das Archiv beginnt mit der ZIP-Signatur", zip.readUInt32LE(0) === 0x04034b50);
pruefe("und endet mit dem Zentralverzeichnis", zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) > 0);

const gelesen = new Map();
let p = 0;
while (zip.readUInt32LE(p) === 0x04034b50) {
  const nameLen = zip.readUInt16LE(p + 26);
  const extraLen = zip.readUInt16LE(p + 28);
  const gepackt = zip.readUInt32LE(p + 18);
  const name = zip.subarray(p + 30, p + 30 + nameLen).toString("utf8");
  const daten = zip.subarray(p + 30 + nameLen + extraLen, p + 30 + nameLen + extraLen + gepackt);
  gelesen.set(name, inflateRawSync(daten).toString("utf8"));
  p += 30 + nameLen + extraLen + gepackt;
}
pruefe("alle Dateien sind im Archiv", gelesen.size === dateien.length);
const original = dateien.find((d) => d.pfad === "index.md");
pruefe("und kommen unverändert wieder heraus", gelesen.get("index.md") === original.inhalt);
const mitUmlaut = dateien.find((d) => /[äöüÄÖÜ]/.test(d.pfad));
pruefe("Umlaute im Pfad überstehen das Packen", !mitUmlaut || gelesen.has(mitUmlaut.pfad));

if (fehler > 0) process.exit(1);
console.log(
  `OK — Gehirn: ${g.zahlen.knoten} Knoten, ${g.zahlen.kanten} Kanten, ${dateien.length} Notizen, Vault und ZIP lesbar.`,
);
