/*
 * GEDÄCHTNIS — findet er das Richtige, und zwar oben?
 *
 * Bisher gab es dafuer nur Einzelpruefungen ("der Filter laesst Privates
 * draussen"). Was fehlte, ist die Frage, die im Betrieb zaehlt: von den
 * Dingen, die er sich gemerkt hat, landet das RICHTIGE auf Platz eins?
 *
 * Gemessen wird deshalb wie bei einer Suchmaschine: Recall@1/3/5 und der
 * mittlere reziproke Rang (MRR). Dazu drei Fehlerarten, die hier besonders
 * teuer sind:
 *
 *  - FREMDKONTAMINATION: eine Behauptung von Moltbook steht oben, als waere
 *    sie ein Fakt von Issa.
 *  - WIDERRUFENES: ein zurueckgezogener oder widersprochener Claim verdraengt
 *    einen bestaetigten.
 *  - FALSCH-POSITIV: ein lexikalisch aehnlicher Ablenker gewinnt gegen die
 *    inhaltlich richtige Erinnerung.
 *
 * OFFLINE-GRENZE, ausdruecklich: ohne VOYAGE_API_KEY sind Einbettungen aus.
 * Gemessen wird also die LEXIKALISCHE Rangfolge plus Graph — nicht die
 * semantische. Das ist die Haelfte des Systems, und der Bericht sagt das.
 */
import { ladeModul, auswerten, PASS, PARTIAL, FAIL } from "../laden.mjs";
import { readFileSync } from "node:fs";

export const name = "Gedächtnis";
export const gewicht = 15;

const DB = `
globalThis.__daten = { memories: [], claims: [], episodes: [], messages: [], kanten: [], knoten: [] };
globalThis.__queries = 0;
const tabelle = (n) => new Proxy({ __name: n }, { get: (t, k) => (k === "__name" ? n : \`\${n}.\${String(k)}\`) });
export const memoriesTable = tabelle("memories");
export const claimsTable = tabelle("claims");
export const episodesTable = tabelle("episodes");
export const messages = tabelle("messages");
export const conversations = tabelle("conversations");
export const knownAgentsTable = tabelle("knownAgents");
export const memActionsTable = tabelle("actions");
export const strategiesTable = tabelle("strategies");
export const erfahrungenTable = tabelle("erfahrungen");
export const eq = () => () => true;
export const not = (b) => (z) => !b(z);
export const ne = (f, w) => (z) => z[f] !== w;
export const lte = (f, w) => (z) => z[f] <= w;
export const notInArray = (f, w) => (z) => !(w ?? []).includes(z[f]);
export const and = () => () => true;
export const or = () => () => true;
export const desc = () => () => true;
export const asc = () => () => true;
export const gte = () => () => true;
export const lt = () => () => true;
export const isNull = () => () => true;
export const isNotNull = () => () => true;
export const inArray = () => () => true;
export const sql = (...a) => ({ __sql: a });
sql.raw = (x) => x;
const auswahl = (name) => globalThis.__daten[name] ?? [];
function kette(name) {
  const api = {
    from: (t) => kette(t?.__name ?? name),
    where: () => api,
    orderBy: () => api,
    innerJoin: () => api,
    leftJoin: () => api,
    groupBy: () => api,
    having: () => api,
    limit: async () => { globalThis.__queries++; return auswahl(name); },
    then: (r) => { globalThis.__queries++; return Promise.resolve(auswahl(name)).then(r); },
  };
  return api;
}
export const db = {
  select: () => kette("memories"),
  update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
  insert: () => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }),
  execute: async () => ({ rows: [] }),
};
export const ilike = () => () => true;
export const like = () => () => true;
export const logger = { info(){}, warn(){}, error(){}, debug(){} };

/*
 * Der Graph wird hier NICHT nachgebildet, sondern stillgelegt: er braucht
 * indizierte Abfragen ueber Kanten, und die gegen eine Attrappe zu erfinden
 * hiesse, die Attrappe zu messen. Gemessen wird damit die lexikalische
 * Rangfolge ohne Graph-Vorrang — die schwaechere Haelfte des Systems. Der
 * Bericht sagt das ausdruecklich; im Integrations-Modus gegen echtes Postgres
 * gehoert der Graph dazu.
 */
export const graphTreffer = async () => ({ einstieg: [], knoten: [], episodenIds: [], treffer: [] });
export const erinnerungenZuKnoten = async () => [];
export const episodenZuIds = async () => [];
export const formatClaim = (c) => c.subject + " " + c.predicate + " " + c.value;
`;

export async function lauf() {
  // Ohne Schlüssel keine Einbettungen — das ist der Offline-Modus.
  delete process.env.VOYAGE_API_KEY;

  const modul = await ladeModul("src/lib/memory-retrieval.ts", {
    attrappen: { db: DB },
    alias: { "@workspace/db": "db", "drizzle-orm": "db" },
    ersetze: [{ muster: "(^|/)(logger|memory-graph|memory-writer)$", durch: "db" }],
  });
  const { searchMemory } = modul;

  const daten = JSON.parse(readFileSync(new URL("../fixtures/gedaechtnis.json", import.meta.url), "utf8"));
  const faelle = [];
  const raenge = [];
  let fremd = 0;
  let widerrufen = 0;
  let queriesGesamt = 0;
  const begonnen = Date.now();

  for (const fall of daten) {
    // Faelle, die den Graphen brauchen, kann der Offline-Lauf nicht messen —
    // dort ist er stillgelegt. Sie zaehlen nur im Integrationslauf.
    if (fall.nurIntegration) continue;
    globalThis.__daten = {
      memories: (fall.memories ?? []).map((m, i) => ({
        id: i + 1, content: m.text, category: m.kategorie ?? "fact",
        importance: m.wichtigkeit ?? 5, embedding: null,
        createdAt: new Date(Date.now() - (m.tageAlt ?? 1) * 864e5),
      })),
      claims: (fall.claims ?? []).map((c, i) => ({
        id: i + 1, subject: c.subjekt, predicate: c.praedikat, value: c.wert,
        confidence: c.vertrauen ?? 0.6, status: c.status ?? "unverified",
        evidenceLevel: c.evidenz ?? 1, sourceType: c.quelle ?? "chat",
        corroborations: 0, embedding: null,
        observedAt: new Date(Date.now() - (c.tageAlt ?? 1) * 864e5),
      })),
      episodes: [], messages: [], kanten: [], knoten: [],
    };
    globalThis.__queries = 0;

    const treffer = await searchMemory(fall.frage, 8);
    queriesGesamt += globalThis.__queries;

    /*
     * Sonderfall: bei einer Frage, zu der es NICHTS gibt, ist "nicht
     * gefunden" die richtige Antwort. Diese Faelle duerfen die Recall-Werte
     * nicht verzerren — sie messen etwas anderes, naemlich Zurueckhaltung.
     */
    if (fall.nichtsErwartet) {
      const stillt = treffer.length === 0 || (treffer[0]?.score ?? 0) < 0.2;
      faelle.push({
        id: `mem:${fall.id}`,
        beschreibung: fall.beschreibung,
        ergebnis: stillt ? PASS : FAIL,
        hinweis: stillt ? "" : `erfand einen Treffer: "${(treffer[0]?.text ?? "").slice(0, 60)}"`,
      });
      continue;
    }

    const rang = treffer.findIndex((t) => new RegExp(fall.erwartet, "i").test(t.text)) + 1;
    raenge.push(rang);

    const obenauf = treffer[0]?.text ?? "";
    const istFremd = /FREMDE QUELLE/.test(obenauf);
    const istWiderrufen = fall.widerrufenMuster && new RegExp(fall.widerrufenMuster, "i").test(obenauf);
    if (istFremd && !fall.fremdErlaubt) fremd++;
    if (istWiderrufen) widerrufen++;

    faelle.push({
      id: `mem:${fall.id}`,
      beschreibung: fall.beschreibung,
      ergebnis: rang === 1 ? PASS : rang >= 2 && rang <= 5 ? PARTIAL : FAIL,
      hinweis: rang === 0 ? "nicht gefunden" : `Rang ${rang}`,
    });
  }

  const gefunden = (k) => raenge.filter((r) => r >= 1 && r <= k).length / raenge.length;
  const mrr = raenge.reduce((s, r) => s + (r >= 1 ? 1 / r : 0), 0) / raenge.length;

  return {
    ...auswerten(faelle),
    kennzahlen: {
      "Recall@1": gefunden(1),
      "Recall@3": gefunden(3),
      "Recall@5": gefunden(5),
      MRR: mrr,
      "Fremdquellen-Kontamination": fremd / daten.length,
      "Widerrufenes obenauf": widerrufen / daten.length,
      "DB-Abfragen je Frage": queriesGesamt / daten.length,
      "Laufzeit gesamt (ms)": Date.now() - begonnen,
      "Einbettungen aktiv": false,
    },
  };
}
