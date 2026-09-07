/*
 * Die Verwaltung der Zugangsdaten.
 *
 * Der Kern ist eine Asymmetrie, und die ist der ganze Sinn der Sache:
 *
 *   HINEIN kommt etwas ueber das Dashboard — nur Issa, nur schreibend.
 *   HERAUS kommt es ausschliesslich in den Browser-Container, als
 *   Umgebungsvariable, im Moment der Anmeldung.
 *
 * Es gibt keinen dritten Weg. Kein Werkzeug von Lukas liest hier, keine Route
 * gibt einen Wert zurueck, keine Ansicht zeigt ihn. Wer den API-Token hat,
 * kann Zugaenge ANLEGEN und LOESCHEN — aber nicht auslesen. Das ist der
 * Unterschied zwischen "Lukas hat Zugriff auf meine Konten" und "wer Lukas
 * uebernimmt, hat meine Passwoerter".
 *
 * UMGEBUNGSVARIABLEN BLEIBEN GUELTIG, als Rueckfall. Wer LUKAS_WEB_X_USER
 * schon gesetzt hat, soll nichts umbauen muessen. Die Datenbank hat Vorrang:
 * sie ist der Ort, an dem man etwas aendern kann, ohne neu zu deployen.
 */
import { db } from "@workspace/db";
import { zugaenge, type Zugang } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { entschluessele, verschluessele } from "./tresor";
import { logger } from "./logger";

/** Wie ein Feldname aussehen darf: das, was auch als {{PLATZHALTER}} taugt. */
const FELD_MUSTER = /^[A-Z][A-Z0-9_]{0,31}$/;

export function normalisiereSitzung(roh: string): string {
  return String(roh ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 60);
}

export type ZugangsUebersicht = {
  sitzung: string;
  feld: string;
  /** Wo dieser Wert eingesetzt werden darf. Leer = überall (altes Verhalten). */
  host: string;
  notiz: string;
  zuletztBenutzt: string | null;
  createdAt: string;
};

/**
 * Was es gibt — NIE, was drinsteht.
 *
 * Diese Funktion ist die, die man beim Erweitern versehentlich kaputt macht:
 * ein `...row` beim Zusammenbauen, und der Kryptotext steht in der
 * API-Antwort. Deshalb werden die Felder einzeln aufgezaehlt statt
 * ausgebreitet, und deshalb hat sie einen eigenen Test.
 */
export async function listeZugaenge(): Promise<ZugangsUebersicht[]> {
  const rows = await db.select().from(zugaenge).orderBy(asc(zugaenge.sitzung), asc(zugaenge.feld));
  return rows.map((r) => ({
    sitzung: r.sitzung,
    feld: r.feld,
    host: r.host,
    notiz: r.notiz,
    zuletztBenutzt: r.zuletztBenutzt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Einen Hostnamen normalisieren — aus allem, was Issa eintippen koennte.
 *
 * "https://higgsfield.ai/login" und "Higgsfield.AI" und "higgsfield.ai"
 * meinen dasselbe. Wer hier auf exakter Eingabe besteht, bekommt einen
 * Zugang, der stillschweigend nie greift.
 */
export function hostAus(roh: string): string {
  const knapp = String(roh ?? "").trim().toLowerCase();
  if (!knapp) return "";
  try {
    return new URL(knapp.includes("://") ? knapp : `https://${knapp}`).hostname.replace(/^www\./, "");
  } catch {
    return knapp.replace(/^www\./, "").split("/")[0];
  }
}

export async function setzeZugang(opts: {
  sitzung: string;
  feld: string;
  wert: string;
  host?: string;
  notiz?: string;
}): Promise<ZugangsUebersicht> {
  const sitzung = normalisiereSitzung(opts.sitzung);
  const feld = String(opts.feld ?? "").trim().toUpperCase();
  const wert = String(opts.wert ?? "");

  if (!sitzung) throw new Error("Ohne Sitzungsnamen weiß niemand, wofür der Zugang gilt.");
  if (!FELD_MUSTER.test(feld)) {
    throw new Error(
      `"${feld}" taugt nicht als Feldname. Erlaubt sind Großbuchstaben, Ziffern und _ — ` +
        `genau das, was auch als {{PLATZHALTER}} funktioniert.`,
    );
  }
  if (!wert) throw new Error("Ein leerer Wert ist kein Zugang.");
  /*
   * Fail closed — und zwar an EINER Stelle.
   *
   * Hier stand vorher ein eigener Waechter, der vorab prueft, ob ein
   * Schluessel da ist. Er war ueberfluessig: verschluessele() wirft von sich
   * aus, und zwar mit dem genaueren Grund ("nicht gesetzt" gegenueber "zu
   * kurz" — zwei voellig verschiedene Handgriffe). Zwei Waechter fuer
   * dieselbe Sache sind keine doppelte Sicherheit, sondern eine Stelle, an
   * der spaeter jemand den falschen anfasst und glaubt, der andere fange es
   * schon ab. Die Gegenprobe hat genau das gezeigt: den Vorab-Waechter
   * herauszunehmen aenderte nichts.
   *
   * Es gibt also keinen Weg an der Verschluesselung vorbei — nicht weil hier
   * jemand fragt, sondern weil das Speichern ohne sie gar nicht erst einen
   * Wert erzeugt.
   */
  const geheim = verschluessele(wert);
  const host = hostAus(opts.host ?? "");
  const jetzt = new Date();

  const [row] = await db
    .insert(zugaenge)
    .values({ sitzung, feld, geheim, host, notiz: opts.notiz?.trim() ?? "" })
    .onConflictDoUpdate({
      target: [zugaenge.sitzung, zugaenge.feld],
      set: { geheim, host, notiz: opts.notiz?.trim() ?? "", updatedAt: jetzt },
    })
    .returning();

  // Absichtlich ohne Wert und ohne Kryptotext: das hier landet im Protokoll.
  logger.info({ sitzung, feld }, "Zugang hinterlegt");

  return {
    sitzung: row.sitzung,
    feld: row.feld,
    host: row.host,
    notiz: row.notiz,
    zuletztBenutzt: row.zuletztBenutzt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function loescheZugang(sitzung: string, feld: string): Promise<boolean> {
  const rows = await db
    .delete(zugaenge)
    .where(
      and(
        eq(zugaenge.sitzung, normalisiereSitzung(sitzung)),
        eq(zugaenge.feld, String(feld ?? "").trim().toUpperCase()),
      ),
    )
    .returning();
  if (rows.length > 0) logger.info({ sitzung, feld }, "Zugang gelöscht");
  return rows.length > 0;
}

/*
 * Der einzige Weg nach draussen.
 *
 * Wird ausschliesslich von browser_do aufgerufen, unmittelbar bevor der
 * Container startet. Das Ergebnis geht als Umgebungsvariable dorthin und
 * kommt nie in einen Modellaufruf zurueck.
 *
 * Ein Wert, der sich nicht entschluesseln laesst, wird UEBERGANGEN statt
 * durchgereicht: nach einem Schluesselwechsel steht sonst Muell im
 * Anmeldeformular, und fuenf Fehlversuche sperren ein Konto. Fehlt das Feld,
 * meldet browser_do das ehrlich — das ist die bessere Nachricht.
 */
export type ZugangsWerte = {
  /** Feldname -> Klartext. Geht in den Container, nie in einen Modellaufruf. */
  werte: Record<string, string>;
  /**
   * Feldname -> erlaubter Hostname. Fehlt ein Eintrag, gilt der Wert ueberall
   * (alter Bestand). Der Container setzt NUR ein, was hier passt.
   */
  hosts: Record<string, string>;
};

export async function zugangFuer(sitzung: string): Promise<ZugangsWerte> {
  const name = normalisiereSitzung(sitzung);
  const werte: Record<string, string> = {};
  const hosts: Record<string, string> = {};

  // 1. Umgebung — der alte Weg, bleibt gültig.
  const schluessel = name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const benutzer = process.env[`LUKAS_WEB_${schluessel}_USER`]?.trim();
  const passwort = process.env[`LUKAS_WEB_${schluessel}_PASS`]?.trim();
  if (benutzer) werte.BENUTZER = benutzer;
  if (passwort) werte.PASSWORT = passwort;

  // 2. Datenbank — hat Vorrang, weil sie ohne Deployment änderbar ist.
  let rows: Zugang[] = [];
  try {
    rows = await db.select().from(zugaenge).where(eq(zugaenge.sitzung, name));
  } catch (err) {
    logger.warn({ err, sitzung: name }, "Zugänge nicht lesbar — nur Umgebung");
    return { werte, hosts };
  }

  const benutzt: string[] = [];
  for (const r of rows) {
    try {
      werte[r.feld] = entschluessele(r.geheim);
      if (r.host) hosts[r.feld] = r.host;
      benutzt.push(r.feld);
    } catch (err) {
      logger.warn({ sitzung: name, feld: r.feld }, "Zugang nicht entschlüsselbar — übergangen");
    }
  }

  if (benutzt.length > 0) {
    await db
      .update(zugaenge)
      .set({ zuletztBenutzt: new Date() })
      .where(eq(zugaenge.sitzung, name))
      .catch(() => {});
  }

  return { werte, hosts };
}

/**
 * Welche Felder es für eine Sitzung gibt — die Namen, nie die Werte.
 *
 * Dafür da, dass Lukas eine ehrliche Antwort bekommt statt zu raten: "für
 * higgsfield liegen BENUTZER und PASSWORT bereit" ist etwas anderes als ein
 * fehlgeschlagener Anmeldeversuch, den er sich selbst erklären muss.
 */
export async function verfuegbareFelder(sitzung: string): Promise<string[]> {
  return Object.keys((await zugangFuer(sitzung)).werte).sort();
}
