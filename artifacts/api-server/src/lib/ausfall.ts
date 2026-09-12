/*
 * Wenn ein ganzer Bereich tot ist, nicht vierzig Mal dagegenlaufen.
 *
 * DER ANLASS: der Droplet war nicht erreichbar. Jeder Versuch, ihn zu
 * erreichen, lief zwanzig Sekunden in die Zeitueberschreitung — und Lukas
 * probierte weiter: browse_page, dann browser_do, dann execute_command, in
 * der naechsten autonomen Runde von vorn. Alle drei laufen ueber denselben
 * SSH-Weg, alle drei scheiterten am selben Punkt.
 *
 * Der Preis dafuer steht nicht nur in der Zeit. Jeder gescheiterte Aufruf
 * kommt als Werkzeugergebnis zurueck, geht in den naechsten Modellaufruf ein
 * und wird dort bezahlt. Vierzig Fehlschlaege in einem Zug sind vierzig
 * Runden Kontext — und der autonome Lauf startet immer wieder neu.
 *
 * WAS DAS HIER IST: ein Schalter, der nach zwei Fehlschlaegen in Folge
 * umlegt. Danach kommt die Diagnose SOFORT zurueck, ohne dass es noch
 * jemand versucht. Nach der Abkuehlzeit wird wieder einer durchgelassen —
 * wenn der klappt, ist der Schalter zurueck.
 *
 * ZWEI FEHLSCHLAEGE, nicht einer: ein einzelner kann ein Netzhaenger sein.
 * Beim zweiten in Folge ist es keiner mehr.
 *
 * IM SPEICHER, nicht in der Datenbank. Ein Ausfall ist ein Zustand von
 * Minuten, kein Wissen. Nach einem Neustart soll er wieder ohne Vorurteil
 * anfangen — und ein Neustart ist ohnehin genau die Sorte Ereignis, nach der
 * sich die Lage geaendert haben kann.
 */
import { logger } from "./logger";

/** Nach wie vielen Fehlschlägen in Folge dichtgemacht wird. */
const SCHWELLE = Number(process.env.LUKAS_AUSFALL_SCHWELLE ?? 2);

/** Wie lange dicht bleibt, bevor wieder einer durchgelassen wird. */
const ABKUEHLUNG_MS = Number(process.env.LUKAS_AUSFALL_ABKUEHLUNG_MIN ?? 5) * 60 * 1000;

type Zustand = {
  fehlschlaege: number;
  offenBis: number;
  grund: string;
};

const bereiche = new Map<string, Zustand>();

/**
 * Ist der Bereich gerade als ausgefallen bekannt?
 *
 * Gibt den Grund zurueck, nicht bloss ein Ja — der Aufrufer soll denselben
 * Satz weiterreichen koennen, den der echte Fehlschlag erzeugt haette. Ein
 * "gerade nicht verfuegbar" ohne Grund waere fuer Lukas eine neue Sorte
 * Raetsel statt einer Ersparnis.
 */
export function ausgefallen(bereich: string, jetzt = Date.now()): string | null {
  const z = bereiche.get(bereich);
  if (!z || z.fehlschlaege < SCHWELLE) return null;
  if (jetzt >= z.offenBis) {
    /*
     * Abkuehlzeit vorbei: EINER darf es versuchen. Der Zaehler bleibt stehen
     * — klappt der Versuch, raeumt merkeErfolg() auf; scheitert er, schiebt
     * merkeAusfall() das Fenster weiter. So wird nicht bei jedem Aufruf neu
     * probiert, sondern einmal je Abkuehlzeit.
     */
    return null;
  }
  const restSek = Math.ceil((z.offenBis - jetzt) / 1000);
  return (
    `${z.grund}\n\n(Das ist die gespeicherte Diagnose vom letzten Versuch — es wurde gar ` +
    `nicht erst wieder verbunden, weil derselbe Weg schon ${z.fehlschlaege} Mal in Folge ` +
    `gescheitert ist. In ${restSek} Sekunden wird es wieder versucht. Bis dahin bringt ` +
    `es nichts, es erneut aufzurufen — auch nicht mit einem anderen Werkzeug, das ` +
    `denselben Weg nimmt.)`
  );
}

export function merkeAusfall(bereich: string, grund: string, jetzt = Date.now()): void {
  const z = bereiche.get(bereich) ?? { fehlschlaege: 0, offenBis: 0, grund: "" };
  z.fehlschlaege++;
  z.grund = grund;
  z.offenBis = jetzt + ABKUEHLUNG_MS;
  bereiche.set(bereich, z);

  if (z.fehlschlaege === SCHWELLE) {
    logger.warn(
      { bereich, fehlschlaege: z.fehlschlaege },
      "Bereich als ausgefallen markiert — weitere Versuche werden abgekürzt",
    );
  }
}

export function merkeErfolg(bereich: string): void {
  const z = bereiche.get(bereich);
  if (!z) return;
  if (z.fehlschlaege >= SCHWELLE) {
    logger.info({ bereich }, "Bereich antwortet wieder");
  }
  bereiche.delete(bereich);
}

/** Für Tests und für die Diagnose-Ansicht. */
export function ausfallStand(): Array<{ bereich: string; fehlschlaege: number; grund: string }> {
  return [...bereiche.entries()].map(([bereich, z]) => ({
    bereich,
    fehlschlaege: z.fehlschlaege,
    grund: z.grund,
  }));
}

export function ausfaelleZuruecksetzen(): void {
  bereiche.clear();
}
