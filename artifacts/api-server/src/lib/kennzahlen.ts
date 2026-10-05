/*
 * Zeitreihen — und der Satz, der sie ausspricht.
 *
 * WAS HIER GEFEHLT HAT, war nicht das Messen. Die Zahlen liegen laengst in
 * der Datenbank: jeder Werkzeugausgang in `lukas_erfahrungen`, jeder
 * Modellaufruf in `lukas_tageskosten`, jede Freigabe, jede Meldung, jede
 * Stoerung. Man konnte nachrechnen, ob heute mehr scheitert als gestern.
 * Nur: niemand hat nachgerechnet. Eine Kennzahl, die man abfragen MUSS, um
 * sie zu sehen, ist im Betrieb keine Kennzahl, sondern ein Archiv.
 *
 * Deshalb sind hier zwei Dinge, und das zweite ist das eigentliche:
 *
 *   zeitreihe()        — was war, Tag fuer Tag.
 *   auffaelligkeiten() — was daran heute nicht stimmt, in ganzen Saetzen.
 *
 * Der Vergleich laeuft gegen den MEDIAN der Vortage, nicht gegen den
 * Mittelwert. Ein einziger katastrophaler Tag zieht den Mittelwert so weit
 * hoch, dass danach nichts mehr auffaellig ist — genau dann, wenn man es am
 * dringendsten braucht.
 *
 * KEINE NEUE TABELLE. Es waere verlockend gewesen, stuendlich einen
 * Messpunkt wegzuschreiben. Aber die Rohdaten sind da und werden ohnehin
 * geschrieben; eine zweite Wahrheit daneben koennte von der ersten abweichen,
 * und dann glaubt man der falschen. Gerechnet wird beim Nachsehen.
 */
import { db } from "@workspace/db";
import {
  approvals,
  debugLogTable,
  erfahrungenTable,
  meldungen,
  tageskostenTable,
} from "@workspace/db";
import { eq, gte } from "drizzle-orm";
import { logger } from "./logger";

const TAG_MS = 24 * 3600 * 1000;

/**
 * Ab wie vielen Aufrufen eine Quote etwas bedeutet.
 *
 * Zwei von drei Aufrufen gescheitert sind 67 % — und trotzdem kein Befund.
 * Ohne diese Untergrenze meldet die Ueberwachung an ruhigen Tagen am
 * lautesten, und man gewoehnt sich das Wegsehen an.
 */
const MINDESTMENGE = 10;

/** Vor Ablauf dieser Zeit ist ein angebrochener Tag noch nichts wert. */
const FRUEHESTENS_NACH_H = 2;

export type Tageswert = {
  /** UTC-Datum, "2026-09-02". Dieselbe Grenze wie im Tagesbudget. */
  tag: string;
  werkzeugAufrufe: number;
  werkzeugFehler: number;
  /** 0..1, oder null bei zu wenigen Aufrufen — dann ist sie nicht aussagekräftig. */
  fehlerquote: number | null;
  modellAufrufe: number;
  tokenRein: number;
  tokenRaus: number;
  tokenCache: number;
  tokenGesamt: number;
  verbrauchErfasst: boolean;
  /** Anteil der Eingabe-Tokens, der aus dem Cache kam. 0..1, null ohne Aufrufe. */
  cacheQuote: number | null;
  freigabenGefragt: number;
  freigabenErteilt: number;
  meldungenNeu: number;
  stoerungen: number;
};

export type Auffaelligkeit = {
  /** Was gemessen wurde, als Schlüssel — für Tests und die Oberfläche. */
  kennzahl: string;
  heute: number;
  ueblich: number;
  schwere: "hinweis" | "warnung";
  /** Der Satz, den ein Mensch liest. */
  satz: string;
};

export type Kennzahlen = {
  reihe: Tageswert[];
  auffaelligkeiten: Auffaelligkeit[];
  /** Was gerade offen ist — kein Verlauf, ein Zustand. */
  jetzt: { freigabenOffen: number; meldungenOffen: number };
  /** Werkzeuge, die heute mehrfach scheitern, mit dem häufigsten Grund. */
  schlechtesteWerkzeuge: Array<{ schluessel: string; fehler: number; grund: string }>;
};

const tagVon = (d: Date | string): string =>
  (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);

function median(werte: number[]): number {
  if (werte.length === 0) return 0;
  const s = [...werte].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Wie viel des heutigen UTC-Tages schon vorbei ist. 0..1. */
export function anteilDesTages(jetzt = new Date()): number {
  const mitternacht = Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate());
  return Math.min(1, (jetzt.getTime() - mitternacht) / TAG_MS);
}

/*
 * Die Aggregation laeuft in TypeScript, nicht in SQL.
 *
 * Mit GROUP BY waere sie kuerzer und schneller. Sie waere aber auch nur mit
 * einer echten Datenbank pruefbar — und dann steht die Regel, nach der etwas
 * auffaellig ist, in einer Zeichenkette, die kein Typ und kein Test anfasst.
 * Bei vierzehn Tagen sind das einige tausend Zeilen; das ist billiger als
 * eine Ueberwachung, der niemand traut.
 */
export async function zeitreihe(tage = 14): Promise<Tageswert[]> {
  const seit = new Date(Date.now() - tage * TAG_MS);
  const seitTag = tagVon(seit);

  const leer = (tag: string): Tageswert => ({
    tag,
    werkzeugAufrufe: 0,
    werkzeugFehler: 0,
    fehlerquote: null,
    modellAufrufe: 0,
    tokenRein: 0,
    tokenRaus: 0,
    tokenCache: 0,
    tokenGesamt: 0,
    verbrauchErfasst: false,
    cacheQuote: null,
    freigabenGefragt: 0,
    freigabenErteilt: 0,
    meldungenNeu: 0,
    stoerungen: 0,
  });

  const nach: Map<string, Tageswert> = new Map();
  for (let i = tage - 1; i >= 0; i--) {
    const tag = tagVon(new Date(Date.now() - i * TAG_MS));
    nach.set(tag, leer(tag));
  }
  const hol = (tag: string): Tageswert | undefined => nach.get(tag);

  const [erfahrungen, kosten, freigaben, gemeldet, stoerungen] = await Promise.all([
    db.select().from(erfahrungenTable).where(gte(erfahrungenTable.createdAt, seit)),
    db.select().from(tageskostenTable).where(gte(tageskostenTable.tag, seitTag)),
    db.select().from(approvals).where(gte(approvals.createdAt, seit)),
    db.select().from(meldungen).where(gte(meldungen.createdAt, seit)),
    db.select().from(debugLogTable).where(gte(debugLogTable.createdAt, seit)),
  ]);

  for (const e of erfahrungen) {
    const t = hol(tagVon(e.createdAt));
    if (!t) continue;
    t.werkzeugAufrufe++;
    if (!e.gelungen) t.werkzeugFehler++;
  }

  /* Cache getrennt mitgezaehlt: die Quote ist ein Verhaeltnis, und ein
     Verhaeltnis von Summen ist etwas anderes als die Summe von Verhaeltnissen. */
  const cache: Map<string, { aus: number; gesamt: number }> = new Map();
  for (const k of kosten) {
    const t = hol(k.tag);
    if (!t) continue;
    t.modellAufrufe += k.aufrufe;
    t.tokenRein += k.rein;
    t.tokenRaus += k.raus;
    t.tokenCache += k.ausCache + k.inCache;
    t.tokenGesamt += k.rein + k.raus + k.ausCache + k.inCache;
    t.verbrauchErfasst = true;
    /*
     * Der NENNER ist der ganze Eingang, nicht der frisch bezahlte.
     *
     * `rein` heisst in model-client.ts ausdruecklich "frisch bezahlter
     * Eingang, OHNE das, was aus dem Cache kam". Wer durch `rein` teilt,
     * rechnet Gelesenes gegen Nicht-Gelesenes — und bekommt bei einem guten
     * Cache ueber 100 %. Genau das stand im Dashboard: 104 %.
     *
     * Der ganze Eingang ist rein + gelesen + geschrieben. So rechnet
     * read_usage seit jeher; hier war es falsch, und die Zahl war damit nicht
     * bloss ungenau, sondern unmoeglich.
     */
    const c = cache.get(k.tag) ?? { aus: 0, gesamt: 0 };
    c.aus += k.ausCache;
    c.gesamt += k.rein + k.ausCache + k.inCache;
    cache.set(k.tag, c);
  }

  for (const a of freigaben) {
    const t = hol(tagVon(a.createdAt));
    if (!t) continue;
    t.freigabenGefragt++;
    if (a.status === "allowed" || a.status === "used") t.freigabenErteilt++;
  }

  for (const m of gemeldet) {
    const t = hol(tagVon(m.createdAt));
    if (t) t.meldungenNeu++;
  }

  for (const s of stoerungen) {
    const t = hol(tagVon(s.createdAt));
    if (t) t.stoerungen++;
  }

  for (const t of nach.values()) {
    t.fehlerquote =
      t.werkzeugAufrufe >= MINDESTMENGE ? t.werkzeugFehler / t.werkzeugAufrufe : null;
    const c = cache.get(t.tag);
    /*
     * Gedeckelt, und das ist kein Misstrauen gegen die Rechnung darueber,
     * sondern gegen die Zukunft: eine Quote ueber 100 % ist immer ein Fehler,
     * und sie soll auffallen, bevor sie jemandem als Messwert vorgelegt wird.
     * Eine unmoegliche Zahl im Dashboard kostet mehr Vertrauen als eine
     * fehlende.
     */
    t.cacheQuote = c && c.gesamt > 0 ? Math.min(1, c.aus / c.gesamt) : null;
  }

  return [...nach.values()];
}

/*
 * Der Vergleich — und die Stelle, an der so etwas normalerweise Unsinn meldet.
 *
 * Der angebrochene Tag ist kuerzer als die Vortage. Wer absolute Zahlen
 * ungewichtet vergleicht, bekommt jeden Vormittag "heute ist viel weniger
 * los" und jeden Abend nichts. Deshalb wird der Vergleichswert fuer MENGEN
 * mit dem bereits vergangenen Anteil des Tages skaliert; QUOTEN brauchen das
 * nicht, die sind schon normiert.
 */
export function auffaelligkeiten(reihe: Tageswert[], jetzt = new Date()): Auffaelligkeit[] {
  if (reihe.length < 3) return [];
  const heute = reihe[reihe.length - 1];
  const vortage = reihe.slice(0, -1);
  const anteil = anteilDesTages(jetzt);
  const befunde: Auffaelligkeit[] = [];

  const prozent = (v: number) => `${Math.round(v * 100)} %`;

  // ── Werkzeuge scheitern häufiger als sonst ──────────────────────────────
  const quoten = vortage.map((t) => t.fehlerquote).filter((q): q is number => q !== null);
  if (heute.fehlerquote !== null && quoten.length >= 2) {
    const ueblich = median(quoten);
    /*
     * Absolut fuenfzehn Punkte, nicht "doppelt so viel". Bei einer ueblichen
     * Quote von 2 % waere eine Verdopplung auf 4 % ein Alarm ohne Anlass;
     * bei 40 % waere eine Verdopplung nicht mehr erreichbar und der Befund
     * kaeme nie.
     */
    if (heute.fehlerquote >= ueblich + 0.15) {
      befunde.push({
        kennzahl: "werkzeug-fehlerquote",
        heute: heute.fehlerquote,
        ueblich,
        schwere: heute.fehlerquote >= ueblich + 0.3 ? "warnung" : "hinweis",
        satz:
          `Heute scheitern ${prozent(heute.fehlerquote)} der Werkzeugaufrufe ` +
          `(${heute.werkzeugFehler} von ${heute.werkzeugAufrufe}). Üblich sind ` +
          `${prozent(ueblich)}.`,
      });
    }
  }

  // ── Der Cache greift nicht mehr ────────────────────────────────────────
  const cq = vortage.map((t) => t.cacheQuote).filter((q): q is number => q !== null);
  if (heute.cacheQuote !== null && cq.length >= 2) {
    const ueblich = median(cq);
    if (ueblich >= 0.2 && heute.cacheQuote <= ueblich - 0.2) {
      befunde.push({
        kennzahl: "cache-quote",
        heute: heute.cacheQuote,
        ueblich,
        schwere: "hinweis",
        satz:
          `Vom Prompt kommen heute nur ${prozent(heute.cacheQuote)} aus dem Cache, ` +
          `sonst ${prozent(ueblich)}. Das schlägt direkt auf die Rechnung durch.`,
      });
    }
  }

  /*
   * Ab hier MENGEN. Vor zwei Stunden UTC ist daran nichts zu erkennen: ein
   * einziger Lauf um 00:30 ueberschreitet jede skalierte Erwartung.
   */
  if (anteil * 24 < FRUEHESTENS_NACH_H) return befunde;

  const mengeVergleichen = (
    kennzahl: string,
    wert: (t: Tageswert) => number,
    untergrenze: number,
    satz: (heuteWert: number, erwartet: number) => string,
  ) => {
    const erwartet = median(vortage.map(wert)) * anteil;
    const ist = wert(heute);
    if (ist < untergrenze || erwartet <= 0) return;
    if (ist >= erwartet * 2) {
      befunde.push({
        kennzahl,
        heute: ist,
        ueblich: erwartet,
        schwere: ist >= erwartet * 4 ? "warnung" : "hinweis",
        satz: satz(ist, erwartet),
      });
    }
  };

  mengeVergleichen(
    "tokenverbrauch",
    (t) => t.tokenGesamt ?? (t.tokenRein + t.tokenRaus),
    100_000,
    (ist, erwartet) =>
      `Bis jetzt ${ist.toLocaleString("de-DE")} Tokens verbraucht — um diese Uhrzeit ` +
      `wären ${Math.round(erwartet).toLocaleString("de-DE")} üblich.`,
  );

  mengeVergleichen(
    "stoerungen",
    (t) => t.stoerungen,
    5,
    (ist, erwartet) =>
      `${ist} Störungen im Fehlerprotokoll, üblich wären um diese Zeit ` +
      `${Math.round(erwartet)}.`,
  );

  return befunde;
}

/** Die häufigsten Fehlschläge von heute, mit dem Grund — nicht nur der Zahl. */
async function schlechtesteWerkzeuge(): Promise<Kennzahlen["schlechtesteWerkzeuge"]> {
  const heute = new Date();
  const mitternacht = new Date(
    Date.UTC(heute.getUTCFullYear(), heute.getUTCMonth(), heute.getUTCDate()),
  );
  const rows = await db
    .select()
    .from(erfahrungenTable)
    .where(gte(erfahrungenTable.createdAt, mitternacht));

  const nach = new Map<string, { fehler: number; gruende: Map<string, number> }>();
  for (const r of rows) {
    if (r.gelungen) continue;
    const schluessel = r.kontext ? `${r.werkzeug}@${r.kontext}` : r.werkzeug;
    const e = nach.get(schluessel) ?? { fehler: 0, gruende: new Map() };
    e.fehler++;
    const g = (r.grund || "ohne Grund").slice(0, 160);
    e.gruende.set(g, (e.gruende.get(g) ?? 0) + 1);
    nach.set(schluessel, e);
  }

  return [...nach.entries()]
    .filter(([, e]) => e.fehler >= 2)
    .sort((a, b) => b[1].fehler - a[1].fehler)
    .slice(0, 5)
    .map(([schluessel, e]) => ({
      schluessel,
      fehler: e.fehler,
      grund: [...e.gruende.entries()].sort((a, b) => b[1] - a[1])[0][0],
    }));
}

export async function kennzahlen(tage = 14): Promise<Kennzahlen> {
  const reihe = await zeitreihe(tage);
  const [offeneFreigaben, offeneMeldungen, schlechteste] = await Promise.all([
    db.select().from(approvals).where(eq(approvals.status, "pending")),
    db.select().from(meldungen).where(eq(meldungen.status, "offen")),
    schlechtesteWerkzeuge(),
  ]);

  return {
    reihe,
    auffaelligkeiten: auffaelligkeiten(reihe),
    jetzt: { freigabenOffen: offeneFreigaben.length, meldungenOffen: offeneMeldungen.length },
    schlechtesteWerkzeuge: schlechteste,
  };
}

/*
 * Was Lukas selbst zu lesen bekommt.
 *
 * Das ist der Unterschied zwischen einer Ansicht und einer Ueberwachung: eine
 * Ansicht wartet, bis jemand hinsieht. Hier steht der Befund im naechsten Zug
 * im Prompt — mit dem konkreten Werkzeug und dem Grund, damit er etwas damit
 * anfangen kann statt nur beunruhigt zu sein.
 *
 * Leer, wenn nichts auffaellig ist. Ein taeglicher Bericht ueber "alles
 * normal" waere Text, den er nach drei Tagen ueberliest — und dann ueberliest
 * er auch den, der etwas sagt.
 */
export async function kennzahlenHinweis(): Promise<string> {
  try {
    const k = await kennzahlen(14);
    if (k.auffaelligkeiten.length === 0) return "";

    const zeilen = k.auffaelligkeiten.map(
      (a) => `- ${a.schwere === "warnung" ? "WARNUNG" : "Hinweis"}: ${a.satz}`,
    );

    if (k.schlechtesteWerkzeuge.length > 0) {
      zeilen.push("  Was heute am häufigsten scheitert:");
      for (const w of k.schlechtesteWerkzeuge.slice(0, 3)) {
        zeilen.push(`  - ${w.schluessel}: ${w.fehler}× — ${w.grund}`);
      }
    }

    return (
      `\n\nWAS HEUTE ANDERS LÄUFT ALS SONST:\n${zeilen.join("\n")}\n` +
      `Das ist kein Auftrag. Aber wenn du gleich dasselbe Werkzeug brauchst, ` +
      `weißt du jetzt, woran es liegt.`
    );
  } catch (err) {
    // Eine Ueberwachung, die den Lauf kippt, den sie ueberwacht, ist schlimmer
    // als keine.
    logger.warn({ err }, "Kennzahlen nicht lesbar — Lauf geht ohne sie weiter");
    return "";
  }
}

/*
 * Und was ISSA erfaehrt.
 *
 * Nur Warnungen, nie Hinweise. Die Schwelle ist absichtlich hoch: eine
 * Ueberwachung, die zweimal die Woche meldet, wird nach vier Wochen
 * weggeklickt, ohne gelesen zu werden — und dann meldet sie zwar noch, aber
 * niemand erfaehrt mehr etwas.
 *
 * Die Wiederholungssperre kommt geschenkt: meldeDichBeiIssa legt keine zweite
 * Meldung mit demselben Betreff an, solange die erste offen ist. Deshalb
 * traegt der Betreff die KENNZAHL und nicht den Messwert — sonst waere jeder
 * Prozentpunkt ein neuer Betreff und die Sperre wirkungslos.
 */
export async function meldeAuffaelligkeiten(): Promise<number> {
  try {
    const k = await kennzahlen(14);
    const warnungen = k.auffaelligkeiten.filter((a) => a.schwere === "warnung");
    if (warnungen.length === 0) return 0;

    const { meldeDichBeiIssa } = await import("./melden");
    let gemeldet = 0;
    for (const a of warnungen) {
      const details =
        a.kennzahl === "werkzeug-fehlerquote" && k.schlechtesteWerkzeuge.length > 0
          ? `\n\nWas dabei am häufigsten scheitert:\n` +
            k.schlechtesteWerkzeuge
              .map((w) => `- ${w.schluessel}: ${w.fehler}× — ${w.grund}`)
              .join("\n")
          : "";
      await meldeDichBeiIssa({
        betreff: `Auffällig: ${a.kennzahl}`,
        text: `${a.satz}${details}\n\nGemessen über die letzten 14 Tage, Vergleich gegen den Median der Vortage.`,
      });
      gemeldet++;
    }
    return gemeldet;
  } catch (err) {
    logger.warn({ err }, "Auffälligkeiten konnten nicht gemeldet werden");
    return 0;
  }
}
