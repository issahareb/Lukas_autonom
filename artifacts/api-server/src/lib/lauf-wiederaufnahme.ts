import { db } from "@workspace/db";
import { episodesTable } from "@workspace/db";
import { and, eq, isNull, lt } from "drizzle-orm";
import { logger } from "./logger";

/*
 * Was passiert, wenn Lukas mitten in der Arbeit abgeschnitten wird.
 *
 * DER FALL, und er ist der Normalfall, nicht der Sonderfall: ein autonomer
 * Lauf dauert bis zu fuenfundzwanzig Minuten. Railway startet bei jedem
 * Deploy neu. Faellt der Prozess in dieser Zeit — Deploy, Absturz, ein
 * Speicherlimit —, dann war der Lauf einfach weg. Zwei Folgen, beide still:
 *
 *   1. Die Episode blieb FUER IMMER offen. `endedAt` bleibt NULL, niemand
 *      raeumt sie, und das Gedaechtnis sammelt Halbsaetze ohne Abschluss.
 *   2. Lukas erfuhr nichts davon. Drei Minuten nach dem Start fing er neu an,
 *      ohne zu wissen, dass der letzte Lauf mittendrin abgerissen ist. Hatte
 *      der schon eine Mail geschickt, einen Befehl abgesetzt, eine Datei
 *      geschrieben — er wusste es nicht und konnte es wiederholen.
 *
 * WAS HIER NICHT STEHT, und warum nicht. Kein Wiederaufsetzen an der
 * abgebrochenen Stelle. Ein Agentenzug ist kein Ablauf mit nummerierten
 * Schritten, den man an Schritt sieben fortsetzt: er ist ein Gespraech mit
 * einem Modell, und die halbe Antwort von vorhin ist keine Stelle, an die
 * man zurueckkehrt. Eine Zustandsmaschine daraufzusetzen waere eine Zusage,
 * die nicht einloesbar ist.
 *
 * WAS STATTDESSEN HIER STEHT — und es ist das, was wirklich fehlte:
 *
 *   Beim Start wird nachgesehen, ob ein Lauf abgerissen ist. Er wird
 *   ordentlich abgeschlossen (mit dem Vermerk, DASS er abriss, nicht mit
 *   einer erfundenen Zusammenfassung), und die Tatsache geht in den
 *   naechsten Auftrag. Lukas setzt dann selbst fort — nachsehen, was von
 *   seiner Arbeit schon steht, und von dort weitermachen. Genau das ist
 *   seine Aufgabe, und er kann es besser als jede Zustandsmaschine.
 *
 * DIE ABGRENZUNG gegen einen Lauf, der GERADE laeuft, hat zwei Riegel:
 *
 *   - Aufgerufen wird unter derselben Sperre wie der Lauf selbst
 *     (mitSperre("autonomie")). Solange irgendwo ein Lauf arbeitet, kommt
 *     das hier gar nicht dran.
 *   - Und zusaetzlich eine Altersgrenze. Ohne sie wuerde bei einem zweiten
 *     Prozess — waehrend eines Deploys laeuft der alte kurz weiter — die
 *     laufende Episode des anderen abgeschlossen, waehrend dieser noch
 *     schreibt. Ein Riegel allein reicht hier nicht.
 */

/** Laenger als das darf kein Lauf dauern; was aelter ist, ist abgerissen. */
const HOECHSTDAUER_MS = Number(process.env.LUKAS_LAUF_HOECHSTDAUER_MIN ?? 30) * 60 * 1000;

export type AbgebrochenerLauf = {
  id: number;
  begonnen: Date;
  /** Wie lange er lief, bevor er abriss — in ganzen Minuten. */
  minuten: number;
};

/**
 * Schliesst abgerissene Laeufe ab und gibt zurueck, welche es waren.
 *
 * Gibt eine leere Liste zurueck, wenn nichts offen war — und auch dann, wenn
 * die Datenbank nicht erreichbar ist. Das ist Absicht: eine unerreichbare
 * Datenbank darf den Start nicht verhindern. Der naechste Lauf holt es nach.
 */
export async function abgerisseneLaeufeAbschliessen(): Promise<AbgebrochenerLauf[]> {
  const grenze = new Date(Date.now() - HOECHSTDAUER_MS);

  try {
    const offen = await db
      .select()
      .from(episodesTable)
      .where(
        and(
          eq(episodesTable.kind, "autonomer_lauf"),
          isNull(episodesTable.endedAt),
          lt(episodesTable.startedAt, grenze),
        ),
      );

    if (offen.length === 0) return [];

    const abgebrochen: AbgebrochenerLauf[] = [];
    for (const e of offen) {
      const minuten = Math.round((Date.now() - e.startedAt.getTime()) / 60000);
      /*
       * Der Vermerk sagt, was WIRKLICH bekannt ist: dass der Lauf begann und
       * nie endete. Nicht mehr. Eine erfundene Zusammenfassung ("Lauf ohne
       * Ergebnis") waere hier eine Luege — es KANN ein Ergebnis gegeben
       * haben, es steht nur nirgends.
       */
      await db
        .update(episodesTable)
        .set({
          endedAt: new Date(),
          summary:
            `Abgebrochen: der Server wurde nach ${minuten} Minuten neu gestartet. ` +
            `Was dieser Lauf bereits getan hat, steht nirgends — es muss nachgesehen werden.`,
        })
        .where(eq(episodesTable.id, e.id));
      abgebrochen.push({ id: e.id, begonnen: e.startedAt, minuten });
    }

    logger.warn(
      { anzahl: abgebrochen.length, ids: abgebrochen.map((a) => a.id) },
      "Abgerissene autonome Läufe gefunden und abgeschlossen",
    );
    return abgebrochen;
  } catch (err) {
    // Kein Abbruch: der Start darf daran nicht scheitern.
    logger.warn({ err }, "Abgerissene Läufe nicht prüfbar — übersprungen");
    return [];
  }
}

/**
 * Der Satz, der in den naechsten Auftrag geht.
 *
 * Bewusst als Warnung formuliert und nicht als Aufgabe: Lukas soll NACHSEHEN,
 * bevor er etwas wiederholt. Eine Mail zweimal zu schicken ist schlimmer, als
 * sie einmal zu spaet zu schicken — und die Versandsperre deckt nur zehn
 * Minuten ab, ein Neustart kann laenger her sein.
 */
export function unterbrechungsHinweis(abgebrochen: AbgebrochenerLauf[]): string | null {
  if (abgebrochen.length === 0) return null;

  const wann = abgebrochen
    .map((a) => `${a.begonnen.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} (lief ${a.minuten} Min.)`)
    .join(", ");

  return (
    `ACHTUNG — unterbrochene Arbeit.\n` +
    `${abgebrochen.length === 1 ? "Ein früherer Lauf wurde" : `${abgebrochen.length} frühere Läufe wurden`} ` +
    `durch einen Neustart abgeschnitten: ${wann}.\n` +
    `Was dabei schon passiert ist, steht nirgends. Bevor du etwas davon wiederholst:\n` +
    `  1. Sieh nach, was tatsächlich schon getan wurde — im Ziel-Fortschritt, im Tagebuch, ` +
    `an der Sache selbst (Datei, Repository, Postfach).\n` +
    `  2. Wiederhole NICHTS mit Außenwirkung blind. Eine Mail, ein Befehl, ein Kauf zweimal ` +
    `ist schlimmer als einmal zu spät.\n` +
    `  3. Steht der Fortschritt nicht im Ziel, trag ihn nach — damit der nächste Abriss ` +
    `weniger kostet.`
  );
}
