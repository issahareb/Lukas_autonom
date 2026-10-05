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
 * braucht die jeweils gueltigen Providerpreise. Dieses Modul misst Tokens,
 * keine Eurobetraege.
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
import { tageskostenTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import type { VerbrauchsQuelle } from "./verbrauch-quelle";

const WARNUNG = () => Number(process.env.LUKAS_TAGESBUDGET_WARNUNG ?? 2_000_000);
const STOPP = () => Number(process.env.LUKAS_TAGESBUDGET_STOPP ?? 0);

/** Der Tag in UTC — dieselbe Grenze wie in den Protokollen. */
export function heute(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Kostenlose Anbieter zaehlen nicht mit. */
function kostenpflichtig(provider: string): boolean {
  return provider !== "local" || process.env.LUKAS_LOCAL_BILLABLE === "true";
}

export async function verbucheTag(input: {
  provider: string;
  model: string;
  rein: number;
  raus: number;
  ausCache?: number;
  inCache?: number;
  quelle?: VerbrauchsQuelle;
}): Promise<void> {
  if (!kostenpflichtig(input.provider)) return;
  try {
    await db
      .insert(tageskostenTable)
      .values({
        tag: heute(),
        provider: input.provider,
        model: input.model,
        quelle: input.quelle ?? "sonstige",
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
        target: [tageskostenTable.tag, tageskostenTable.provider, tageskostenTable.model, tageskostenTable.quelle],
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
    logger.warn({ err }, "Tagesverbrauch nicht gebucht");
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
  let zeilen: Array<{ provider: string; model: string; rein: number; raus: number; ausCache: number; inCache: number; aufrufe: number }> = [];
  try {
    zeilen = await db
      .select({
        provider: tageskostenTable.provider,
        model: tageskostenTable.model,
        rein: tageskostenTable.rein,
        raus: tageskostenTable.raus,
        ausCache: tageskostenTable.ausCache,
        inCache: tageskostenTable.inCache,
        aufrufe: tageskostenTable.aufrufe,
      })
      .from(tageskostenTable)
      .where(eq(tageskostenTable.tag, tag));
  } catch (err) {
    logger.debug({ err }, "Tagesstand nicht lesbar");
  }

  const summe = (z: typeof zeilen[number]) => z.rein + z.raus + (z.ausCache ?? 0) + (z.inCache ?? 0);
  const tokens = zeilen.reduce((s, z) => s + summe(z), 0);
  const aufrufe = zeilen.reduce((s, z) => s + z.aufrufe, 0);
  const warnung = WARNUNG();
  const stopp = STOPP();

  const modelle = new Map<string, Tagesstand["jeModell"][number]>();
  for (const z of zeilen) {
    const key = JSON.stringify([z.provider, z.model]);
    const m = modelle.get(key) ?? { model: z.model, provider: z.provider, tokens: 0, aufrufe: 0 };
    m.tokens += summe(z); m.aufrufe += z.aufrufe; modelle.set(key, m);
  }

  return {
    tag,
    tokens,
    aufrufe,
    warnung,
    stopp,
    ueberWarnung: warnung > 0 && tokens >= warnung,
    ueberStopp: stopp > 0 && tokens >= stopp,
    jeModell: [...modelle.values()]
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
