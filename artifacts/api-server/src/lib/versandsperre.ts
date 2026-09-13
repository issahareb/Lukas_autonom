/*
 * Dieselbe Aktion mit Aussenwirkung nicht zweimal ausfuehren.
 *
 * DER ABLAUF, gegen den das steht: die Mail geht raus, danach bricht die
 * Verbindung weg, der Werkzeugaufruf sieht aus wie gescheitert, der Agent
 * versucht es erneut. Der Empfaenger bekommt sie doppelt — und zurueckholen
 * laesst sich nichts.
 *
 * DER MECHANISMUS ist der eindeutige Index, nicht eine Abfrage. Der
 * Einfuegeversuch IST die Reservierung: zwei gleichzeitige Zuege koennen
 * nicht beide gewinnen, einer bekommt den Konfliktfehler. Ein "erst
 * nachsehen, dann schreiben" haette genau dieses Rennen verloren — und
 * gleichzeitige Aufrufe sind bei einem Agenten der Normalfall, nicht der
 * Sonderfall.
 *
 * DAS FENSTER ist die eigentliche Abwaegung. Zu kurz und der Schutz greift
 * nicht; zu lang und dieselbe Mail laesst sich am selben Tag nicht zweimal
 * schicken, obwohl das gewollt sein kann. Zehn Minuten decken jeden
 * Wiederholungsversuch ab, den ein Zug erzeugt.
 *
 * UND DAS FENSTER MUSS AUCH WIRKLICH ABLAUFEN. Genau hier steckte ein
 * Fehler, und zwar ein stiller: der eindeutige Index geht ueber (art,
 * fingerabdruck) — OHNE Zeit. Der Lesepfad beachtete das Fenster, der
 * Schreibpfad konnte danach aber nie wieder einfuegen: der Index verbot es,
 * der Konfliktzweig griff, und heraus kam "schon erledigt" mit LEEREM
 * Ergebnis. Die Sperre galt damit nicht zehn Minuten, sondern fuer immer.
 * Dieselbe Mail zwanzig Minuten spaeter ging nie raus, und Lukas bekam
 * gemeldet, sie sei schon unterwegs.
 *
 * Der Ausweg ist nicht, die Zeit in den Index zu nehmen — dann gaebe es
 * Fensterkanten, an denen zwei Versuche eine Sekunde auseinander in
 * verschiedene Faecher fallen und der Schutz gar nicht greift. Der Ausweg
 * ist, den abgelaufenen Eintrag im Konfliktfall zu UEBERNEHMEN, und zwar
 * mit einem bedingten UPDATE. Das UPDATE ist dann der Wettlauf-Entscheider,
 * genau wie vorher der INSERT: nur einer bekommt die Zeile zurueck.
 *
 * WOFUER NICHT: SMS. Dort steckt derselbe Schutz bereits in der
 * Nachrichtentabelle, weil jede Zeile ohnehin vor dem Versand entsteht. Das
 * darauf umzubauen haette einen geprueften Pfad angefasst, ohne etwas zu
 * gewinnen.
 */
import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { versandTable } from "@workspace/db";
import { and, eq, gte, lt } from "drizzle-orm";
import { logger } from "./logger";

const FENSTER_MS = Number(process.env.LUKAS_VERSAND_FENSTER_MS ?? 10 * 60 * 1000);

/*
 * Postgres meldet einen Verstoss gegen einen eindeutigen Index als SQLSTATE
 * 23505. Daran — und nur daran — wird der Konfliktfall erkannt. Auf den Text
 * der Meldung zu schauen waere von der Sprache der Datenbank abhaengig.
 */
function istEindeutigkeitskonflikt(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "23505";
}

export function fingerabdruck(...teile: unknown[]): string {
  return createHash("sha256").update(teile.map(String).join(" ")).digest("hex").slice(0, 32);
}

export type VersandErgebnis<T> = { wiederholung: boolean; ergebnis: T | string };

/**
 * Fuehrt `arbeit` genau einmal je Fingerabdruck und Zeitfenster aus.
 *
 * Bei einer Wiederholung kommt zurueck, was beim ersten Mal herauskam — und
 * zwar mit `wiederholung: true`, damit der Aufrufer es benennen kann. Ein
 * stilles "hat geklappt" waere schlechter: Lukas wuerde denken, er habe
 * gerade etwas getan, das in Wahrheit schon vor Minuten passiert ist.
 */
export async function nurEinmal<T>(
  art: string,
  schluessel: string,
  arbeit: () => Promise<T>,
): Promise<VersandErgebnis<T>> {
  const seit = new Date(Date.now() - FENSTER_MS);

  // Gab es das eben schon?
  try {
    const [vorhanden] = await db
      .select()
      .from(versandTable)
      .where(
        and(
          eq(versandTable.art, art),
          eq(versandTable.fingerabdruck, schluessel),
          gte(versandTable.createdAt, seit),
        ),
      )
      .limit(1);

    if (vorhanden) {
      logger.info({ art, schluessel }, "Dieselbe Aktion lief vor Kurzem schon — nicht wiederholt");
      return { wiederholung: true, ergebnis: vorhanden.ergebnis };
    }
  } catch (err) {
    /*
     * Ohne Datenbank wird AUSGEFUEHRT, nicht blockiert.
     *
     * Die Abwaegung: eine doppelte Mail ist aergerlich, eine Mail, die wegen
     * einer Datenbankstoerung gar nicht rausgeht, obwohl Issa sie freigegeben
     * hat, ist schlimmer. Der Schutz ist eine Verbesserung, keine Bedingung.
     */
    logger.warn({ err, art }, "Versandsperre nicht lesbar — Aktion läuft ohne sie");
    return { wiederholung: false, ergebnis: await arbeit() };
  }

  /*
   * Reservieren, BEVOR gearbeitet wird. Faellt der Prozess mitten im Versand,
   * steht die Zeile trotzdem — und der naechste Versuch schickt nicht noch
   * einmal. Lieber eine Mail, die vielleicht nicht ankam, als zwei, die
   * ankamen.
   */
  try {
    await db
      .insert(versandTable)
      .values({ art, fingerabdruck: schluessel, ergebnis: "", erledigt: false });
  } catch (err) {
    /*
     * NUR ein echter Eindeutigkeitskonflikt zaehlt hier als "ein anderer war
     * schneller". Vorher fing dieser Zweig JEDEN Fehler — eine abgerissene
     * Verbindung ging damit als "schon erledigt" durch und verschluckte die
     * Mail stillschweigend. Das widerspricht der Regel ein paar Zeilen
     * weiter oben: ohne Datenbank wird AUSGEFUEHRT, nicht blockiert.
     */
    if (!istEindeutigkeitskonflikt(err)) {
      logger.warn({ err, art }, "Versandsperre nicht schreibbar — Aktion läuft ohne sie");
      return { wiederholung: false, ergebnis: await arbeit() };
    }

    /*
     * Es gibt eine Zeile. Zwei Faelle, und sie sind nicht dasselbe:
     *
     *   frisch     — ein anderer Zug ist gerade dran oder war eben fertig.
     *                Nicht wiederholen.
     *   abgelaufen — das Fenster ist vorbei. Die Zeile darf uebernommen
     *                werden; genau dafuer gibt es das Fenster.
     *
     * Das UPDATE ist bedingt und atomar: `created_at < seit` im WHERE. Zwei
     * gleichzeitige Zuege koennen nicht beide eine Zeile zurueckbekommen —
     * der Zweite sieht ein leeres Ergebnis und weiss damit, dass er verloren
     * hat. Damit bleibt der Wettlauf so sicher wie vorher beim INSERT.
     */
    const uebernommen = await db
      .update(versandTable)
      .set({ ergebnis: "", erledigt: false, createdAt: new Date() })
      .where(
        and(
          eq(versandTable.art, art),
          eq(versandTable.fingerabdruck, schluessel),
          lt(versandTable.createdAt, seit),
        ),
      )
      .returning({ id: versandTable.id })
      .catch((fehler: unknown) => {
        logger.warn({ err: fehler, art }, "Abgelaufene Sperre nicht übernehmbar");
        return [] as { id: number }[];
      });

    if (uebernommen.length === 0) {
      logger.info({ art, schluessel }, "Ein gleichzeitiger Aufruf war schneller — nicht wiederholt");
      /*
       * Was beim ersten Mal herauskam, sofern es schon feststeht. Vorher
       * stand hier hart `""` — Lukas bekam dann ein leeres Ergebnis
       * gemeldet, obwohl die Mail nachweislich raus war.
       */
      const [bestehend] = await db
        .select()
        .from(versandTable)
        .where(and(eq(versandTable.art, art), eq(versandTable.fingerabdruck, schluessel)))
        .limit(1)
        .catch(() => []);
      return { wiederholung: true, ergebnis: bestehend?.ergebnis ?? "" };
    }

    logger.info(
      { art, schluessel },
      "Die Sperre war abgelaufen — dieselbe Aktion darf wieder laufen",
    );
  }

  const ergebnis = await arbeit();

  await db
    .update(versandTable)
    .set({ ergebnis: typeof ergebnis === "string" ? ergebnis.slice(0, 2000) : "", erledigt: true })
    .where(and(eq(versandTable.art, art), eq(versandTable.fingerabdruck, schluessel)))
    .catch(() => {});

  return { wiederholung: false, ergebnis };
}
