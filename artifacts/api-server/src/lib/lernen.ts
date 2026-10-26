/*
 * Lernen aus dem, was tatsaechlich passiert ist.
 *
 * WAS ES VORHER GAB. Eine geschlossene Schleife — aber nur fuer Moltbook:
 * recordAction schreibt eine Aktion mit Strategie, recordActionOutcome traegt
 * nach, ob eine Antwort kam, evaluateStrategies rechnet daraus Erfolgsraten,
 * und der Moltbook-Worker liest sie beim naechsten Mal zurueck. Das ist
 * richtiges Lernen: Handeln, Ergebnis messen, Verhalten aendern.
 *
 * WAS GEFEHLT HAT. Alles andere. Es gibt genau vier Aktionsarten (comment,
 * post, reply, upvote), und der Erfolgsbegriff besteht aus Antwortquote und
 * Engagement. Lukas klickt sich durch Seiten, fuehrt Befehle aus, sucht,
 * liest Repositories, schlaegt Code vor — und erfaehrt nie, ob das gerade
 * funktioniert hat. Beim naechsten Mal probiert er dasselbe wieder.
 *
 * WAS HIER STEHT. Dieselbe Schleife, nur allgemein. Drei Regeln, die sie von
 * einem Notizzettel unterscheiden:
 *
 *  1. SIE KOSTET NICHTS. Kein Modellaufruf. Der Ausgang eines Werkzeugs faellt
 *     ohnehin an; er wird nur nicht mehr weggeworfen. Eine Lehre, fuer die
 *     erst ein Modell nachdenken muss, wird beim Sparen als Erstes gestrichen
 *     — und dann lernt er wieder nichts.
 *  2. SIE KANN SICH NICHTS AUSDENKEN. Gespeichert wird, was passiert ist:
 *     Werkzeug, Kontext, gelungen ja/nein, erste Zeile des Fehlers. Keine
 *     Deutung, die spaeter als Tatsache gelesen wird.
 *  3. SIE MUSS ETWAS AENDERN. Eine Erfahrung, die nur in einer Tabelle liegt,
 *     ist kein Lernen. Deshalb geht das Ergebnis in den System-Prompt zurueck
 *     — und zwar nur dort, wo es etwas aendert (siehe lehrenText()).
 *
 * WAS DER KONTEXT IST. "browser_do ist dreimal gescheitert" hilft niemandem.
 * "browser_do auf higgsfield.ai ist dreimal gescheitert, immer an
 * 'Knopf nicht gefunden'" ist eine Erfahrung, aus der etwas folgt. Der
 * Kontext kommt deshalb aus den Argumenten: Domain, Repository, das erste
 * Wort eines Befehls.
 */
import { db } from "@workspace/db";
import { erfahrungenTable, type Erfahrung } from "@workspace/db";
import { and, desc, eq, gte } from "drizzle-orm";
import { logger } from "./logger";

/*
 * Woran wurde gearbeitet?
 *
 * Absichtlich grob. Eine URL mit Pfad und Parametern waere fuer jede Seite ein
 * eigener Schluessel — dann gibt es nie zwei Erfahrungen zum selben Ding und
 * damit nie eine Lehre. Die Domain ist die Ebene, auf der sich etwas
 * wiederholt: dieselbe Seite verhaelt sich morgen wie heute.
 */
export function kontextAus(werkzeug: string, eingabe: Record<string, unknown>): string {
  const domain = (wert: unknown): string => {
    if (typeof wert !== "string") return "";
    try {
      return new URL(wert).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };

  if (werkzeug === "browser_do") return String(eingabe.sitzung ?? "").slice(0, 60);
  if (werkzeug === "browse_page" || werkzeug === "fetch_url") return domain(eingabe.url);
  if (werkzeug.startsWith("github_")) return String(eingabe.repo ?? eingabe.owner ?? "").slice(0, 60);
  if (werkzeug === "execute_command" || werkzeug === "execute_on_host") {
    // Nur das Programm, nicht die Argumente: "npm" wiederholt sich, "npm run
    // build --workspace=x" nicht.
    return String(eingabe.command ?? "").trim().split(/\s+/)[0]?.slice(0, 40) ?? "";
  }
  if (werkzeug === "send_sms" || werkzeug === "ruf_an") return "";
  if (werkzeug === "email_send") return domain(`mailto://${String(eingabe.to ?? "")}`) || "";
  if (werkzeug.startsWith("mcp__")) {
    const rest = werkzeug.slice("mcp__".length);
    const sep = rest.indexOf("__");
    return sep > 0 ? rest.slice(0, sep) : "";
  }
  return "";
}

/*
 * Ist dieses Werkzeugergebnis ein Misserfolg?
 *
 * Heikel, weil ein Werkzeug beides kann: werfen (dann ist es klar) ODER einen
 * Text zurueckgeben, in dem der Fehlschlag steht. "Die Seite liess sich nicht
 * bedienen: …" ist eine ganz normale Rueckgabe — und trotzdem ein
 * Misserfolg. Ohne diesen zweiten Fall waere die Erfolgsrate durchgehend bei
 * 100 %, und gelernt wuerde nichts.
 *
 * Bewusst konservativ: im Zweifel gilt es als gelungen. Ein falsches
 * "gescheitert" waere schlimmer als ein verpasstes — es wuerde Lukas von etwas
 * abbringen, das funktioniert.
 */
import { istMisserfolg } from "./werkzeug-ergebnis";
export { istMisserfolg } from "./werkzeug-ergebnis";

/** Die erste Zeile des Grundes — mehr passt in keine Lehre. */
function grundAus(ergebnis: string): string {
  return ergebnis.trim().split("\n")[0]?.slice(0, 200) ?? "";
}

/**
 * Eine Erfahrung ablegen. Wird nach JEDEM Werkzeugaufruf gerufen und darf
 * deshalb niemals werfen: ein Fehler beim Lernen darf den Zug nicht kippen.
 */
export async function merkeErfahrung(input: {
  werkzeug: string;
  eingabe: Record<string, unknown>;
  ergebnis: string;
  gelungen?: boolean;
  conversationId?: number;
  episodeId?: number;
}): Promise<void> {
  try {
    const gelungen = input.gelungen ?? !istMisserfolg(input.ergebnis);
    await db.insert(erfahrungenTable).values({
      werkzeug: input.werkzeug.slice(0, 80),
      kontext: kontextAus(input.werkzeug, input.eingabe),
      gelungen,
      grund: gelungen ? "" : grundAus(input.ergebnis),
      conversationId: input.conversationId ?? null,
      episodeId: input.episodeId ?? null,
    });
  } catch (err) {
    logger.debug({ err, werkzeug: input.werkzeug }, "Erfahrung nicht abgelegt");
  }
}

export type Lehre = {
  werkzeug: string;
  kontext: string;
  versuche: number;
  gelungen: number;
  quote: number;
  haeufigsterGrund: string;
};

/*
 * Ab wann ist etwas eine Lehre?
 *
 * Nicht nach dem ersten Fehlschlag. Einmal gescheitert heisst: es war
 * vielleicht ein schlechter Moment. Ab DREI Versuchen an derselben Sache
 * beginnt ein Muster, und erst dann lohnt es, den Platz im Prompt dafuer
 * auszugeben.
 *
 * Und nur, wenn die Quote wirklich schlecht ist. Was ueberwiegend
 * funktioniert, muss niemandem gesagt werden — es waere Rauschen, das die
 * echten Warnungen begraebt.
 */
const MINDESTVERSUCHE = 3;
const SCHLECHTE_QUOTE = 0.5;
const FENSTER_TAGE = 30;

/**
 * Was Lukas ueber seine eigenen Versuche weiss — aggregiert, nicht erzaehlt.
 *
 * Nur Misslungenes kommt zurueck. Eine Liste dessen, was klappt, waere im
 * Prompt vor allem lang: er merkt selbst, dass etwas funktioniert, wenn es
 * funktioniert.
 */
/*
 * Die Zaehlung passiert in TypeScript, nicht in SQL.
 *
 * Mit GROUP BY, HAVING und mode() within group waere das eine Zeile weniger
 * und deutlich schneller — aber auch nicht mehr pruefbar: eine Attrappe kann
 * kein Postgres-Aggregat ausfuehren, und genau an dieser Rechnung haengt, was
 * Lukas ueber sich selbst erfaehrt. Bei ein paar tausend Zeilen im Monat ist
 * der Unterschied ohnehin nicht messbar; die Obergrenze unten deckelt es.
 */
const HOECHSTENS_ZEILEN = 4000;

function fasseZusammen(zeilen: Array<Pick<Erfahrung, "werkzeug" | "kontext" | "gelungen" | "grund">>): Lehre[] {
  const nach = new Map<string, { werkzeug: string; kontext: string; versuche: number; gelungen: number; gruende: Map<string, number> }>();

  for (const z of zeilen) {
    const schluessel = `${z.werkzeug}\u0000${z.kontext}`;
    const eintrag = nach.get(schluessel) ?? {
      werkzeug: z.werkzeug,
      kontext: z.kontext,
      versuche: 0,
      gelungen: 0,
      gruende: new Map<string, number>(),
    };
    eintrag.versuche++;
    if (z.gelungen) eintrag.gelungen++;
    else if (z.grund) eintrag.gruende.set(z.grund, (eintrag.gruende.get(z.grund) ?? 0) + 1);
    nach.set(schluessel, eintrag);
  }

  return [...nach.values()].map((e) => {
    let haeufigsterGrund = "";
    let hoechste = 0;
    for (const [grund, anzahl] of e.gruende) {
      if (anzahl > hoechste) {
        hoechste = anzahl;
        haeufigsterGrund = grund;
      }
    }
    return {
      werkzeug: e.werkzeug,
      kontext: e.kontext,
      versuche: e.versuche,
      gelungen: e.gelungen,
      quote: e.versuche > 0 ? e.gelungen / e.versuche : 1,
      haeufigsterGrund,
    };
  });
}

/**
 * Was Lukas ueber seine eigenen Versuche weiss — aggregiert, nicht erzaehlt.
 *
 * Nur Misslungenes kommt zurueck. Eine Liste dessen, was klappt, waere im
 * Prompt vor allem lang: er merkt selbst, dass etwas funktioniert, wenn es
 * funktioniert.
 */
export async function schlechteLehren(grenze = 8): Promise<Lehre[]> {
  const seit = new Date(Date.now() - FENSTER_TAGE * 24 * 3600 * 1000);
  const zeilen = await db
    .select({
      werkzeug: erfahrungenTable.werkzeug,
      kontext: erfahrungenTable.kontext,
      gelungen: erfahrungenTable.gelungen,
      grund: erfahrungenTable.grund,
    })
    .from(erfahrungenTable)
    .where(gte(erfahrungenTable.createdAt, seit))
    .limit(HOECHSTENS_ZEILEN);

  return fasseZusammen(zeilen)
    .filter((l) => l.versuche >= MINDESTVERSUCHE && l.quote < SCHLECHTE_QUOTE)
    .sort((a, b) => a.quote - b.quote || b.versuche - a.versuche)
    .slice(0, grenze);
}

/**
 * Der Block fuer den System-Prompt.
 *
 * Formuliert als das, was es ist: eine Zaehlung, kein Verbot. Lukas soll
 * daraus schliessen, nicht gehorchen — ein "du darfst nicht" waere eine
 * Grenze, und Grenzen gehoeren in policy.ts, nicht in eine Lernnotiz.
 */
export async function lehrenText(): Promise<string> {
  const lehren = await schlechteLehren();
  if (lehren.length === 0) return "";

  const zeilen = lehren.map((l) => {
    const wo = l.kontext ? ` bei ${l.kontext}` : "";
    const woran = l.haeufigsterGrund ? ` — meist: ${l.haeufigsterGrund}` : "";
    return `- ${l.werkzeug}${wo}: ${l.gelungen} von ${l.versuche} Versuchen gelungen${woran}`;
  });

  return (
    `WAS BEI DIR ZULETZT NICHT FUNKTIONIERT HAT (aus deinen eigenen Versuchen der letzten ${FENSTER_TAGE} Tage):\n` +
    zeilen.join("\n") +
    `\n\nDas ist eine Zählung, kein Verbot. Wenn du eines davon wieder vorhast: nimm einen anderen Weg, ` +
    `oder ändere vorher genau das, woran es lag. Dasselbe ein viertes Mal identisch zu versuchen, ` +
    `hat bisher nichts gebracht.`
  );
}

/** Wie oft ist genau das schon schiefgegangen? Fuer den Hinweis im Zug. */
export async function bisherGescheitert(
  werkzeug: string,
  eingabe: Record<string, unknown>,
): Promise<{ versuche: number; gelungen: number; grund: string }> {
  const kontext = kontextAus(werkzeug, eingabe);
  const seit = new Date(Date.now() - FENSTER_TAGE * 24 * 3600 * 1000);
  const zeilen = await db
    .select({
      werkzeug: erfahrungenTable.werkzeug,
      kontext: erfahrungenTable.kontext,
      gelungen: erfahrungenTable.gelungen,
      grund: erfahrungenTable.grund,
    })
    .from(erfahrungenTable)
    .where(
      and(
        eq(erfahrungenTable.werkzeug, werkzeug),
        eq(erfahrungenTable.kontext, kontext),
        gte(erfahrungenTable.createdAt, seit),
      ),
    )
    .limit(HOECHSTENS_ZEILEN);

  const [lehre] = fasseZusammen(zeilen);
  return lehre
    ? { versuche: lehre.versuche, gelungen: lehre.gelungen, grund: lehre.haeufigsterGrund }
    : { versuche: 0, gelungen: 0, grund: "" };
}

/** Fuer das Dashboard und read_diagnostics: die letzten Erfahrungen im Rohzustand. */
export async function letzteErfahrungen(grenze = 50): Promise<Erfahrung[]> {
  return db
    .select()
    .from(erfahrungenTable)
    .orderBy(desc(erfahrungenTable.createdAt))
    .limit(grenze);
}
