/*
 * Wer wurde wofuer gefragt, und was kam zurueck.
 *
 * DER ANLASS ist die nuetzlichste Beobachtung aus einem Text ueber
 * Agenten-Teams: "If the final answer is weak, you can see where it broke."
 * Genau das ging bei Lukas nicht. Ein Mitarbeiter-Lauf hinterliess ein
 * logger.info beim Start und einen Einsatzzaehler. Danach war die Kette weg
 * und nur ihr Ergebnis da — und ein schwaches Ergebnis liess sich nicht mehr
 * einem Glied zuordnen.
 *
 * Bei der Reparaturkette faellt das besonders ins Gewicht: drei Mitarbeiter
 * nacheinander, jeder auf der Ausgabe des vorigen. Ist das Ergebnis falsch,
 * ist die Frage nicht OB, sondern WO — hat der Fehleranalyst eine duenne
 * Diagnose geliefert, hat der Entwickler sie ignoriert, hat der Pruefer
 * durchgewunken?
 *
 * WAS HIER NICHT PASSIERT: das vollstaendige Ergebnis speichern. Das ist eine
 * Spur zum Nachsehen, kein zweites Gedaechtnis — die vollen Texte haben ihren
 * Platz im Gespraech. Gespeichert wird so viel, dass man erkennt, WAS
 * uebergeben wurde, und die volle Zeichenzahl daneben, damit man sieht, wie
 * viel hier fehlt.
 *
 * NIE eine Ausnahme nach oben: das Protokoll ist eine Beobachtung. Es darf
 * die beobachtete Arbeit unter keinen Umstaenden kippen — auch dann nicht,
 * wenn seine Tabelle nach einem Deploy noch gar nicht existiert.
 */
import { db } from "@workspace/db";
import { uebergabenTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { logger } from "./logger";
import { herkunft } from "./zug";

/** Wie viel von Auftrag und Ergebnis in der Spur landet. */
const AUSSCHNITT = 2000;

export async function protokolliereUebergabe(u: {
  helfer: string;
  auftrag: string;
  ergebnis: string;
  ergebnisZeichen: number;
  gekuerzt: boolean;
  tokens: number;
  dauerMs: number;
  fehler?: string;
}): Promise<void> {
  try {
    await db.insert(uebergabenTable).values({
      helfer: u.helfer.slice(0, 80),
      herkunft: herkunft().slice(0, 80),
      auftrag: u.auftrag.slice(0, AUSSCHNITT),
      ergebnis: u.ergebnis.slice(0, AUSSCHNITT),
      ergebnisZeichen: u.ergebnisZeichen,
      gekuerzt: u.gekuerzt,
      tokens: Math.max(0, Math.round(u.tokens)),
      dauerMs: Math.max(0, Math.round(u.dauerMs)),
      fehler: u.fehler ? u.fehler.slice(0, 500) : null,
    });
  } catch (err) {
    logger.debug({ err, helfer: u.helfer }, "Übergabe nicht protokolliert");
  }
}

export type UebergabeZeile = {
  helfer: string;
  herkunft: string;
  auftrag: string;
  ergebnisZeichen: number;
  gekuerzt: boolean;
  tokens: number;
  dauerMs: number;
  fehler: string | null;
  wann: Date;
};

export async function letzteUebergaben(limit = 25): Promise<UebergabeZeile[]> {
  try {
    const zeilen = await db
      .select()
      .from(uebergabenTable)
      .orderBy(desc(uebergabenTable.createdAt))
      .limit(limit);
    return zeilen.map((z) => ({
      helfer: z.helfer,
      herkunft: z.herkunft,
      auftrag: z.auftrag,
      ergebnisZeichen: z.ergebnisZeichen,
      gekuerzt: z.gekuerzt,
      tokens: z.tokens,
      dauerMs: z.dauerMs,
      fehler: z.fehler,
      wann: z.createdAt,
    }));
  } catch (err) {
    logger.debug({ err }, "Übergaben nicht lesbar");
    return [];
  }
}

/**
 * Die Spur als Text, wie Lukas sie liest.
 *
 * Auffaelliges zuerst benennen statt es in einer Tabelle zu verstecken: eine
 * gescheiterte Uebergabe und eine gekuerzte sind die beiden Faelle, wegen
 * derer man ueberhaupt nachsieht.
 */
export async function uebergabenText(limit = 15): Promise<string> {
  const zeilen = await letzteUebergaben(limit);
  if (!zeilen.length) return "Noch keine Übergaben protokolliert.";

  const zeit = (d: Date) =>
    d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return zeilen
    .map((z) => {
      const kopf = `${zeit(z.wann)} · ${z.helfer} ← ${z.herkunft}`;
      const zahlen = `${z.tokens.toLocaleString("de-DE")} Tokens, ${Math.round(z.dauerMs / 1000)} s`;
      if (z.fehler) return `${kopf} — GESCHEITERT: ${z.fehler} (${zahlen})`;
      const kuerzung = z.gekuerzt
        ? `, davon ${z.ergebnisZeichen.toLocaleString("de-DE")} Zeichen GEKÜRZT übergeben`
        : "";
      return `${kopf} — ${zahlen}${kuerzung}\n    Auftrag: ${z.auftrag.slice(0, 160).replace(/\s+/g, " ")}`;
    })
    .join("\n");
}
