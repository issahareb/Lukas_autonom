import { projektSchluessel, projekteImText, aliasSchluessel } from "./projekt-aliasse";
/*
 * Gezielter Zugriff aufs Gedaechtnis ueber den Graphen — statt alles zu lesen.
 *
 * Bisher lief jede Erinnerungsfrage so: 500 Erinnerungen, 300 Claims, 150
 * Episoden und bis zu 300 Chat-Zeilen aus der Datenbank holen, in JavaScript
 * bewerten, die besten acht behalten. Das ist ein voller Tabellendurchlauf pro
 * Nachricht — und er wird teurer, je mehr Lukas sich merkt. Also genau
 * andersherum als es sein sollte.
 *
 * Die Struktur fuer den gezielten Weg liegt laengst da: `claims` bilden
 * Subjekt -> Praedikat -> Wert, und `upsertClaim` normalisiert das Subjekt
 * ("Hareb Digital" -> "hareb_digital"). Das ist ein stabiler Entitaetsschluessel.
 * gehirn.ts baut daraus bereits einen Knoten-Kanten-Graphen — aber nur als
 * Momentaufnahme zum Ansehen, nicht als etwas, das man abfragen kann.
 *
 * Hier wird derselbe Graph abfragbar: Einstiegsknoten aus der Frage bestimmen,
 * von dort ein bis zwei Schritte weit gehen, fertig. Zwei indizierte Abfragen
 * statt eines Tabellendurchlaufs.
 *
 * Wichtig fuer die Richtung: eine Kante kann auf beiden Seiten stehen.
 * "hareb_digital gegruendet_von issa" und "issa gruendete hareb_digital" sind
 * derselbe Zusammenhang. Deshalb wird nicht nur ueber `subject` gesucht,
 * sondern auch ueber `value` — sonst findet Lukas die halbe Nachbarschaft nicht.
 */
import { db } from "@workspace/db";
import { claimsTable, memoriesTable, episodesTable, type Claim } from "@workspace/db";
import { desc, inArray, or, sql } from "drizzle-orm";
import { logger } from "./logger";

/** Dieselbe Normalisierung wie in memory-writer.ts — Schluessel muessen passen. */
export function normEntitaet(s: string): string {
  return projektSchluessel(s);
}

/*
 * Woerter, die als Einstiegsknoten nichts taugen. Ohne diese Liste wird bei
 * "mein Unternehmen Hareb Digital" auch "mein" und "unternehmen" zum
 * Einstieg — und dann haengt an einem Allerweltswort die halbe Datenbank.
 */
const STOPP = new Set([
  "und", "oder", "aber", "der", "die", "das", "den", "dem", "des", "ein", "eine",
  "einen", "einem", "eines", "ich", "du", "er", "sie", "es", "wir", "ihr", "mein",
  "meine", "meinen", "dein", "deine", "was", "wer", "wie", "wo", "wann", "warum",
  "ist", "sind", "war", "waren", "hat", "habe", "haben", "kann", "kannst", "soll",
  "mit", "von", "fuer", "für", "auf", "aus", "bei", "nach", "über", "unter", "zum",
  "zur", "noch", "auch", "mal", "bitte", "sag", "sage", "erzähl", "erzaehl", "weißt",
  "weisst", "kennst", "thema", "sachen", "dinge", "etwas", "alles", "nichts",
]);

/**
 * Kandidaten fuer Einstiegsknoten aus einer Frage.
 *
 * Es werden Wortfolgen bis Laenge 3 gebildet, laengste zuerst: "Hareb Digital"
 * soll VOR "hareb" treffen, sonst landet man auf einem allgemeineren Knoten
 * als noetig und schleppt dessen ganze Nachbarschaft mit.
 */
export function entitaetskandidaten(frage: string, maximal = 12): string[] {
  const woerter = frage
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((w) => w.trim())
    .filter(Boolean);

  const kandidaten: string[] = projekteImText(frage).map(p => p.id);
  for (const laenge of [3, 2, 1]) {
    for (let i = 0; i + laenge <= woerter.length; i++) {
      const teil = woerter.slice(i, i + laenge);
      // Eine Wortfolge, die nur aus Allerweltswoertern besteht, bringt nichts.
      if (teil.every((w) => STOPP.has(w) || w.length <= 2)) continue;
      // Einzelwoerter muessen fuer sich tragen; in Folgen darf ein kurzes Wort stehen.
      if (laenge === 1 && (STOPP.has(teil[0]) || teil[0].length <= 3)) continue;
      const key = normEntitaet(teil.join(" "));
      if (key && !kandidaten.includes(key)) kandidaten.push(key);
    }
  }
  return kandidaten.slice(0, maximal);
}

export type GraphKante = {
  von: string;
  praedikat: string;
  nach: string;
  claim: Claim;
  /** Schritt 1 = direkt am Einstieg, 2 = ein Knoten weiter. */
  schritt: number;
};

export type Nachbarschaft = {
  einstieg: string[];
  kanten: GraphKante[];
  /** Alle beruehrten Entitaeten, Einstieg eingeschlossen. */
  knoten: string[];
  episodenIds: number[];
};

/**
 * Von den Einstiegsknoten aus durch die Claims laufen.
 *
 * Reine Funktion ueber bereits geladene Zeilen: dadurch laesst sich das
 * Laufverhalten ohne Datenbank pruefen (siehe scripts/check-memory-graph.mjs).
 */
export function laufeGraph(
  einstieg: string[],
  claims: Claim[],
  tiefe = 2,
  maxKanten = 24,
): Nachbarschaft {
  const besucht = new Set(einstieg);
  const kanten: GraphKante[] = [];
  const episodenIds = new Set<number>();

  let front = [...einstieg];

  for (let schritt = 1; schritt <= tiefe && front.length > 0 && kanten.length < maxKanten; schritt++) {
    const naechsteFront: string[] = [];
    const aktuell = new Set(front);

    for (const c of claims) {
      if (kanten.length >= maxKanten) break;

      const subjekt = normEntitaet(c.subject);
      const wert = normEntitaet(c.value);

      // Kante zaehlt, wenn EINE der beiden Seiten an der aktuellen Front liegt.
      const trifftSubjekt = aktuell.has(subjekt);
      const trifftWert = aktuell.has(wert);
      if (!trifftSubjekt && !trifftWert) continue;

      // Dieselbe Aussage nicht zweimal aufnehmen, wenn beide Seiten passen.
      if (kanten.some((k) => k.claim.id === c.id)) continue;

      kanten.push({ von: subjekt, praedikat: c.predicate, nach: wert, claim: c, schritt });
      if (c.episodeId) episodenIds.add(c.episodeId);

      // Die jeweils andere Seite ist der naechste Knoten.
      const gegenueber = trifftSubjekt ? wert : subjekt;
      if (gegenueber && !besucht.has(gegenueber)) {
        besucht.add(gegenueber);
        naechsteFront.push(gegenueber);
      }
    }

    front = naechsteFront;
  }

  return {
    einstieg,
    kanten,
    knoten: [...besucht],
    episodenIds: [...episodenIds],
  };
}

/*
 * Dieselbe Normalisierung wie normEntitaet(), aber in SQL — damit die
 * Wert-Seite einer Kante direkt in der Datenbank verglichen werden kann und
 * nicht erst alle Claims nach Node wandern muessen.
 */
const wertSchluessel = sql<string>`lower(regexp_replace(btrim(${claimsTable.value}), '\\s+', '_', 'g'))`;

/** Claims, die mit einer der gesuchten Entitaeten zu tun haben — auf beiden Seiten. */
async function claimsUm(schluessel: string[], grenze: number): Promise<Claim[]> {
  if (schluessel.length === 0) return [];
  schluessel = aliasSchluessel(schluessel);
  return db
    .select()
    .from(claimsTable)
    .where(or(inArray(claimsTable.subject, schluessel), inArray(wertSchluessel, schluessel)))
    .orderBy(desc(claimsTable.confidence), desc(claimsTable.observedAt))
    .limit(grenze);
}

/**
 * Welche der Kandidaten sind ueberhaupt Knoten im Graphen?
 *
 * Bewusst nur exakte Treffer auf dem normalisierten Schluessel. Ein ILIKE
 * "%hareb%" wuerde auch "harebrained" fangen und den Einstieg verwaessern —
 * und der ganze Sinn der Uebung ist, GENAU zu treffen.
 */
export async function einstiegsknoten(frage: string): Promise<string[]> {
  const kandidaten = entitaetskandidaten(frage);
  if (kandidaten.length === 0) return [];

  /*
   * EINE Abfrage, die beide Seiten einer Aussage zurueckgibt.
   *
   * Naheliegend waere, erst ueber die Subjekte zu suchen und die Wertseite
   * danach je Kandidat nachzuschlagen. Das waeren bei zwoelf Kandidaten zwoelf
   * Roundtrips nacheinander — und damit waere der Vorteil des gezielten
   * Einstiegs wieder aufgebraucht, bevor der erste Schritt im Graphen getan ist.
   */
  const treffer = await db
    .selectDistinct({ subjekt: claimsTable.subject, wert: wertSchluessel })
    .from(claimsTable)
    .where(or(inArray(claimsTable.subject, aliasSchluessel(kandidaten)), inArray(wertSchluessel, aliasSchluessel(kandidaten))));

  const vorhanden = new Set<string>();
  for (const t of treffer) {
    vorhanden.add(normEntitaet(t.subjekt));
    if (t.wert) vorhanden.add(normEntitaet(String(t.wert)));
  }

  // Reihenfolge der Kandidaten beibehalten: laengste Wortfolge zuerst.
  return kandidaten.filter((k) => vorhanden.has(k)).slice(0, 4);
}

export type GraphTreffer = { text: string; score: number; claimId: number };

/**
 * Nachbarschaft einer Frage als fertige Treffer.
 *
 * Zwei Runden statt eines Tabellendurchlaufs: erst die Claims am Einstieg,
 * dann die der dabei gefundenen Nachbarn. Beides ueber indizierte Spalten.
 */
export async function graphTreffer(
  frage: string,
  grenze = 8,
): Promise<{ treffer: GraphTreffer[]; einstieg: string[]; knoten: string[]; episodenIds: number[] }> {
  try {
    const einstieg = await einstiegsknoten(frage);
    if (einstieg.length === 0) return { treffer: [], einstieg: [], knoten: [], episodenIds: [] };

    // Runde 1: direkte Nachbarschaft.
    const runde1 = await claimsUm(einstieg, 60);
    const nah = laufeGraph(einstieg, runde1, 1, 40);

    // Runde 2: die dabei entdeckten Knoten, ohne die Einstiege erneut zu laden.
    const neueKnoten = nah.knoten.filter((k) => !einstieg.includes(k)).slice(0, 8);
    const runde2 = neueKnoten.length > 0 ? await claimsUm(neueKnoten, 40) : [];

    const alle = [...runde1, ...runde2];
    const nachbarschaft = laufeGraph(einstieg, alle, 2, 24);

    const treffer: GraphTreffer[] = nachbarschaft.kanten.map((k) => {
      const c = k.claim;
      const richtung = k.schritt === 1 ? "" : ` (über ${k.von})`;
      const status =
        c.status === "verified" ? "verifiziert"
        : c.status === "corroborated" ? "mehrfach gestützt"
        : c.status === "contradicted" ? "WIDERSPRÜCHLICH"
        : c.status === "retracted" ? "zurückgezogen"
        : "unbelegt";
      return {
        claimId: c.id,
        text:
          `[Graph${richtung}] ${c.subject.replace(/_/g, " ")} → ` +
          `${c.predicate.replace(/_/g, " ")}: "${c.value}" ` +
          `(${status}, Vertrauen ${(c.confidence * 100).toFixed(0)}%)`,
        // Schritt 1 zaehlt voll, Schritt 2 nur noch halb — Naehe schlaegt Ferne.
        score: c.confidence * (k.schritt === 1 ? 1 : 0.5) * (c.status === "retracted" ? 0.2 : 1),
      };
    });

    treffer.sort((a, b) => b.score - a.score);
    logger.info(
      { einstieg, kanten: nachbarschaft.kanten.length, geladen: alle.length },
      "Graph-Retrieval",
    );
    return {
      treffer: treffer.slice(0, grenze),
      einstieg,
      knoten: nachbarschaft.knoten,
      episodenIds: nachbarschaft.episodenIds,
    };
  } catch (err) {
    // Faellt der Graph aus, bleibt die bewertete Suche als Weg uebrig.
    logger.warn({ err }, "Graph-Retrieval fehlgeschlagen — nutze nur die bewertete Suche");
    return { treffer: [], einstieg: [], knoten: [], episodenIds: [] };
  }
}

/** Erinnerungen, die an einer der gefundenen Entitaeten haengen. */
export async function erinnerungenZuKnoten(knoten: string[], grenze = 5) {
  if (knoten.length === 0) return [];
  try {
    // Zwei Wege zur selben Entitaet: als Tag gesetzt oder im Text genannt.
    const bedingungen = aliasSchluessel(knoten).flatMap((k) => {
      const klartext = k.replace(/_/g, " ");
      return [
        sql`${memoriesTable.tags} @> ${JSON.stringify([k])}::jsonb`,
        sql`${memoriesTable.tags} @> ${JSON.stringify([klartext])}::jsonb`,
        sql`lower(${memoriesTable.content}) like ${"%" + klartext + "%"}`,
      ];
    });
    return await db
      .select()
      .from(memoriesTable)
      .where(or(...bedingungen))
      .orderBy(desc(memoriesTable.importance), desc(memoriesTable.createdAt))
      .limit(grenze);
  } catch (err) {
    logger.warn({ err }, "Erinnerungen zu Graph-Knoten fehlgeschlagen");
    return [];
  }
}

/** Episoden, aus denen die gefundenen Aussagen stammen. */
export async function episodenZuIds(ids: number[], grenze = 3) {
  if (ids.length === 0) return [];
  try {
    return await db
      .select()
      .from(episodesTable)
      .where(inArray(episodesTable.id, ids.slice(0, grenze)))
      .orderBy(desc(episodesTable.startedAt))
      .limit(grenze);
  } catch (err) {
    logger.warn({ err }, "Episoden zu Graph-Knoten fehlgeschlagen");
    return [];
  }
}
