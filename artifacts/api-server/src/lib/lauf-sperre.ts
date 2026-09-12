/*
 * Eine Sperre, die verhindert, dass derselbe Hintergrundlauf zweimal
 * gleichzeitig laeuft.
 *
 * Das Problem ist konkret, nicht theoretisch. Seit die feste Rundenzahl weg
 * ist, darf ein Zug bis zu 25 Minuten arbeiten (LUKAS_TURN_MAX_MINUTEN) — und
 * die Uhr laeuft erst ab dem ersten Modellaufruf, nicht ab dem Zyklusbeginn.
 * Steht der Takt eng, ueberholt ein Lauf, der in eine langsame Antwort
 * geraet, seinen eigenen Zyklus. Dann arbeiten zwei Laeufe an denselben
 * Zielen, oeffnen zwei Episoden, verbrauchen doppelt Tokens und schreiben
 * sich gegenseitig den Fortschritt um.
 *
 * Der Abstand ist derzeit weit genug, dass das aus dem Takt allein nicht mehr
 * folgt (LUKAS_AUTONOMY_INTERVAL_MIN). Das entwertet die Sperre nicht: der
 * Takt ist eine Einstellung, und die beiden Faelle unten haengen gar nicht an
 * ihm.
 *
 * WARUM NICHT EINFACH EIN FLAG IM PROZESS. Ein `let laeuft = false` deckt den
 * haeufigsten Fall ab und genau den nicht, der weh tut: waehrend eines
 * Deployments laufen kurzzeitig zwei Instanzen (die alte raeumt noch auf, die
 * neue startet schon), und jede haette ihr eigenes Flag. Dasselbe, sobald
 * jemand die Instanzzahl auf zwei stellt.
 *
 * WARUM NICHT EINE ZEILE IN EINER TABELLE. Weil sie haengenbleibt. Wird der
 * Prozess mitten im Lauf abgeschossen — bei Railway passiert genau das bei
 * jedem Deployment —, steht "laeuft" in der Tabelle und niemand raeumt es weg;
 * ab dann laeuft die Autonomie nie wieder an, und zwar lautlos. Ein Advisory
 * Lock haengt an der Datenbank-VERBINDUNG: faellt der Prozess, faellt die
 * Verbindung, und Postgres gibt die Sperre von selbst frei.
 *
 * Eigene Verbindung, nicht die aus dem Pool: die Sperre wird bis zu 25 Minuten
 * gehalten. Aus dem gemeinsamen Pool waere das eine Verbindung weniger fuer
 * Issas Chat — vier solche Laeufe, und der Pool ist halb blockiert, waehrend
 * im Dashboard nichts mehr geht.
 */
import pg from "pg";
import { logger } from "./logger";

/*
 * Feste Zahlen statt Namen: Advisory Locks kennen nur Zahlen. Sie sind
 * beliebig, muessen aber ueber Deployments hinweg STABIL bleiben — zwei
 * Versionen mit unterschiedlichen Zahlen wuerden sich nicht sehen.
 */
export const SPERREN = {
  autonomie: 815_001,
  moltbook: 815_002,
  konsolidierung: 815_003,
  selbstheilung: 815_004,
} as const;

export type SperrName = keyof typeof SPERREN;

/**
 * Fuehrt `arbeit` aus, wenn die Sperre frei ist. Laeuft der Vorgang anderswo
 * schon, passiert NICHTS und es kommt `null` zurueck — der ausgelassene Takt
 * ist kein Fehler, sondern der Zweck.
 *
 * Ist die Datenbank nicht erreichbar, wird ebenfalls ausgelassen. Ein
 * Hintergrundlauf, der ohne Datenbank startet, koennte weder Ziele lesen noch
 * sein Ergebnis ablegen; ihn trotzdem loszuschicken hiesse, Tokens fuer ein
 * Ergebnis auszugeben, das nirgends ankommt.
 */
export async function mitSperre<T>(name: SperrName, arbeit: () => Promise<T>): Promise<T | null> {
  const schluessel = SPERREN[name];
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    // Ohne das laeuft die Verbindung bei manchen Anbietern in einen
    // stillen Timeout und die Sperre waere weg, waehrend der Lauf weiterlaeuft.
    keepAlive: true,
  });

  try {
    await client.connect();
  } catch (err) {
    logger.warn({ err, sperre: name }, "Sperre: keine Datenbankverbindung — Lauf ausgelassen");
    await client.end().catch(() => {});
    return null;
  }

  let gehalten = false;
  try {
    const { rows } = await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS ok",
      [schluessel],
    );
    gehalten = rows[0]?.ok === true;
    if (!gehalten) {
      logger.info({ sperre: name }, "Läuft bereits — dieser Takt wird ausgelassen");
      return null;
    }
    return await arbeit();
  } finally {
    if (gehalten) {
      await client.query("SELECT pg_advisory_unlock($1)", [schluessel]).catch(() => {});
    }
    // Auch wenn das Entsperren scheitert: mit der Verbindung faellt die Sperre.
    await client.end().catch(() => {});
  }
}
