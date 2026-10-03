/*
 * Sauber aufhoeren.
 *
 * Bisher gab es das nicht. Railway schickt bei JEDEM Deployment ein SIGTERM
 * und kurz darauf ein SIGKILL — und Node beendet sich bei SIGTERM sofort, ohne
 * irgendetwas zu Ende zu bringen. Was dabei mitten im Satz abgeschnitten wird:
 *
 *  - Eine laufende Chat-Antwort. Der Browser haengt an einer SSE-Leitung, die
 *    ohne ein Wort verstummt; im Dashboard steht die Frage ohne Antwort da.
 *  - Ein Datenbankschreibvorgang. Die Episode bleibt offen, die Nachricht
 *    ungespeichert.
 *  - Ein Werkzeugaufruf, der gerade Geld kostet. Die Antwort des Modells
 *    kommt an, wenn niemand mehr da ist, sie zu lesen — bezahlt ist sie
 *    trotzdem.
 *
 * Der Ablauf hier ist die uebliche Reihenfolge, und die Reihenfolge ist der
 * ganze Punkt:
 *
 *  1. GESUNDHEIT ABMELDEN. Ab sofort meldet /healthz 503. Wer davor eine
 *     Weiche stehen hat, schickt keine neuen Anfragen mehr her — bevor wir
 *     ueberhaupt anfangen, etwas abzubauen.
 *  2. TAKTGEBER AUS. Kein neuer autonomer Lauf, kein neuer Moltbook-Zyklus.
 *     Einen neuen 25-Minuten-Lauf zu starten, waehrend wir in zehn Sekunden
 *     tot sind, waere reine Geldverbrennung.
 *  3. KEINE NEUEN VERBINDUNGEN. server.close() nimmt nichts Neues mehr an,
 *     laesst aber Laufendes zu Ende laufen.
 *  4. WARTEN — mit Frist. Wer bis dahin fertig wird, wird fertig. Die Frist
 *     liegt unter dem, was der Betreiber gewaehrt (Railway: rund 30 Sekunden),
 *     denn ein SIGKILL mitten im Aufraeumen waere schlimmer als ein etwas zu
 *     frueher Schnitt.
 *  5. DATENBANK ZU. Erst zum Schluss: vorher schreibt womoeglich noch jemand.
 *
 * Was hier ABSICHTLICH nicht passiert: auf einen 25-minuetigen autonomen Lauf
 * warten. Das kann niemand gewaehren. Er faellt weg — aber die Sperre aus
 * lauf-sperre.ts haengt an der Datenbankverbindung, faellt also mit dem
 * Prozess. Beim naechsten Takt laeuft er einfach neu an, statt fuer immer
 * blockiert zu sein.
 */
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { logger } from "./logger";

let wirGehen = false;

/** Laeuft gerade ein Herunterfahren? Die Gesundheitsprobe fragt danach. */
export function istImAbschied(): boolean {
  return wirGehen;
}

export function richteAbschiedEin(
  server: Server,
  taktgeberStoppen: () => void | Promise<void>,
): void {
  const frist = Number(process.env.LUKAS_SHUTDOWN_MS ?? 20_000);

  const abschied = (signal: string) => {
    if (wirGehen) {
      // Zweites Signal heisst: es eilt. Dann ohne weiteres Warten.
      logger.warn({ signal }, "Zweites Signal — sofortiges Ende");
      process.exit(0);
    }
    wirGehen = true;
    logger.info({ signal, fristMs: frist }, "Herunterfahren eingeleitet");

    let gestoppt: Promise<void>;
    try {
      gestoppt = Promise.resolve(taktgeberStoppen()).catch((err) => {
        logger.warn({ err }, "Hintergrundverbindungen konnten nicht sauber beendet werden");
      });
    } catch (err) {
      logger.warn({ err }, "Taktgeber konnten nicht sauber beendet werden");
      gestoppt = Promise.resolve();
    }

    /*
     * Die Notbremse zuerst scharf machen, nicht zuletzt. Bleibt eine
     * Keep-Alive-Verbindung haengen, wartet server.close() ewig — und ewig ist
     * hier: bis zum SIGKILL, also genau der harte Abbruch, den wir vermeiden
     * wollten.
     */
    const notaus = setTimeout(() => {
      logger.warn("Frist abgelaufen — verbleibende Verbindungen werden getrennt");
      server.closeAllConnections?.();
      pool.end().catch(() => {});
      process.exit(0);
    }, frist);
    notaus.unref();

    server.close(() => {
      logger.info("Alle Anfragen beendet — Sprachverbindungen werden geschlossen");
      gestoppt
        .then(() => pool.end())
        .catch((err) => logger.warn({ err }, "Pool liess sich nicht sauber schliessen"))
        .finally(() => { clearTimeout(notaus); process.exit(0); });
    });

    /*
     * Verbindungen, die gerade nichts tun, sofort trennen. Ohne das haelt ein
     * einziger Browser mit offenem Keep-Alive den ganzen Abschied auf.
     * Laufende Anfragen — auch die SSE-Leitung eines Chats — bleiben davon
     * unberuehrt.
     */
    server.closeIdleConnections?.();
  };

  process.on("SIGTERM", () => abschied("SIGTERM"));
  process.on("SIGINT", () => abschied("SIGINT"));

  /*
   * Ein Fehler auf einer LEERLAUFENDEN Datenbankverbindung — der Anbieter
   * trennt nachts, ein Netzwerkhickser — kommt als 'error' auf dem Pool an.
   * Ohne Zuhoerer beendet Node den Prozess. Das war eine echte Absturzursache
   * ohne jeden Zusammenhang mit einer Anfrage: der Server war einfach weg, und
   * im Protokoll stand nichts als der Neustart.
   */
  pool.on("error", (err) => {
    logger.warn({ err }, "Fehler auf einer leerlaufenden Datenbankverbindung — Pool ersetzt sie");
  });

  /*
   * Und die beiden Faelle, in denen Node sonst wortlos stirbt. Nicht um
   * weiterzumachen, als waere nichts gewesen — sondern damit im Protokoll
   * steht, WORAN er gestorben ist. Ein Absturz ohne Grund ist nicht zu
   * beheben.
   */
  process.on("unhandledRejection", (grund) => {
    logger.error({ err: grund }, "Unbehandelte Promise-Ablehnung");
  });
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Unbehandelte Ausnahme — Prozess endet");
    // Hier NICHT weiterlaufen: nach einer unbehandelten Ausnahme ist der
    // Zustand des Prozesses unbekannt. Neu starten ist ehrlicher.
    process.exit(1);
  });
}
