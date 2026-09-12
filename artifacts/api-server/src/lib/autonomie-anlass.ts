import { db } from "@workspace/db";
import { goalsTable, approvals, meldungen, debugLogTable, autonomieStandTable } from "@workspace/db";
import { eq, inArray, gte, desc } from "drizzle-orm";
import { logger } from "./logger";

/*
 * Muss dieser autonome Lauf ueberhaupt stattfinden?
 *
 * Bisher lief er stur alle 30 Minuten, sobald irgendein Ziel aktiv war — bis
 * zu 48 volle Agentenlaeufe am Tag, jeder mit Seele, Werkzeugen, Erinnerungen
 * und mehreren Runden. Ein grosser Teil davon lief in eine Welt hinein, in der
 * sich seit dem letzten Lauf nichts geaendert hatte: dieselben Ziele, derselbe
 * Stand, dieselben offenen Freigaben. Das kostet jedes Mal denselben Prompt.
 *
 * Hier wird deshalb VOR dem teuren Lauf nachgesehen, ob sich etwas bewegt hat.
 * Die Pruefung selbst sind vier kleine Datenbankabfragen und kostet kein
 * einziges Token.
 *
 * Ausdruecklich KEINE Einschraenkung seiner Autonomie: hat sich nichts bewegt,
 * arbeitet er trotzdem weiter — nur in ruhigerem Takt (Grundtakt, Standard
 * drei Stunden). Passiert etwas, ist er beim naechsten Herzschlag da.
 *
 * Wichtig ist der Zeitpunkt der Momentaufnahme: sie wird NACH dem Lauf
 * genommen. Denn ein Lauf aendert selbst Ziele und schreibt Tagebuch — nimmt
 * man sie davor, loest jeder Lauf den naechsten aus, und man ist wieder bei
 * 48 am Tag.
 */

let letzterLauf = 0;
let letzterStand: string | null = null;
/** Ob der gespeicherte Stand schon aus der Datenbank geholt wurde. */
let geladen = false;

/** Nur fuer Tests. */
export function anlassZuruecksetzen(): void {
  letzterLauf = 0;
  letzterStand = null;
  geladen = false;
}

/*
 * Den Stand aus der Datenbank holen — einmal je Prozessleben.
 *
 * Vorher lag er ausschliesslich im Arbeitsspeicher. Nach jedem Neustart war er
 * leer, und "erster Lauf nach dem Start" loeste sofort einen vollen
 * Agentenlauf aus. An einem Tag mit einem Dutzend Deployments sind das ein
 * Dutzend zusaetzliche Laeufe, jeder mit vollem Prompt und mehreren Runden.
 *
 * Und es blieb nicht dabei: ein Lauf aendert Ziele und schreibt Tagebuch, also
 * war danach auch die Signatur anders — und der naechste regulaere Takt lief
 * ebenfalls. Ein Neustart hat sich so in zwei Laeufe uebersetzt.
 *
 * Ist die Datenbank nicht lesbar, bleibt es beim alten Verhalten: lieber
 * einmal zu viel laufen als gar nicht mehr.
 */
async function ladeStand(): Promise<void> {
  if (geladen) return;
  geladen = true;
  try {
    const [zeile] = await db
      .select()
      .from(autonomieStandTable)
      .orderBy(desc(autonomieStandTable.id))
      .limit(1);
    if (zeile?.letzterLauf) {
      letzterLauf = new Date(zeile.letzterLauf).getTime();
      letzterStand = zeile.stand ?? null;
    }
  } catch (err) {
    logger.warn({ err }, "Autonomie-Stand nicht lesbar — der nächste Lauf startet regulär");
  }
}

function minuten(name: string, standard: number): number {
  const wert = Number(process.env[name] ?? standard);
  return Number.isFinite(wert) && wert > 0 ? wert : standard;
}

/**
 * Ein Fingerabdruck dessen, was Lukas' Arbeit beeinflusst. Aendert er sich,
 * ist etwas passiert, das einen Lauf verdient.
 */
async function weltbild(): Promise<{ signatur: string; teile: Record<string, string> }> {
  const [ziele, freigaben, meldungenRows] = await Promise.all([
    db.select().from(goalsTable).where(eq(goalsTable.status, "active")),
    db.select().from(approvals).where(inArray(approvals.status, ["pending", "allowed"])),
    db.select().from(meldungen).where(eq(meldungen.status, "erledigt")),
  ]);

  const teile = {
    ziele: (ziele as any[])
      .map((g) => `${g.id}:${g.progress}:${new Date(g.updatedAt).getTime()}`)
      .sort()
      .join("|"),
    freigaben: (freigaben as any[])
      .map((a) => `${a.id}:${a.status}`)
      .sort()
      .join("|"),
    // Beantwortete, aber von Lukas noch nicht gelesene Meldungen: genau darauf
    // hat er gewartet.
    antworten: (meldungenRows as any[])
      .filter((m) => m.antwort && !m.gelesen)
      .map((m) => String(m.id))
      .sort()
      .join("|"),
  };

  return { signatur: JSON.stringify(teile), teile };
}

/** Haeufen sich seit dem letzten Lauf Fehler? Drei sind kein Ausrutscher mehr. */
async function neueFehler(seit: Date): Promise<number> {
  const zeilen = await db.select().from(debugLogTable).where(gte(debugLogTable.createdAt, seit));
  /*
   * Nach Art zusammengefasst, nicht gezaehlt. Der Anfang der Meldung reicht
   * als Unterscheidung — "SSH zum Droplet …" bleibt derselbe Text, egal wie
   * oft er auftritt.
   */
  const arten = new Set(
    (zeilen as any[]).map((z) => `${z.scope}:${String(z.message ?? "").slice(0, 60)}`),
  );
  return arten.size;
}

export async function anlass(): Promise<{ starten: boolean; grund: string }> {
  await ladeStand();
  const jetzt = Date.now();
  /*
   * Der Grundtakt darf nicht kuerzer sein als der Herzschlag.
   *
   * Nachgesehen wird nur beim Herzschlag (LUKAS_AUTONOMY_INTERVAL_MIN,
   * autonomy.ts). Steht der Grundtakt darunter, ist er wirkungslos: er waere
   * laengst faellig, wenn ueberhaupt das naechste Mal geschaut wird. Genau das
   * ist passiert, als der Herzschlag von 30 auf 270 Minuten ging und hier 180
   * stehen blieb — eine Drei-Stunden-Regel, die nie greifen konnte.
   *
   * Beide Voreinstellungen stehen deshalb auf 270: ohne Anlass arbeitet er
   * bei jedem Herzschlag weiter, mit Anlass frueher.
   */
  const grundtakt = minuten("LUKAS_AUTONOMY_MIN_PAUSE_MIN", 270) * 60 * 1000;

  const { signatur } = await weltbild();

  /*
   * Kein gespeicherter Stand: dann laufen.
   *
   * Frueher hiess das "nach jedem Neustart", denn der Stand lag im
   * Arbeitsspeicher — ein Deploy loeste damit sofort einen vollen Agentenlauf
   * aus. Seit er in der Datenbank steht, heisst es nur noch: wirklich noch nie
   * gelaufen, oder das Weltbild war nach dem letzten Lauf nicht lesbar.
   *
   * Im zweiten Fall ist Laufen die richtige Antwort — dann ist ohnehin etwas
   * nicht in Ordnung, und lieber einmal zu viel als nie wieder.
   *
   * (Eine zusaetzliche Pruefung auf letzterLauf === 0 stand hier kurz. Sie war
   * ueberfluessig: die Signaturpruefung unten faengt denselben Fall, und die
   * Gegenprobe hat gezeigt, dass ihr Entfernen nichts aendert. Zwei Waechter
   * fuer dieselbe Sache sind keine doppelte Sicherheit.)
   */
  if (letzterStand === null) {
    return { starten: true, grund: "kein gespeicherter Stand — erster Lauf" };
  }

  if (signatur !== letzterStand) {
    return { starten: true, grund: "es hat sich etwas bewegt (Ziele, Freigaben oder eine Antwort von Issa)" };
  }

  /*
   * Neue Fehler sind ein Anlass — aber nur VERSCHIEDENE.
   *
   * Der Droplet war einen Tag lang tot. Damit entstand bei jedem Werkzeug
   * derselbe Fehler, dutzendfach, und die Schwelle von drei war zu jedem
   * Zeitpunkt gerissen. Die Leerlaufbremse war damit den ganzen Tag
   * wirkungslos: jeder 30-Minuten-Takt lief, und jeder Lauf erzeugte beim
   * Scheitern neue Fehler fuer den naechsten. Eine Rueckkopplung, die sich
   * selbst am Leben haelt.
   *
   * Gezaehlt werden jetzt unterschiedliche Fehlerarten. Dreissig Mal dasselbe
   * ist EIN Problem, kein Grund fuer dreissig Laeufe — und wenn es wirklich
   * eines ist, kuemmert sich die Selbstheilung darum.
   */
  const fehler = await neueFehler(new Date(letzterLauf));
  if (fehler >= 3) {
    return { starten: true, grund: `${fehler} verschiedene neue Fehler seit dem letzten Lauf` };
  }

  if (jetzt - letzterLauf >= grundtakt) {
    return { starten: true, grund: "Grundtakt — auch ohne Anlass wird weitergearbeitet" };
  }

  const restMinuten = Math.ceil((grundtakt - (jetzt - letzterLauf)) / 60000);
  return {
    starten: false,
    grund: `nichts bewegt, nächster Grundtakt in ${restMinuten} min`,
  };
}

/**
 * Nach dem Lauf aufrufen — nicht davor. Siehe Kopf der Datei: sonst loest
 * jeder Lauf den naechsten aus.
 */
export async function laufNotiert(): Promise<void> {
  letzterLauf = Date.now();
  try {
    letzterStand = (await weltbild()).signatur;
  } catch (err) {
    // Lieber einmal zu viel laufen als nie wieder: bleibt der Stand leer,
    // startet der naechste Durchgang regulaer.
    logger.warn({ err }, "Weltbild nach dem Lauf nicht lesbar");
    letzterStand = null;
  }

  /*
   * Und dauerhaft ablegen, damit der naechste Neustart nicht wieder bei null
   * anfaengt. Genau EINE Zeile, die fortgeschrieben wird — der Zustand von
   * jetzt, nicht seine Geschichte.
   */
  try {
    const [vorhanden] = await db
      .select()
      .from(autonomieStandTable)
      .orderBy(desc(autonomieStandTable.id))
      .limit(1);
    const werte = { letzterLauf: new Date(letzterLauf), stand: letzterStand, updatedAt: new Date() };
    if (vorhanden) {
      await db.update(autonomieStandTable).set(werte).where(eq(autonomieStandTable.id, vorhanden.id));
    } else {
      await db.insert(autonomieStandTable).values(werte);
    }
  } catch (err) {
    logger.warn({ err }, "Autonomie-Stand nicht speicherbar");
  }
}
