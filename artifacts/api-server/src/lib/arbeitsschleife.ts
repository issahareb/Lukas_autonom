/*
 * Wie lange Lukas an einem Zug arbeiten darf.
 *
 * Vorher stand hier eine Zahl: nach 8 (spaeter 12) Werkzeugrunden war Schluss,
 * egal wie gut es lief. Das ist genau die falsche Grenze. Wenn er fuer eine
 * Recherche 15 Seiten lesen oder 20 Befehle absetzen muss, DANN SOLL ER DAS.
 * Er hat einen eigenen Server; ihn nach zwoelf Handgriffen anzuhalten macht
 * ihn zu einem Chat-Fenster mit Extras.
 *
 * Das eigentliche Problem war nie die Anzahl, sondern das Im-Kreis-Laufen: ein
 * Werkzeug, das dreimal identisch aufgerufen wird, bringt beim vierten Mal auch
 * nichts Neues. Dagegen hilft keine Obergrenze, sondern ein Hinweis an ihn.
 *
 * Deshalb hier drei Dinge, und keine Bremse:
 *
 *  1. Er bekommt gesagt, wenn er sich wiederholt — mit der Aufforderung,
 *     entweder etwas anderes zu probieren oder ehrlich zu sagen, dass er nicht
 *     weiterkommt.
 *  2. Er bekommt ab und zu eine Standortbestimmung: "du bist bei Runde N,
 *     laeuft es noch?". Kein Stopp, nur die Frage.
 *  3. Eine sehr hohe Notbremse gegen eine echte Endlosschleife. Die ist nicht
 *     gegen Lukas gerichtet, sondern gegen einen Fehler, der eine Schleife nie
 *     verlassen wuerde — und sie liegt so hoch, dass normale Arbeit sie nie
 *     sieht.
 *
 * Was dabei fehlte, und zwar vollstaendig: ein Budget. Die Rundenzahl ist ein
 * schlechtes Mass fuer Aufwand — 200 Runden koennen zehn Minuten oder drei
 * Stunden sein, ein paar tausend Tokens oder eine Million. Und die
 * Wiederholungserkennung greift nur bei EXAKT gleichen Argumenten:
 * search("foo"), search("foo latest"), search("foo 2026") ist formal nie
 * dasselbe und laeuft trotzdem im Kreis.
 *
 * Deshalb zusaetzlich:
 *
 *  4. Ein Budget aus Zeit UND Tokens. Bei 100 % bekommt er einen Hinweis und
 *     soll zum Ende kommen; bei 150 % ist Schluss. Bewusst zwei Stufen: ein
 *     harter Abbruch mitten in der Arbeit wirft weg, was er schon hat.
 *  5. Erkennung AEHNLICHER Aufrufe, nicht nur identischer.
 */

import { deckelErreicht } from "./zug";

/** Notbremse gegen echte Endlosschleifen. Kein Arbeitslimit. */
export const NOTBREMSE = Number(process.env.LUKAS_MAX_TOOL_ROUNDS ?? 200);

/*
 * Budget je Zug. Tokens zaehlen Eingang und Ausgabe zusammen, ueber alle
 * Runden — das ist die Zahl, die auf der Rechnung landet. Beide Werte sind
 * grosszuegig: ein langer Arbeitszug soll sie nicht sehen, ein Amoklauf schon.
 */
const TOKEN_BUDGET = () => Number(process.env.LUKAS_TURN_TOKEN_BUDGET ?? 300_000);
const MAX_MINUTEN = () => Number(process.env.LUKAS_TURN_MAX_MINUTEN ?? 25);

/** Ab wie vielen identischen Aufrufen wird er darauf hingewiesen. */
const WIEDERHOLUNGEN = 3;

/** Alle wie viele Runden eine Standortbestimmung kommt. */
const STANDORT_ALLE = 25;

export type Hinweis = { role: "system"; content: string };

/** Argumente als Wortmenge — fuer den Vergleich "aehnlich genug". */
function wortmenge(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      // Ziffern bleiben drin, auch einstellige: die Seitenzahl in
      // .../seite/3 ist oft das Einzige, was einen Aufruf vom naechsten
      // unterscheidet.
      .filter((w) => w.length > 1 || /\d/.test(w)),
  );
}

/*
 * Ein Wort, das einen Aufruf wirklich unterscheidet: eine Zahl, eine ID, ein
 * langer Bezeichner.
 *
 * Genau daran haengt der Unterschied zwischen Arbeit und Im-Kreis-Laufen, und
 * ein erster Versuch ohne diese Unterscheidung ist prompt in die falsche
 * Richtung gekippt: 40 Aufrufe von .../seite/0 bis .../seite/39 teilen alle
 * dieselben Woerter (url, https, seite) und sahen damit aus wie eine
 * Wiederholung — dabei ist das die geradlinigste Arbeit ueberhaupt. Die
 * Seitenzahl war das Einzige, was sie unterschied, und die war weggefiltert.
 *
 * Umgekehrt ist search("foo") / search("foo latest") / search("neueste foo")
 * dreimal dieselbe Frage in anderen Worten — dort unterscheidet nichts
 * ausser Fuellwoertern.
 */
function unterscheidend(wort: string): boolean {
  return /\d/.test(wort) || wort.length > 12;
}

/**
 * Sind zwei Aufrufe "dieselbe Frage in anderen Worten"?
 *
 * Zwei Bedingungen, und die zweite ist die wichtigere: genug Ueberschneidung,
 * UND kein unterscheidendes Wort im Unterschied. Sobald sich zwei Aufrufe in
 * einer Zahl oder einer ID unterscheiden, sind es zwei verschiedene Dinge.
 */
function aehnlich(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 && b.size === 0) return true;
  let schnitt = 0;
  for (const w of a) if (b.has(w)) schnitt++;
  const jaccard = a.size + b.size - schnitt > 0 ? schnitt / (a.size + b.size - schnitt) : 0;
  if (jaccard < 0.4) return false;

  for (const w of a) if (!b.has(w) && unterscheidend(w)) return false;
  for (const w of b) if (!a.has(w) && unterscheidend(w)) return false;
  return true;
}

export class Arbeitsschleife {
  private gesehen = new Map<string, number>();
  private gemeldet = new Set<string>();
  private aufrufeJeWerkzeug = new Map<string, Set<string>[]>();
  private tokens = 0;
  private budgetGemeldet = false;
  private runde = 0;
  readonly begonnen = Date.now();

  /** Was dieser Zug bisher verbraucht hat. Wird nach jedem Modellaufruf gefuettert. */
  verbucht(usage?: { rein: number; raus: number }): void {
    if (!usage) return;
    this.tokens += (usage.rein ?? 0) + (usage.raus ?? 0);
  }

  get verbrauchteTokens(): number {
    return this.tokens;
  }

  /**
   * Wie viel vom Budget verbraucht ist — der groessere der beiden Werte zaehlt.
   * 1 heisst "aufgebraucht", darueber laeuft er ins Ende.
   */
  budgetAnteil(): number {
    const jeTokens = TOKEN_BUDGET() > 0 ? this.tokens / TOKEN_BUDGET() : 0;
    const jeZeit =
      MAX_MINUTEN() > 0 ? (Date.now() - this.begonnen) / (MAX_MINUTEN() * 60_000) : 0;
    return Math.max(jeTokens, jeZeit);
  }

  /** Nur Notbremse, Budget und der Deckel der Aufgabe — sonst laeuft er. */
  darfWeiter(): boolean {
    return this.runde < NOTBREMSE && this.budgetAnteil() < 1.5 && !deckelErreicht();
  }

  /** Warum Schluss war, falls Schluss war. Fuer Protokoll und Antwort. */
  abbruchGrund(): string | null {
    if (this.runde >= NOTBREMSE) return `Notbremse nach ${this.runde} Runden`;
    /*
     * Der Deckel VOR dem eigenen Budget, weil er die ehrlichere Auskunft ist:
     * ein Mitarbeiter, der nach zwei Runden aufhoert, hat sein eigenes Budget
     * nicht ausgereizt — die Aufgabe war schon vorher am Ende. Stuende hier
     * "Budget aufgebraucht", suchte Lukas den Fehler beim Helfer.
     */
    const deckel = deckelErreicht();
    if (deckel) return deckel;
    if (this.budgetAnteil() >= 1.5) {
      const minuten = Math.round((Date.now() - this.begonnen) / 60000);
      return `Budget aufgebraucht (${this.tokens.toLocaleString("de-DE")} Tokens, ${minuten} min)`;
    }
    return null;
  }

  naechsteRunde(): number {
    return this.runde++;
  }

  get rundenZahl(): number {
    return this.runde;
  }

  /**
   * Hinweise fuer die naechste Runde: Wiederholung erkannt, Standortbestimmung
   * faellig. Leer, solange alles seinen Gang geht.
   */
  hinweise(aufrufe: Array<{ name: string; arguments: string }>): Hinweis[] {
    const raus: Hinweis[] = [];

    for (const a of aufrufe) {
      const schluessel = `${a.name}:${a.arguments}`;
      const anzahl = (this.gesehen.get(schluessel) ?? 0) + 1;
      this.gesehen.set(schluessel, anzahl);

      if (anzahl >= WIEDERHOLUNGEN && !this.gemeldet.has(schluessel)) {
        this.gemeldet.add(schluessel);
        raus.push({
          role: "system",
          content:
            `Du hast "${a.name}" jetzt ${anzahl}× mit exakt denselben Argumenten aufgerufen. ` +
            `Beim nächsten Mal kommt dasselbe zurück. Probier einen anderen Weg — andere ` +
            `Argumente, ein anderes Werkzeug, eine andere Quelle. Wenn du nicht weiterkommst: ` +
            `sag das offen und beschreibe, woran es hängt. Das ist kein Scheitern, sondern ` +
            `die brauchbarere Antwort. Weitermachen ist ausdrücklich erlaubt — im Kreis laufen nicht.`,
        });
      }
    }

    /*
     * Aehnliche Aufrufe. Drei Varianten derselben Suche sind formal drei
     * verschiedene Aufrufe und bringen trotzdem dasselbe zurueck — genau so
     * laeuft ein Modell im Kreis, ohne die Wiederholungssperre oben je
     * auszuloesen.
     */
    for (const a of aufrufe) {
      const menge = wortmenge(a.arguments);
      const vorher = this.aufrufeJeWerkzeug.get(a.name) ?? [];
      const nahe = vorher.filter((m) => aehnlich(m, menge)).length;
      vorher.push(menge);
      this.aufrufeJeWerkzeug.set(a.name, vorher);

      const schluessel = `aehnlich:${a.name}`;
      if (nahe >= 3 && !this.gemeldet.has(schluessel)) {
        this.gemeldet.add(schluessel);
        raus.push({
          role: "system",
          content:
            `Du hast "${a.name}" jetzt mehrfach sehr ähnlich aufgerufen — ` +
            `andere Worte, dieselbe Frage. Das bringt dieselben Ergebnisse. Wechsel das ` +
            `Werkzeug oder die Quelle, oder sag, dass du hier nicht weiterkommst.`,
        });
      }
    }

    /*
     * Budget. Ein Hinweis, kein Schnitt: er soll zusammenfassen, was er hat,
     * statt mittendrin abgeschnitten zu werden.
     */
    const anteil = this.budgetAnteil();
    if (anteil >= 1 && !this.budgetGemeldet) {
      this.budgetGemeldet = true;
      const minuten = Math.round((Date.now() - this.begonnen) / 60000);
      raus.push({
        role: "system",
        content:
          `Dein Budget für diesen Zug ist aufgebraucht: ${this.tokens.toLocaleString("de-DE")} ` +
          `Tokens, ${minuten} Minuten, ${this.runde} Runden. Komm jetzt zum Ende — sag, was du ` +
          `herausgefunden hast, was fehlt und was der nächste Schritt wäre. Wenn die Sache ` +
          `größer ist als ein Zug, leg sie als Ziel an oder melde dich bei Issa, statt hier ` +
          `weiterzulaufen.`,
      });
    }

    if (this.runde > 0 && this.runde % STANDORT_ALLE === 0) {
      const minuten = Math.round((Date.now() - this.begonnen) / 60000);
      raus.push({
        role: "system",
        content:
          `Standortbestimmung: du bist bei Runde ${this.runde}, seit etwa ${minuten} Minuten dran. ` +
          `Das ist völlig in Ordnung, solange du vorankommst — arbeite weiter, wenn du weißt, was ` +
          `als Nächstes zu tun ist. Falls du dich im Kreis drehst oder das Ziel unklar geworden ` +
          `ist, brich hier ab und sag, was du hast und was fehlt.`,
      });
    }

    return raus;
  }

  /** Für den Fall, dass die Notbremse wirklich gegriffen hat. */
  notbremseGriff(): boolean {
    return this.runde >= NOTBREMSE;
  }
}
