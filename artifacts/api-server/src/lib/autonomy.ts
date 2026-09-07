import { db } from "@workspace/db";
import { goalsTable, diaryTable, approvals } from "@workspace/db";
import { eq, desc, and, gt, inArray } from "drizzle-orm";
import { runLukasTurn } from "./lukas-brain";
import { openEpisode, closeEpisode } from "./memory-writer";
import { logger } from "./logger";
import { neueAntworten } from "./melden";
import { anlass, laufNotiert } from "./autonomie-anlass";
import { mitSperre } from "./lauf-sperre";
import { budgetTor } from "./tagesbudget";
import { imZug } from "./zug";

/*
 * Obergrenze fuer einen autonomen Lauf, Mitarbeiter eingerechnet.
 *
 * Grosszuegig gewaehlt: ein Lauf, der wirklich arbeitet, soll sie nicht
 * sehen. Sie faengt den Fall, in dem sich eine Kette aus Helfern gegenseitig
 * beschaeftigt, ohne dass jemand die Summe im Blick hat.
 */
const DECKEL_AUTONOM = Number(process.env.LUKAS_DECKEL_AUTONOM ?? 800_000);
import { kennzahlenHinweis, meldeAuffaelligkeiten } from "./kennzahlen";

/*
 * Lukas arbeitet an Issas Zielen.
 *
 * Bis hierher gab es genau EINEN autonomen Ablauf: alle 45 Minuten Moltbook.
 * Damit war Moltbook nicht das, was Lukas am liebsten tut, sondern das
 * Einzige, was er von sich aus tun KONNTE. Issas berechtigter Einwand: er hat
 * Ziele, ein VPS, Websuche, eine Shell und zwanzig Werkzeuge — es kann nicht
 * sein, dass fuer jede Taetigkeit erst eine eigene Schleife programmiert wird.
 *
 * Deshalb ist hier NICHT "die Recherche-Schleife" oder "die YouTube-Schleife".
 * Hier steht eine einzige Schleife, die die aktiven Ziele liest und Lukas
 * fragen laesst: woran arbeite ich jetzt, und womit? Welche Werkzeuge er dafuer
 * nimmt, entscheidet er selbst — genau wie im Chat.
 *
 * Was das absichtlich NICHT aendert:
 *  - Das Policy-Gate. Autonome Zuege laufen durch dieselbe Pruefung wie alles
 *    andere. Ohne laufenden Nutzerzug greift die Bestaetigung-im-Chat nicht,
 *    also landen R2/R3-Aktionen als Freigabe im Dashboard und warten. Ein
 *    Agent, der nachts allein arbeitet, darf nicht mehr duerfen als einer, dem
 *    Issa zusieht — eher weniger.
 *  - Das Gedaechtnis. Jeder Lauf ist eine Episode; was er findet, legt er
 *    selbst ab.
 */

const CYCLE_MS = Number(process.env.LUKAS_AUTONOMY_INTERVAL_MIN ?? 30) * 60 * 1000;

function enabled(): boolean {
  return (process.env.LUKAS_AUTONOMY_ENABLED ?? "true").trim().toLowerCase() !== "false";
}

/** Was Lukas in diesem Lauf vor sich sieht. */
async function briefing(): Promise<string | null> {
  const goals = await db
    .select()
    .from(goalsTable)
    .where(eq(goalsTable.status, "active"))
    .orderBy(desc(goalsTable.updatedAt))
    .limit(8);

  if (goals.length === 0) return null;

  const list = goals
    .map(
      (g) =>
        `#${g.id} [${g.priority}] ${g.title}\n` +
        `    Worum es geht: ${g.description}\n` +
        `    Stand: ${g.progress}\n` +
        `    Zuletzt bewegt: ${g.updatedAt.toLocaleDateString("de-DE")}`,
    )
    .join("\n\n");

  /*
   * Freigaben.
   *
   * Zwei Faelle, die Lukas beide kennen muss:
   *
   *  wartend  Eine Aktion liegt bei Issa und kommt frueher oder spaeter. Ohne
   *           diesen Hinweis fordert Lukas dieselbe Freigabe im naechsten Lauf
   *           erneut an — oder er bleibt daran haengen, statt weiterzuarbeiten.
   *
   *  erteilt  Und das war eine echte Luecke: eine erteilte Freigabe wurde von
   *           NIEMANDEM aufgegriffen. Sie lag als "allowed" in der Tabelle, bis
   *           Lukas zufaellig denselben Aufruf wiederholte. Issa klickt also
   *           "Erlauben" und nichts passiert. Weil die Freigabe am Hash der
   *           exakten Argumente haengt, genuegt eine identische Wiederholung —
   *           er muss nur wissen, dass sie bereitliegt.
   */
  const jetzt = new Date();
  const offen = await db
    .select()
    .from(approvals)
    .where(and(inArray(approvals.status, ["pending", "allowed"]), gt(approvals.expiresAt, jetzt)))
    .orderBy(desc(approvals.createdAt))
    .limit(10);

  const wartend = offen.filter((a) => a.status === "pending");
  const erteilt = offen.filter((a) => a.status === "allowed");

  const freigaben = [
    erteilt.length
      ? `\n\nISSA HAT FREIGEGEBEN — du kannst das jetzt ausführen:\n` +
        erteilt
          .map((a) => `- ${a.tool}\n  ${a.argumentsPreview.slice(0, 400)}`)
          .join("\n") +
        `\nWiederhol den Aufruf GENAU so, wie du ihn angefordert hast. Änderst du ` +
        `ein Zeichen, passt die Freigabe nicht mehr und du musst neu fragen.`
      : "",
    wartend.length
      ? `\n\nWARTET NOCH BEI ISSA (nicht erneut anfordern, nichts davon ausführen):\n` +
        wartend.map((a) => `- ${a.tool}`).join("\n")
      : "",
  ].join("");

  // Hat Issa auf eine Meldung geantwortet? Das ist der Grund, warum Lukas
  // gewartet hat — es gehoert an den Anfang seines Laufs, nicht ans Ende.
  const antworten = await neueAntworten();

  /*
   * Was heute anders laeuft als sonst.
   *
   * Hier und nicht im allgemeinen Systemprompt: im Chat sitzt Issa davor und
   * sieht das Dashboard. Allein arbeitet Lukas gegen Werkzeuge, die schon den
   * ganzen Tag scheitern koennen, ohne dass es ihm jemand sagt — er wuerde es
   * jedes Mal aufs Neue herausfinden.
   *
   * Das Melden laeuft daneben, nicht davor: es haengt an der Datenbank, und
   * ein autonomer Lauf soll nicht ausfallen, weil eine Ueberwachung klemmt.
   */
  const [kennzahlen] = await Promise.all([
    kennzahlenHinweis(),
    meldeAuffaelligkeiten().catch(() => 0),
  ]);

  const letzte = await db
    .select()
    .from(diaryTable)
    .orderBy(desc(diaryTable.createdAt))
    .limit(3);
  const rueckblick = letzte.length
    ? `\n\nDeine letzten Tagebucheinträge (damit du dich nicht wiederholst):\n` +
      letzte.map((d) => `- ${d.content.slice(0, 300)}`).join("\n")
    : "";

  return `Niemand schaut dir gerade zu. Das hier ist deine eigene Arbeitszeit.

DEINE AKTIVEN ZIELE:

${list}${antworten}${freigaben}${kennzahlen}${rueckblick}

Such dir EIN Ziel aus, das gerade am meisten davon hat, dass du dich damit
beschäftigst — das dringendste, das am längsten liegengebliebene, oder das, wo
dir konkret etwas eingefallen ist. Nimm nicht jedes Mal dasselbe.

Und dann arbeite wirklich daran. Nicht darüber schreiben, sondern es tun:
- Wissen fehlt? web_search und fetch_url. Lies die Quellen, nicht nur die
  Überschriften — bei langen Seiten mit offset weiterblättern.
- Etwas ausprobieren? Du hast eine Shell auf Issas Droplet (execute_command),
  mit Internet und root im Container. Bau es, statt es zu beschreiben.
- Etwas gelernt? save_memory. Nur was du festhältst, hast du beim nächsten Mal
  noch.
- Etwas an deinem eigenen Code entdeckt, das besser sein müsste?
  propose_code_change — Issa entscheidet, du schlägst vor.
- Am Ende update_goal mit dem echten neuen Stand, und write_diary, wenn der
  Lauf etwas wert war.

Wichtig, damit das hier nicht zur Beschäftigungstherapie wird:
- Ein Lauf, in dem du eine Sache RICHTIG vorangebracht hast, ist mehr wert als
  fünf angefangene.
- Wenn dir zu einem Ziel gerade nichts Sinnvolles einfällt, sag das und mach
  nichts. Leerlauf ist besser als Aktionismus.
- Braucht eine Aktion Issas Freigabe, wird sie automatisch angefordert. Das ist
  KEIN Grund aufzuhören: hör nicht auf zu arbeiten, während du wartest. Recherchier
  weiter, bereite den nächsten Schritt vor, oder nimm dir ein anderes Ziel vor.
  Ein Lauf, der nur aus "ich warte auf Freigabe" besteht, ist ein verlorener Lauf.
  Versuch aber nicht, die Freigabe zu umgehen.
- Brauchst du etwas VON ISSA — eine Entscheidung, einen Zugang, ein Passwort,
  eine Antwort, die nur er geben kann — dann sag es ihm: melde_dich_bei_issa.
  Deine Meldung landet im Dashboard unter "Meldungen" und bleibt dort OFFEN,
  bis er geantwortet hat. Er sitzt nicht daneben und
  sieht nicht, dass du feststeckst; wenn du es ihm nicht sagst, erfährt er es
  nicht. Schreib dabei, woran du arbeitest, was ohne ihn nicht weitergeht und
  was du vorschlägst — so kann er in einem Satz antworten. Danach arbeitest du
  an etwas anderem weiter, statt auf die Antwort zu warten.
- Sieh zwischendurch in dein Fehlerprotokoll: read_diagnostics. Dort steht, was
  schiefgegangen ist, nach Häufigkeit zusammengefasst. Was sich dreimal
  wiederholt, ist kein Ausrutscher, sondern ein Fehler im Code.
- Stößt du auf einen Fehler — in deinem Code, in einem Werkzeug, irgendwo im
  System — dann geh ihm nach, statt ihn zu umgehen: fix_error schickt ihn durch
  Fehleranalyst, Entwickler und Prüfer. Fehler zu finden ist Teil deiner Arbeit,
  nicht eine Störung dabei.
- Bist du dir bei einer Idee unsicher, ob sie trägt: ask_subagent mit
  "ideenpruefer". Der kennt deinen Kontext nicht und sucht gezielt nach
  Schwachstellen — genau deshalb findet er, was du im Eigenlauf übersiehst. Vor
  einem Code-Vorschlag lohnt sich derselbe Weg mit "code_reviewer".
- Berichte am Ende in zwei, drei Sätzen, was du getan hast und was dabei
  herauskam. Ehrlich, auch wenn es nichts war.`;
}

export async function runAutonomyCycle(): Promise<void> {
  /*
   * Erst nachsehen, ob es etwas zu tun gibt — das kostet vier kleine Abfragen
   * und kein Token. Ohne diese Frage lief alle 30 Minuten ein voller Lauf,
   * auch wenn sich seit dem letzten nichts geaendert hatte.
   */
  /*
   * Erst das Geld, dann der Anlass.
   *
   * Das Tagesbudget wird VOR allem anderen geprueft: ein Lauf, der ohnehin
   * nicht laufen darf, soll nicht vorher noch Ziele und Tagebuch aus der
   * Datenbank holen. Und die Reihenfolge sagt etwas — die Kostengrenze ist
   * kein Sonderfall am Ende, sondern die erste Frage.
   *
   * Issas eigene Anfragen laufen weiter; gebremst wird genau das, was ohne
   * Aufsicht Geld ausgibt.
   */
  const tor = await budgetTor({ istIssa: false });
  if (!tor.weiter) {
    logger.warn({ grund: tor.grund }, "Autonomie: Tagesbudget erreicht");
    return;
  }

  const grund = await anlass();
  if (!grund.starten) {
    logger.info({ grund: grund.grund }, "Autonomie: übersprungen");
    return;
  }

  const brief = await briefing();
  if (!brief) {
    logger.info("Autonomie: keine aktiven Ziele — nichts zu tun");
    return;
  }
  logger.info({ grund: grund.grund }, "Autonomie: Lauf startet");

  const episode = await openEpisode("autonomer_lauf");
  try {
    /*
     * Unter eigener Herkunft und mit Deckel.
     *
     * Der Deckel gilt fuer den GANZEN Lauf, Mitarbeiter eingerechnet — genau
     * das war die Luecke: der Lauf hatte ein Token-Budget, aber jeder Helfer
     * bekam in runLukasTurn eine frische Arbeitsschleife mit eigenem vollem
     * Budget obendrauf. Neun Helfer waren neun Budgets, und keins davon sah
     * das andere.
     */
    const result = await imZug(
      { herkunft: "autonom", istIssa: false, deckel: DECKEL_AUTONOM },
      () =>
        runLukasTurn({
          history: [{ role: "user", content: brief }],
          userText: brief,
          // Ziele und Tagebuch stehen oben im Auftrag — nicht noch einmal.
          ohneZieleUndTagebuch: true,
        }),
    );

    const summary = (result || "").trim();
    logger.info({ laenge: summary.length }, "Autonomer Lauf abgeschlossen");
    await closeEpisode(episode.id, summary.slice(0, 2000) || "Lauf ohne Ergebnis");
  } catch (err) {
    logger.warn({ err }, "Autonomer Lauf fehlgeschlagen");
    await closeEpisode(episode.id, `Fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    // Auch nach einem Fehlschlag: sonst laeuft dieselbe kaputte Sache im
    // Halbstundentakt weiter.
    await laufNotiert();
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startAutonomy(): void {
  if (!enabled()) {
    logger.info("Autonomie deaktiviert (LUKAS_AUTONOMY_ENABLED=false)");
    return;
  }
  /*
   * Unter Sperre. Ein Lauf darf bis zu 25 Minuten dauern, der Takt betraegt
   * 30 — das reicht nicht als Abstand. Ueberholt ein Lauf seinen Takt, wird
   * der naechste ausgelassen statt danebengestellt: zwei Laeufe an denselben
   * Zielen schreiben sich gegenseitig den Fortschritt um.
   */
  const safeRun = () => {
    mitSperre("autonomie", runAutonomyCycle).catch((err) =>
      logger.warn({ err }, "Autonomie-Zyklus abgestürzt"),
    );
  };
  // Nicht sofort beim Start: erst soll das Deployment stehen.
  setTimeout(safeRun, 3 * 60 * 1000).unref?.();
  timer = setInterval(safeRun, CYCLE_MS);
  logger.info({ minuten: CYCLE_MS / 60000 }, "Autonomie gestartet");
}

export function stopAutonomy(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
