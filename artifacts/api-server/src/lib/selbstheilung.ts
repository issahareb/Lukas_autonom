import { backgroundPaused } from "./background-pause";
import { fehlerGruppen, recordDebugEvent, type Fehlergruppe } from "./debug-log";
import { fixError } from "./subagents";
import { runLukasTurn } from "./lukas-brain";
import { logger } from "./logger";
import { mitSperre } from "./lauf-sperre";

/*
 * Fehler finden, ohne dass jemand sie meldet.
 *
 * Die Reparaturkette war gut gebaut und hatte trotzdem eine Luecke: sie
 * repariert nur, was ihr jemand GIBT. Sie merkt selbst nichts. Und Lukas
 * konnte ihr auch nichts geben, denn sein Fehlerprotokoll las genau eine
 * Stelle — das Dashboard. Er war blind fuer seine eigenen Fehler.
 *
 * Das hier ist der Ausloeser davor: alle paar Stunden nachsehen, was sich
 * haeuft, den haeufigsten wiederkehrenden Fehler durch die Kette schicken und
 * das Ergebnis Lukas vorlegen. Er entscheidet, ob daraus ein Vorschlag fuer
 * Issa wird.
 *
 * Warum "wiederkehrend" und nicht "jeder": ein einzelner Fehler kann ein
 * Ausrutscher sein — ein Netzwerkhaenger, eine Seite, die gerade nicht da war.
 * Was sich WIEDERHOLT, ist ein Fehler im Code. Genau der lohnt die Arbeit von
 * drei Mitarbeitern.
 */

const SCOPE = "selbstheilung";

/** Ab wie vielen gleichen Fehlern es sich lohnt. */
const SCHWELLE = Number(process.env.LUKAS_HEILUNG_SCHWELLE ?? 3);

/** Wie weit zurueckgeschaut wird. */
const FENSTER_STUNDEN = Number(process.env.LUKAS_HEILUNG_FENSTER_H ?? 24);

const ZYKLUS_MS = Number(process.env.LUKAS_HEILUNG_INTERVALL_MIN ?? 120) * 60 * 1000;

/*
 * Woran schon gearbeitet wurde.
 *
 * Ohne das Gedaechtnis liefe alle zwei Stunden dieselbe Kette fuer denselben
 * Fehler — drei Modellaufrufe pro Runde, fuer ein Ergebnis, das Issa bereits
 * als Vorschlag vorliegt. Im Speicher und mit Ablauf: nach einem Neustart oder
 * einem Tag darf er es erneut versuchen, denn vielleicht wurde der Vorschlag
 * abgelehnt und der Fehler besteht weiter.
 */
const bearbeitet = new Map<string, number>();
const SPERRE_MS = Number(process.env.LUKAS_HEILUNG_SPERRE_H ?? 24) * 3600 * 1000;

function schonBearbeitet(signatur: string): boolean {
  const wann = bearbeitet.get(signatur);
  if (wann === undefined) return false;
  if (Date.now() - wann > SPERRE_MS) {
    bearbeitet.delete(signatur);
    return false;
  }
  return true;
}

/**
 * Den lohnendsten Fehler heraussuchen: haeufig genug, noch nicht bearbeitet,
 * und nicht aus der Selbstheilung selbst.
 */
export async function naechsterFehler(): Promise<Fehlergruppe | null> {
  /*
   * Die eigenen Fehler ausklammern, und das ist kein Detail: scheitert die
   * Kette selbst, protokolliert sie das — und wuerde beim naechsten Lauf den
   * Fehler untersuchen, der beim Untersuchen entstanden ist. Eine Schleife,
   * die sich selbst fuettert.
   */
  const gruppen = await fehlerGruppen(FENSTER_STUNDEN, [SCOPE]);
  return (
    gruppen.find((g) => g.anzahl >= SCHWELLE && !schonBearbeitet(g.signatur)) ?? null
  );
}

export async function runSelbstheilung(): Promise<void> {
  if (backgroundPaused()) return;
  let gruppe: Fehlergruppe | null = null;
  try {
    gruppe = await naechsterFehler();
  } catch (err) {
    logger.warn({ err }, "Selbstheilung: Fehlerprotokoll nicht lesbar");
    return;
  }

  if (!gruppe) {
    logger.info("Selbstheilung: nichts, was sich häuft — gut so");
    return;
  }

  bearbeitet.set(gruppe.signatur, Date.now());
  logger.info(
    { scope: gruppe.scope, anzahl: gruppe.anzahl },
    "Selbstheilung: wiederkehrender Fehler gefunden, Kette läuft",
  );

  try {
    const gutachten = await fixError(
      gruppe.beispiel,
      `Dieser Fehler ist in den letzten ${FENSTER_STUNDEN} Stunden ${gruppe.anzahl}× ` +
        `aufgetreten, im Bereich "${gruppe.scope}". Zuletzt: ${gruppe.zuletzt}. ` +
        `Niemand hat ihn gemeldet — er ist im Fehlerprotokoll aufgefallen.`,
    );

    /*
     * Und jetzt Lukas. Nicht die Kette entscheidet, was mit dem Ergebnis
     * passiert, sondern er — genau wie bei einem Fehler, den Issa meldet.
     */
    await runLukasTurn({
      userText: `Wiederkehrender Fehler: ${gruppe.beispiel.slice(0, 200)}`,
      history: [
        {
          role: "user",
          content:
            `Niemand hat dich darum gebeten — dir ist in deinem eigenen Fehlerprotokoll ` +
            `aufgefallen, dass sich etwas häuft, und du hast es untersuchen lassen.\n\n` +
            `DER FEHLER (${gruppe.anzahl}× in ${FENSTER_STUNDEN} Stunden, Bereich "${gruppe.scope}"):\n` +
            `${gruppe.beispiel}\n\n` +
            `${gutachten}\n\n` +
            `Entscheide jetzt:\n` +
            `- Überzeugt dich die Änderung? Dann mach einen propose_code_change daraus, ` +
            `damit Issa sie annehmen kann. Schreib in die Begründung, dass DU den Fehler ` +
            `bemerkt hast, nicht er.\n` +
            `- Widersprechen sich die drei? Dann liegt dort das eigentliche Problem — ` +
            `schick die Kette mit dem Widerspruch als Kontext noch einmal los.\n` +
            `- Brauchst du dafür etwas von Issa, das du nicht selbst herausfinden kannst: ` +
            `melde_dich_bei_issa.\n` +
            `- Ist es kein echter Fehler, sondern erwartetes Verhalten? Dann sag das in ` +
            `einem Satz und lass es gut sein. Nicht jede Meldung ist ein Defekt.`,
        },
      ],
    });
  } catch (err) {
    logger.warn({ err, signatur: gruppe.signatur }, "Selbstheilung fehlgeschlagen");
    recordDebugEvent(SCOPE, err);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

export function startSelbstheilung(): void {
  if (backgroundPaused()) {
    logger.info("startSelbstheilung: pausiert (LUKAS_BACKGROUND_PAUSED=true)");
    return;
  }
  if (timer || startupTimer) return;
  if ((process.env.LUKAS_HEILUNG_ENABLED ?? "true").trim().toLowerCase() === "false") {
    logger.info("Selbstheilung deaktiviert (LUKAS_HEILUNG_ENABLED=false)");
    return;
  }
  if (timer) return;

  // Unter Sperre: die Selbstheilung legt Vorschlaege an. Zwei Laeufe zu
  // demselben Fehler heissen zwei Vorschlaege fuer dieselbe Zeile.
  const lauf = () => {
    mitSperre("selbstheilung", runSelbstheilung).catch((err) =>
      logger.warn({ err }, "Selbstheilung abgestürzt"),
    );
  };

  // Nicht sofort beim Start: erst soll etwas Betrieb stattgefunden haben, sonst
  // untersucht er die Fehler des vorigen Deploys.
  startupTimer = setTimeout(() => { startupTimer = null; lauf(); }, 10 * 60 * 1000);
  timer = setInterval(lauf, ZYKLUS_MS);
  logger.info({ alleMinuten: ZYKLUS_MS / 60000, schwelle: SCHWELLE }, "Selbstheilung aktiv");
}

export function stopSelbstheilung(): void {
  if (startupTimer) clearTimeout(startupTimer);
  startupTimer = null;
  if (timer) clearInterval(timer);
  timer = null;
}
