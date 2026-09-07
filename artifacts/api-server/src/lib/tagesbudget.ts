/*
 * Was heute schon verbraucht wurde — und ab wann Schluss ist.
 *
 * WARUM DAS FEHLTE. Es gibt ein Budget pro ZUG (arbeitsschleife.ts): Tokens
 * und Minuten, danach soll er zusammenfassen. Was es nicht gab, ist eine
 * Grenze pro TAG. Ein Zug kann diszipliniert sein und trotzdem achtundvierzig
 * Mal am Tag laufen; die Rechnung entsteht aus der Summe, nicht aus dem
 * einzelnen Lauf. Bemerkt haette man das erst auf der Abrechnung.
 *
 * WARUM TOKENS UND NICHT EURO. Preise pro Modell aendern sich, und sie hier
 * fest einzutragen hiesse, eine Zahl zu behaupten, die morgen falsch ist.
 * Tokens sind das, was tatsaechlich gemessen wird. Wer Euro sehen will,
 * traegt die Preise ueber LUKAS_PREIS_<MODELL> ein — dann wird gerechnet,
 * sonst nicht.
 *
 * ZWEI SCHWELLEN, und die zweite ist absichtlich aus.
 *
 *   WARNUNG (Standard 2 Mio. Tokens): ab hier steht ein Hinweis im Protokoll
 *   und Lukas bekommt ihn im naechsten Zug zu lesen. Er arbeitet weiter.
 *
 *   STOPP (Standard: keiner): erst wenn Issa eine Zahl setzt. Ein Agent, der
 *   mittags aufhoert zu arbeiten, weil eine Voreinstellung griff, die niemand
 *   gewaehlt hat, waere schlimmer als eine hohe Rechnung — er wuerde
 *   stillschweigend nichts mehr tun.
 *
 * WAS NICHT ZAEHLT. Laeufe auf dem lokalen Modell. Die kosten nichts, und ein
 * Budget, das kostenlose Arbeit bremst, waere schlicht falsch.
 */
import { db } from "@workspace/db";
import { tageskostenTable, verbrauchHerkunftTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "./logger";

const WARNUNG = () => Number(process.env.LUKAS_TAGESBUDGET_WARNUNG ?? 2_000_000);
const STOPP = () => Number(process.env.LUKAS_TAGESBUDGET_STOPP ?? 0);

/** Der Tag in UTC — dieselbe Grenze wie in den Protokollen. */
export function heute(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Kostenlose Anbieter zaehlen nicht mit. */
function kostenpflichtig(provider: string): boolean {
  return provider !== "local";
}

export async function verbucheTag(input: {
  provider: string;
  model: string;
  rein: number;
  raus: number;
  ausCache?: number;
  inCache?: number;
  /** "chat" | "autonom" | "selbstheilung" | "mitarbeiter:<slug>" | "unbekannt" */
  herkunft?: string;
}): Promise<void> {
  if (!kostenpflichtig(input.provider)) return;
  /*
   * Zwei Buecher, zwei Fragen, und bewusst unabhaengig voneinander.
   *
   * Das Tagesbuch beantwortet "wie viel hat heute gekostet" und traegt das
   * Budget — daran wird nichts geaendert, es ist erprobt. Das Herkunftsbuch
   * beantwortet "wohin ist es geflossen". Die Unabhaengigkeit steckt im
   * eigenen try/catch von verbucheHerkunft: faellt seine Tabelle aus, merkt
   * das Tagesbuch davon nichts.
   *
   * AWAIT, nicht "void": eine Buchung, deren Zeitpunkt unbestimmt ist, kann
   * niemand pruefen — weder ein Test noch Lukas, der gleich danach
   * read_usage aufruft und sich wundert, dass seine eigene Runde fehlt. Es
   * kostet hier nichts, weil verbucheTag ohnehin von niemandem erwartet wird
   * (model-client ruft es nebenlaeufig auf).
   */
  await verbucheHerkunft(input);
  try {
    await db
      .insert(tageskostenTable)
      .values({
        tag: heute(),
        provider: input.provider,
        model: input.model,
        aufrufe: 1,
        rein: input.rein,
        raus: input.raus,
        ausCache: input.ausCache ?? 0,
        inCache: input.inCache ?? 0,
      })
      /*
       * Aufaddieren statt lesen-rechnen-schreiben. Zwei gleichzeitige Zuege
       * wuerden sich sonst gegenseitig ueberschreiben, und gerade im
       * autonomen Betrieb laufen Dinge nebeneinander.
       */
      .onConflictDoUpdate({
        target: [tageskostenTable.tag, tageskostenTable.provider, tageskostenTable.model],
        set: {
          aufrufe: sql`${tageskostenTable.aufrufe} + 1`,
          rein: sql`${tageskostenTable.rein} + ${input.rein}`,
          raus: sql`${tageskostenTable.raus} + ${input.raus}`,
          ausCache: sql`${tageskostenTable.ausCache} + ${input.ausCache ?? 0}`,
          inCache: sql`${tageskostenTable.inCache} + ${input.inCache ?? 0}`,
          aktualisiert: new Date(),
        },
      });
  } catch (err) {
    // Buchhaltung darf einen Zug nie kippen.
    logger.debug({ err }, "Tagesverbrauch nicht gebucht");
  }
}

/*
 * Dasselbe noch einmal, nach Herkunft statt nach Modell.
 *
 * Warum das nicht dieselbe Zeile sein kann: der eindeutige Index von
 * `lukas_tageskosten` liegt auf (tag, provider, model). Die Herkunft
 * muesste hinein, sonst fielen Chat und Selbstheilung wieder in eine Zeile
 * zusammen — und das hiesse, einen Index auf einer geteilten
 * Produktionsdatenbank zu loeschen und neu zu bauen, im Deploy, ohne dass
 * jemand eine Rueckfrage beantworten koennte.
 *
 * Eigene Fehlerbehandlung, absichtlich: die Herkunft ist eine Diagnosehilfe.
 * Sie darf das Tagesbudget nicht mit sich reissen, wenn ihre Tabelle nach
 * einem Deploy noch gar nicht existiert.
 */
async function verbucheHerkunft(input: {
  rein: number;
  raus: number;
  ausCache?: number;
  inCache?: number;
  herkunft?: string;
}): Promise<void> {
  const woher = (input.herkunft ?? "unbekannt").slice(0, 80);
  try {
    await db
      .insert(verbrauchHerkunftTable)
      .values({
        tag: heute(),
        herkunft: woher,
        aufrufe: 1,
        rein: input.rein,
        raus: input.raus,
        ausCache: input.ausCache ?? 0,
        inCache: input.inCache ?? 0,
      })
      .onConflictDoUpdate({
        target: [verbrauchHerkunftTable.tag, verbrauchHerkunftTable.herkunft],
        set: {
          aufrufe: sql`${verbrauchHerkunftTable.aufrufe} + 1`,
          rein: sql`${verbrauchHerkunftTable.rein} + ${input.rein}`,
          raus: sql`${verbrauchHerkunftTable.raus} + ${input.raus}`,
          ausCache: sql`${verbrauchHerkunftTable.ausCache} + ${input.ausCache ?? 0}`,
          inCache: sql`${verbrauchHerkunftTable.inCache} + ${input.inCache ?? 0}`,
          aktualisiert: new Date(),
        },
      });
  } catch (err) {
    logger.debug({ err }, "Herkunft nicht gebucht");
  }
}

/**
 * Wohin der Tag geflossen ist — absteigend nach Verbrauch.
 *
 * Genau die Ansicht, die an dem 4,2-Millionen-Tag gefehlt hat.
 */
export async function herkunftHeute(): Promise<Array<{ herkunft: string; tokens: number; aufrufe: number }>> {
  try {
    const zeilen = await db
      .select()
      .from(verbrauchHerkunftTable)
      .where(eq(verbrauchHerkunftTable.tag, heute()));
    return zeilen
      .map((z) => ({
        herkunft: z.herkunft,
        tokens: z.rein + z.raus + z.ausCache + z.inCache,
        aufrufe: z.aufrufe,
      }))
      .sort((a, b) => b.tokens - a.tokens);
  } catch (err) {
    logger.debug({ err }, "Herkunft nicht lesbar");
    return [];
  }
}

export type Tagesstand = {
  tag: string;
  tokens: number;
  aufrufe: number;
  warnung: number;
  stopp: number;
  ueberWarnung: boolean;
  ueberStopp: boolean;
  jeModell: Array<{ model: string; provider: string; tokens: number; aufrufe: number }>;
};

export async function tagesstand(): Promise<Tagesstand> {
  const tag = heute();
  let zeilen: Array<{ provider: string; model: string; rein: number; raus: number; aufrufe: number }> = [];
  try {
    zeilen = await db
      .select({
        provider: tageskostenTable.provider,
        model: tageskostenTable.model,
        rein: tageskostenTable.rein,
        raus: tageskostenTable.raus,
        aufrufe: tageskostenTable.aufrufe,
      })
      .from(tageskostenTable)
      .where(eq(tageskostenTable.tag, tag));
  } catch (err) {
    logger.debug({ err }, "Tagesstand nicht lesbar");
  }

  const tokens = zeilen.reduce((s, z) => s + z.rein + z.raus, 0);
  const aufrufe = zeilen.reduce((s, z) => s + z.aufrufe, 0);
  const warnung = WARNUNG();
  const stopp = STOPP();

  return {
    tag,
    tokens,
    aufrufe,
    warnung,
    stopp,
    ueberWarnung: warnung > 0 && tokens >= warnung,
    ueberStopp: stopp > 0 && tokens >= stopp,
    jeModell: zeilen
      .map((z) => ({ model: z.model, provider: z.provider, tokens: z.rein + z.raus, aufrufe: z.aufrufe }))
      .sort((a, b) => b.tokens - a.tokens),
  };
}

/**
 * Darf jetzt noch ein kostenpflichtiger Modellaufruf passieren?
 *
 * `istIssa` ist die Ausnahme, die es braucht: wenn Issa im Chat sitzt und
 * etwas fragt, ist ein "heute nicht mehr" die falsche Antwort — er entscheidet
 * dann selbst, ob es ihm das wert ist. Gebremst werden autonome Laeufe, also
 * genau das, was ohne Aufsicht Geld ausgibt.
 */
export async function budgetTor(opts: { istIssa?: boolean } = {}): Promise<{ weiter: boolean; grund?: string; stand: Tagesstand }> {
  const stand = await tagesstand();
  if (stand.ueberStopp && !opts.istIssa) {
    const grund =
      `Tagesbudget aufgebraucht: ${stand.tokens.toLocaleString("de-DE")} von ` +
      `${stand.stopp.toLocaleString("de-DE")} Tokens. Autonome Läufe pausieren bis morgen; ` +
      `Issas eigene Anfragen laufen weiter.`;
    logger.warn({ tokens: stand.tokens, stopp: stand.stopp }, "Tagesbudget erreicht — autonome Läufe pausieren");
    return { weiter: false, grund, stand };
  }
  return { weiter: true, stand };
}

/** Der Satz fuer den System-Prompt, wenn es eng wird. Sonst leer. */
export async function budgetHinweis(): Promise<string> {
  const stand = await tagesstand();
  if (!stand.ueberWarnung) return "";
  return (
    `HEUTIGER VERBRAUCH: ${stand.tokens.toLocaleString("de-DE")} Tokens in ${stand.aufrufe} Modellaufrufen — ` +
    `über der Warnschwelle von ${stand.warnung.toLocaleString("de-DE")}. Arbeite sparsamer: ` +
    `weniger Runden, kürzere Kontexte, kein Modellaufruf für etwas, das du schon weißt. ` +
    `Wenn eine Aufgabe teuer wird, sag es Issa, statt sie stillschweigend durchzuziehen.`
  );
}
