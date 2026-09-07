/*
 * Papierhandel: Entscheidungen mit Protokoll, ohne Geld.
 *
 * WOZU. Issa hat laufende Trading-Bots, und Lukas darf sie bisher nur ansehen.
 * Bevor irgendwann echtes Geld im Spiel ist, soll eine Zahl entstehen statt
 * einer Meinung: wie oft lag er richtig, bei welcher Art Markt, und wo nicht.
 * Vier Wochen Protokoll beantworten das; ein Bauchgefuehl nicht.
 *
 * DIE EIGENTLICHE ARBEIT HIER ist nicht die Gewinnrechnung — die ist Schulstoff
 * — sondern die Faelschungssicherheit gegen den eigenen Optimismus. Ein
 * Papierprotokoll, das der Fuehrende nachtraeglich schoenen kann, ist
 * schlimmer als keins: es sieht aus wie Evidenz.
 *
 * Deshalb vier Regeln, und jede davon steckt im Code, nicht im Prompt:
 *
 *  1. DER KURS KOMMT NICHT VOM MODELL. eroeffne() nimmt keinen Preis
 *     entgegen, sondern eine URL und einen Pfad — und holt selbst. Ein
 *     Modell, das seinen Einstieg tippen darf, tippt irgendwann den
 *     guenstigen, ohne es zu merken und ohne zu luegen.
 *  2. KEINE RUECKDATIERUNG. Eroeffnungs- und Schlusszeit sind Serverzeit.
 *  3. ERWARTUNG UND FRIST VORHER. Ohne "X bis Y" laesst sich jeder Ausgang
 *     hinterher als halber Erfolg erzaehlen.
 *  4. NICHTS WIRD UEBERSCHRIEBEN. Der Grund von damals bleibt stehen; was
 *     beim Schliessen dazukommt, steht daneben.
 *
 * Und eine fuenfte, die nicht die Ehrlichkeit schuetzt, sondern den Betrieb:
 * deterministische Grenzen fuer offene Positionen und Neueroeffnungen pro Tag.
 * Das Werkzeug laeuft auf R1, also unbeaufsichtigt — genau das macht ein
 * Vierwochenprotokoll ueberhaupt moeglich, und genau deshalb braucht es eine
 * Grenze, die nicht aus einer Bitte besteht.
 */
import { db } from "@workspace/db";
import { papierhandelTable } from "@workspace/db";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { logger } from "./logger";
import { sicherFetch } from "./netzschutz";
import { herkunft } from "./zug";

/*
 * Die Grenzen als Funktion, nicht als Konstante — wie TOKEN_BUDGET in
 * arbeitsschleife.ts. Eine Konstante wird beim Import gelesen; sie liesse
 * sich weder in einer Pruefung variieren noch im Betrieb nachziehen, ohne
 * den Prozess neu zu starten.
 */

/** Wie viele Positionen gleichzeitig offen sein duerfen. */
const MAX_OFFEN = () => Number(process.env.LUKAS_PAPIER_MAX_OFFEN ?? 12);

/** Wie viele je Tag neu eroeffnet werden duerfen. */
const MAX_JE_TAG = () => Number(process.env.LUKAS_PAPIER_MAX_TAG ?? 6);

/** Wie viel vom Rohtext als Beleg gespeichert wird. */
const BELEG_ZEICHEN = 400;

export type Art = "binaer" | "preis";

/**
 * Einen Wert aus verschachteltem JSON holen.
 *
 * Pfad mit Punkten, Zahlen sind Feldindizes: "0.outcomePrices.1". Bewusst
 * primitiv gehalten — es soll durchschaubar bleiben, was geholt wurde, und
 * ein Pfad, der ins Leere zeigt, soll LAUT scheitern statt still undefined
 * zu liefern. Ein stiller Fehlgriff waere hier ein erfundener Kurs.
 */
export function ausPfad(daten: unknown, pfad: string): unknown {
  let aktuell: unknown = daten;
  for (const teil of pfad.split(".").filter(Boolean)) {
    if (aktuell === null || aktuell === undefined) {
      throw new Error(`Der Pfad "${pfad}" endet vorzeitig — bei "${teil}" ist nichts mehr da.`);
    }
    if (Array.isArray(aktuell)) {
      const i = Number(teil);
      if (!Number.isInteger(i)) {
        throw new Error(`"${teil}" ist kein Index, aber an dieser Stelle steht eine Liste.`);
      }
      aktuell = aktuell[i];
    } else if (typeof aktuell === "object") {
      aktuell = (aktuell as Record<string, unknown>)[teil];
    } else {
      throw new Error(
        `Der Pfad "${pfad}" geht bei "${teil}" weiter, aber dort steht schon ein einfacher Wert.`,
      );
    }
  }
  return aktuell;
}

/**
 * Aus dem gefundenen Wert eine Zahl machen — oder deutlich scheitern.
 *
 * Polymarket liefert Preise als Zeichenketten ("0.42"), teils als Liste in
 * einer Zeichenkette. Beides wird angenommen; alles andere nicht. Es gibt
 * hier absichtlich KEINEN Rueckfall auf 0 oder 0.5: ein Kurs, den man nicht
 * lesen konnte, ist kein Kurs.
 */
export function alsKurs(wert: unknown): number {
  if (typeof wert === "number" && Number.isFinite(wert)) return wert;
  if (typeof wert === "string") {
    const t = wert.trim();
    const zahl = Number(t);
    if (Number.isFinite(zahl)) return zahl;
    throw new Error(`"${t.slice(0, 60)}" ist keine Zahl. Zeigt der Pfad auf das richtige Feld?`);
  }
  throw new Error(
    `An dieser Stelle steht ${wert === undefined ? "nichts" : typeof wert} statt einer Zahl. ` +
      `Sieh dir die Antwort mit fetch_url an und korrigiere den Pfad.`,
  );
}

export type Kursabruf = { kurs: number; beleg: string };

/**
 * Den Kurs holen. Der Server, nicht das Modell.
 *
 * Der Beleg ist kein Beiwerk: er ist der Grund, warum dem Protokoll spaeter
 * zu trauen ist. Ohne ihn stuende dort eine Zahl, deren Herkunft niemand mehr
 * pruefen kann.
 */
export async function holeKurs(quelle: string, pfad: string): Promise<Kursabruf> {
  const antwort = await sicherFetch(quelle, { headers: { accept: "application/json" } });
  if (!antwort.ok) {
    throw new Error(`${quelle} antwortet mit HTTP ${antwort.status}. Kein Kurs, keine Position.`);
  }
  const roh = await antwort.text();
  let daten: unknown;
  try {
    daten = JSON.parse(roh);
  } catch {
    throw new Error(
      `${quelle} liefert kein JSON. Der Papierhandel braucht eine Datenquelle, keine Webseite — ` +
        `bei Polymarket z.B. gamma-api.polymarket.com.`,
    );
  }
  const kurs = alsKurs(ausPfad(daten, pfad));
  return { kurs, beleg: roh.slice(0, BELEG_ZEICHEN) };
}

/**
 * Der wirksame Einstiegspreis fuer die Richtung.
 *
 * Bei einem binaeren Markt kostet "nein" genau das, was "ja" nicht kostet.
 * Diese eine Zeile ist der Unterschied zwischen einer richtigen und einer
 * spiegelverkehrten Gewinnrechnung.
 */
function wirksam(kurs: number, art: Art, richtung: string): number {
  if (art !== "binaer") return kurs;
  return richtung === "nein" ? 1 - kurs : kurs;
}

/**
 * Gewinn oder Verlust in Cent.
 *
 * binaer: Man kauft Anteile zum wirksamen Preis; jeder Anteil ist am Ende den
 *   dann wirksamen Preis wert. shares = Einsatz / Preis, Wert = shares * Kurs.
 * preis:  Reine Kursbewegung, mit Vorzeichen nach Richtung.
 */
export function pnl(opts: {
  art: Art;
  richtung: string;
  einsatzCent: number;
  einstieg: number;
  ausstieg: number;
}): number {
  const { art, richtung, einsatzCent, einstieg, ausstieg } = opts;
  if (art === "binaer") {
    const ein = wirksam(einstieg, art, richtung);
    const aus = wirksam(ausstieg, art, richtung);
    if (ein <= 0) {
      // Ein Einstieg bei 0 hiesse unendlich viele Anteile. Das ist kein Trade,
      // das ist ein kaputter Kurs — und er darf keine Traumrendite erzeugen.
      throw new Error("Einstiegskurs 0 — daraus lässt sich kein Ergebnis rechnen.");
    }
    const anteile = einsatzCent / ein;
    return Math.round(anteile * aus - einsatzCent);
  }
  if (einstieg <= 0) throw new Error("Einstiegskurs 0 — daraus lässt sich kein Ergebnis rechnen.");
  const richtungsfaktor = richtung === "short" ? -1 : 1;
  return Math.round((einsatzCent * richtungsfaktor * (ausstieg - einstieg)) / einstieg);
}

function heuteBeginn(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function eroeffne(opts: {
  markt: string;
  art: Art;
  richtung: string;
  einsatzCent: number;
  quelle: string;
  kursPfad: string;
  grund: string;
  erwartung: string;
  fristStunden: number;
}): Promise<string> {
  const richtungOk =
    opts.art === "binaer"
      ? ["ja", "nein"].includes(opts.richtung)
      : ["long", "short"].includes(opts.richtung);
  if (!richtungOk) {
    throw new Error(
      `Richtung "${opts.richtung}" passt nicht zu "${opts.art}". ` +
        `binaer nimmt ja/nein, preis nimmt long/short.`,
    );
  }
  if (!opts.grund.trim() || !opts.erwartung.trim()) {
    throw new Error(
      "Ohne Grund und Erwartung wird nichts eröffnet. Genau die beiden Felder machen das " +
        "Protokoll später auswertbar — eine Position ohne sie ist eine Zahl ohne Aussage.",
    );
  }
  if (!(opts.fristStunden > 0)) {
    throw new Error(
      "Jede Position braucht eine Frist. Ohne sie bleibt sie ewig offen und wird nie zum Befund.",
    );
  }
  if (!Number.isInteger(opts.einsatzCent) || opts.einsatzCent <= 0) {
    throw new Error("Der gedachte Einsatz muss eine positive Zahl in Cent sein.");
  }

  const offene = await db
    .select()
    .from(papierhandelTable)
    .where(eq(papierhandelTable.status, "offen"));
  if (offene.length >= MAX_OFFEN()) {
    throw new Error(
      `Es sind schon ${offene.length} Positionen offen (Grenze ${MAX_OFFEN()}). Schließ erst welche ` +
        `— zehn offene Wetten sind kein Protokoll mehr, sondern ein Streuschuss.`,
    );
  }

  const heute = await db
    .select()
    .from(papierhandelTable)
    .where(gte(papierhandelTable.eroeffnetAm, heuteBeginn()));
  if (heute.length >= MAX_JE_TAG()) {
    throw new Error(
      `Heute wurden schon ${heute.length} Positionen eröffnet (Grenze ${MAX_JE_TAG()}). Morgen weiter.`,
    );
  }

  const { kurs, beleg } = await holeKurs(opts.quelle, opts.kursPfad);
  if (opts.art === "binaer" && (kurs <= 0 || kurs >= 1)) {
    throw new Error(
      `Der geholte Kurs ist ${kurs} — bei einem binären Markt muss er zwischen 0 und 1 liegen. ` +
        `Zeigt der Pfad wirklich auf den Preis?`,
    );
  }

  const frist = new Date(Date.now() + opts.fristStunden * 3600_000);
  const [zeile] = await db
    .insert(papierhandelTable)
    .values({
      markt: opts.markt.slice(0, 300),
      art: opts.art,
      richtung: opts.richtung,
      einsatzCent: opts.einsatzCent,
      quelle: opts.quelle,
      kursPfad: opts.kursPfad,
      einstieg: kurs,
      einstiegBeleg: beleg,
      grund: opts.grund.trim(),
      erwartung: opts.erwartung.trim(),
      fristBis: frist,
      herkunft: herkunft(),
    })
    .returning();

  logger.info({ id: zeile.id, markt: opts.markt, kurs }, "Papierposition eröffnet");
  return (
    `Papierposition #${zeile.id} steht: ${opts.markt} — ${opts.richtung} zu ${kurs}, ` +
    `gedachter Einsatz ${(opts.einsatzCent / 100).toFixed(2)}.\n` +
    `Frist: ${frist.toLocaleString("de-DE")}.\n\n` +
    `Der Kurs wurde von ${opts.quelle} geholt, nicht von dir gesetzt — deshalb zählt er später. ` +
    `Grund und Erwartung stehen jetzt fest und lassen sich nicht mehr ändern; das ist der ` +
    `Sinn der Sache.`
  );
}

export async function schliesse(id: number, ergebnis: string): Promise<string> {
  const [zeile] = await db.select().from(papierhandelTable).where(eq(papierhandelTable.id, id));
  if (!zeile) throw new Error(`Position #${id} gibt es nicht.`);
  if (zeile.status !== "offen") {
    /*
     * Kein zweites Schliessen. Sonst liesse sich ein Verlust durch einen
     * spaeteren, guenstigeren Kurs ueberschreiben — und genau das ist die
     * Sorte Schoenung, gegen die dieses ganze Modul gebaut ist.
     */
    throw new Error(
      `Position #${id} ist bereits ${zeile.status} (PnL ${((zeile.pnlCent ?? 0) / 100).toFixed(2)}). ` +
        `Sie lässt sich nicht erneut schließen.`,
    );
  }
  if (!ergebnis.trim()) {
    throw new Error(
      "Sag beim Schließen, was passiert ist und ob deine Erwartung eingetreten ist. Ohne das " +
        "ist es nur eine Zahl, aus der niemand etwas lernt.",
    );
  }

  const { kurs, beleg } = await holeKurs(zeile.quelle, zeile.kursPfad);
  const gewinn = pnl({
    art: zeile.art as Art,
    richtung: zeile.richtung,
    einsatzCent: zeile.einsatzCent,
    einstieg: zeile.einstieg,
    ausstieg: kurs,
  });

  await db
    .update(papierhandelTable)
    .set({
      status: "geschlossen",
      ausstieg: kurs,
      ausstiegBeleg: beleg,
      pnlCent: gewinn,
      ergebnis: ergebnis.trim(),
      geschlossenAm: new Date(),
    })
    .where(eq(papierhandelTable.id, id));

  const spaet = Date.now() > new Date(zeile.fristBis).getTime();
  return (
    `Position #${id} geschlossen: ${zeile.einstieg} → ${kurs}, ` +
    `${gewinn >= 0 ? "+" : ""}${(gewinn / 100).toFixed(2)}.\n` +
    `Deine Erwartung war: "${zeile.erwartung}"\n` +
    (spaet ? `Die Frist war schon abgelaufen — das zählt für die Auswertung mit.\n` : "") +
    `\nDer Ausstiegskurs kam wieder von ${zeile.quelle}.`
  );
}

/**
 * Ueberfaellige Positionen als verfallen markieren.
 *
 * NICHT als Aufraeumen gedacht, sondern als Gegengewicht: eine Position, die
 * schlecht laeuft, wird sonst einfach nicht mehr erwaehnt. Der Status setzt
 * sich von selbst, ohne dass jemand ihn ausspricht.
 */
export async function markiereVerfallene(): Promise<number> {
  const faellig = await db
    .select()
    .from(papierhandelTable)
    .where(and(eq(papierhandelTable.status, "offen"), lt(papierhandelTable.fristBis, new Date())));
  for (const z of faellig) {
    await db
      .update(papierhandelTable)
      .set({ status: "verfallen" })
      .where(eq(papierhandelTable.id, z.id));
  }
  return faellig.length;
}

export async function stand(): Promise<string> {
  await markiereVerfallene();
  const zeilen = await db
    .select()
    .from(papierhandelTable)
    .orderBy(desc(papierhandelTable.eroeffnetAm))
    .limit(60);

  if (!zeilen.length) {
    return (
      "Noch keine Papierposition. Das ist kein Versäumnis — eine Position ohne Grund wäre " +
      "schlechter als keine."
    );
  }

  const geschlossen = zeilen.filter((z) => z.status === "geschlossen");
  const offen = zeilen.filter((z) => z.status === "offen");
  const verfallen = zeilen.filter((z) => z.status === "verfallen");
  const summe = geschlossen.reduce((n, z) => n + (z.pnlCent ?? 0), 0);
  const treffer = geschlossen.filter((z) => (z.pnlCent ?? 0) > 0).length;
  const eingesetzt = geschlossen.reduce((n, z) => n + z.einsatzCent, 0);

  const zeile = (z: (typeof zeilen)[number]) => {
    const kopf = `#${z.id} ${z.markt.slice(0, 70)} — ${z.richtung} @ ${z.einstieg}`;
    if (z.status === "geschlossen") {
      const p = z.pnlCent ?? 0;
      return `${kopf} → ${z.ausstieg}: ${p >= 0 ? "+" : ""}${(p / 100).toFixed(2)}`;
    }
    if (z.status === "verfallen") {
      return `${kopf} — FRIST ABGELAUFEN, nie geschlossen. Erwartet war: "${z.erwartung.slice(0, 90)}"`;
    }
    const restH = Math.round((new Date(z.fristBis).getTime() - Date.now()) / 3600_000);
    return `${kopf} — offen, noch ${restH} h`;
  };

  const teile: string[] = [];
  teile.push(
    `PAPIERHANDEL — ${geschlossen.length} geschlossen, ${offen.length} offen, ` +
      `${verfallen.length} verfallen.`,
  );
  if (geschlossen.length) {
    teile.push(
      `Ergebnis der geschlossenen: ${summe >= 0 ? "+" : ""}${(summe / 100).toFixed(2)} auf ` +
        `${(eingesetzt / 100).toFixed(2)} Einsatz (${treffer} von ${geschlossen.length} im Plus).`,
    );
    /*
     * Die Warnung gehoert hierhin, nicht in eine Fussnote. Bei kleinen Zahlen
     * ist eine Trefferquote reines Rauschen — und genau daraus wird sonst
     * "ich liege richtig" statt "ich weiss es noch nicht".
     */
    if (geschlossen.length < 20) {
      teile.push(
        `ACHTUNG: ${geschlossen.length} geschlossene Positionen sind zu wenig für eine Aussage. ` +
          `Bei so kleinen Zahlen ist eine Trefferquote Zufall, kein Können. Sag das dazu, wenn ` +
          `Issa danach fragt.`,
      );
    }
  }
  if (verfallen.length) {
    teile.push(
      `${verfallen.length} Position(en) sind über die Frist gelaufen, ohne geschlossen zu werden. ` +
        `Das zählt wie ein Fehlschlag — eine Wette, die man nicht auflöst, hat man nicht gewonnen.`,
    );
  }
  teile.push("", ...zeilen.map(zeile));
  return teile.join("\n");
}
