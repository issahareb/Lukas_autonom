/*
 * Wer gerade arbeitet — und auf wessen Rechnung.
 *
 * DER ANLASS: an einem Tag standen 4,2 Millionen Tokens auf der Uhr, und
 * niemand konnte sagen, wohin sie gegangen sind. Chat, autonomer Lauf,
 * Selbstheilung und neun Mitarbeiter laufen alle durch denselben
 * model-client; in der Buchhaltung landete nur, WELCHES Modell gerufen wurde.
 *
 * Das eigentliche Problem war aber nicht die fehlende Spalte, sondern das
 * hier: ein Mitarbeiter bekommt in runLukasTurn eine FRISCHE Arbeitsschleife
 * mit eigenem vollem Token-Budget. Sein Verbrauch war fuer den aufrufenden
 * Zug unsichtbar. Ein Zug mit 300.000 Token Budget konnte neun Helfer rufen,
 * die zusammen ein Vielfaches davon ausgeben — formal hat sich niemand
 * falsch verhalten.
 *
 * WAS DAS HIER IST: ein Kontext, der mit der Aufgabe mitlaeuft. Er traegt die
 * Herkunft (fuer die Buchhaltung) und einen GEMEINSAMEN Token-Zaehler (fuer
 * den Deckel). Ruft Lukas einen Mitarbeiter, erbt der den Zaehler — per
 * Referenz, nicht als Kopie. Was der Helfer ausgibt, sieht der Aufrufer.
 *
 * WARUM AsyncLocalStorage und keine Parameter: zwischen dem Einstiegspunkt
 * (Chat-Route, autonomer Lauf, Selbstheilung) und dem model-client liegen ein
 * halbes Dutzend Funktionen, die mit Geld nichts zu tun haben. Die Herkunft
 * durch alle durchzureichen hiesse, jede davon um ein Argument zu erweitern,
 * das sie nur weitergibt — und beim naechsten neuen Pfad wieder zu vergessen.
 * Ein mitlaufender Kontext vergisst nichts.
 *
 * WAS ER AUSDRUECKLICH NICHT IST: eine Bremse gegen Lukas. Ohne Deckel laeuft
 * alles wie bisher, und Issas eigene Anfragen bekommen keinen. Gedeckelt wird
 * genau das, was ohne Aufsicht laeuft.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** Gemeinsamer Zaehler. Absichtlich ein Objekt: er wird geteilt, nicht kopiert. */
type Zaehler = { tokens: number; aufrufe: number };

export type Zug = {
  /** "chat" | "autonom" | "selbstheilung" | "mitarbeiter:<slug>" | … */
  herkunft: string;
  /** Laeuft das auf Issas Anfrage? Dann bremst kein Tagesbudget. */
  istIssa: boolean;
  /** Ueber ALLE verschachtelten Laeufe hinweg. Geteilt per Referenz. */
  zaehler: Zaehler;
  /** Obergrenze fuer die ganze Aufgabe inklusive Helfer. 0 = kein Deckel. */
  deckel: number;
  /** 0 = der aeussere Zug, 1 = ein Mitarbeiter, 2 gibt es nicht. */
  tiefe: number;
};

const speicher = new AsyncLocalStorage<Zug>();

/**
 * Eine Aufgabe unter einer Herkunft laufen lassen.
 *
 * Verschachtelt: die Herkunft wird NEU gesetzt (damit die Buchhaltung den
 * Mitarbeiter sieht), Zaehler und Deckel werden GEERBT (damit der Helfer im
 * Budget des Aufrufers bleibt). Genau diese Asymmetrie ist der Punkt.
 */
export function imZug<T>(
  opts: { herkunft: string; istIssa?: boolean; deckel?: number },
  fn: () => Promise<T>,
): Promise<T> {
  const eltern = speicher.getStore();
  const zug: Zug = {
    herkunft: opts.herkunft,
    istIssa: opts.istIssa ?? eltern?.istIssa ?? false,
    zaehler: eltern?.zaehler ?? { tokens: 0, aufrufe: 0 },
    deckel: eltern?.deckel ?? opts.deckel ?? 0,
    tiefe: eltern ? eltern.tiefe + 1 : 0,
  };
  return speicher.run(zug, fn);
}

export function aktuellerZug(): Zug | undefined {
  return speicher.getStore();
}

/** Woher der laufende Aufruf kommt — fuer die Buchhaltung. */
export function herkunft(): string {
  return speicher.getStore()?.herkunft ?? "unbekannt";
}

/**
 * Einen Modellaufruf auf die laufende Aufgabe buchen.
 *
 * Ohne Kontext still nichts tun: es gibt Pfade (Pruefskripte, das oeffentliche
 * Widget), die keinen Zug oeffnen, und die sollen nicht daran scheitern.
 */
export function zugVerbraucht(tokens: number): void {
  const z = speicher.getStore();
  if (!z) return;
  z.zaehler.tokens += tokens;
  z.zaehler.aufrufe++;
}

/**
 * Ist der Deckel der ganzen Aufgabe erreicht?
 *
 * Gibt den Grund zurueck, nicht bloss ein Ja — er landet in Lukas' Antwort,
 * und "abgebrochen" ohne Zahl ist fuer ihn nur ein neues Raetsel.
 */
export function deckelErreicht(): string | null {
  const z = speicher.getStore();
  if (!z || z.deckel <= 0) return null;
  if (z.zaehler.tokens < z.deckel) return null;
  return (
    `Der Deckel für diese Aufgabe ist erreicht: ${z.zaehler.tokens.toLocaleString("de-DE")} ` +
    `von ${z.deckel.toLocaleString("de-DE")} Tokens, verteilt auf ${z.zaehler.aufrufe} ` +
    `Modellaufrufe — Mitarbeiter mitgerechnet.`
  );
}

/** Für Protokoll und Prüfungen. */
export function zugStand(): { herkunft: string; tokens: number; aufrufe: number; deckel: number; tiefe: number } | null {
  const z = speicher.getStore();
  return z
    ? {
        herkunft: z.herkunft,
        tokens: z.zaehler.tokens,
        aufrufe: z.zaehler.aufrufe,
        deckel: z.deckel,
        tiefe: z.tiefe,
      }
    : null;
}
