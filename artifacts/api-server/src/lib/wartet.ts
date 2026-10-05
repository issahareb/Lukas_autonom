import { meldungIstVeraltet } from "./meldungs-status";
/*
 * Was gerade auf Issa wartet.
 *
 * DER ANLASS: Lukas meldet sich, wenn er allein nicht weiterkommt — und
 * bleibt dann stehen. Die Meldung lag in einem eigenen Tab, die offenen
 * Freigaben in einem zweiten. Beides sah man nur, wenn man ohnehin schon
 * wusste, dass etwas ansteht; und wer das wusste, brauchte die Ansicht nicht
 * mehr. Die Startseite ist die Seite, die man aufmacht, OHNE etwas zu wissen.
 *
 * WARUM ALS EIGENES MODUL und nicht in der Route: die eine Regel, auf die es
 * ankommt, ist das Aussortieren abgelaufener Freigaben. In einem
 * Routen-Rumpf waere sie eine Zeile, die niemand prueft — und genau solche
 * Zeilen sind es, die spaeter beim Umbauen verschwinden.
 */
import { db } from "@workspace/db";
import { approvals } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { offeneMeldungen, offeneAnzahl } from "./melden";

export type WartendeMeldung = {
  id: number;
  betreff: string;
  text: string;
  dringend: boolean;
  createdAt: string;
  veraltet?: boolean;
  geprueftAt?: string | null;
};

export type WartendeFreigabe = {
  id: number;
  tool: string;
  riskTier: string;
  argumentsPreview: string;
  expiresAt: string;
};

export type Wartendes = {
  meldungen: WartendeMeldung[];
  freigaben: WartendeFreigabe[];
  /** Wie viel es INSGESAMT gibt — die Listen oben sind gekürzt. */
  gesamt: { meldungen: number; freigaben: number };
};

/** Wie viele je Art auf der Startseite stehen. Mehr wird zur Wand. */
const ZEIGE = 5;

export async function wartendes(jetzt = Date.now()): Promise<Wartendes> {
  const [meldungen, roheFreigaben, anzahlMeldungen] = await Promise.all([
    offeneMeldungen(ZEIGE),
    db
      .select()
      .from(approvals)
      .where(eq(approvals.status, "pending"))
      .orderBy(desc(approvals.createdAt)),
    offeneAnzahl(),
  ]);

  /*
   * Abgelaufene fliegen HIER raus, nicht in der Oberflaeche.
   *
   * "pending" heisst nur, dass niemand entschieden hat — nicht, dass man
   * noch entscheiden KANN. Wer eine abgelaufene Freigabe anbietet, laesst
   * Issa auf "Erlauben" druecken, zeigt keinen Fehler, und der haelt fuer
   * erledigt, was weiter offen ist. Lukas wartet derweil auf etwas, das
   * niemals kommt.
   *
   * Und es steht an EINER Stelle: dieselbe Regel in Server und Ansicht ist
   * dieselbe Regel an zwei Orten, und irgendwann in einem davon falsch.
   */
  const offen = roheFreigaben.filter((a) => a.expiresAt.getTime() > jetzt);

  return {
    meldungen: meldungen.map((m) => ({
      id: m.id,
      betreff: m.betreff,
      text: m.text,
      dringend: m.dringend,
      createdAt: m.createdAt.toISOString(),
      veraltet: meldungIstVeraltet(m, jetzt),
      geprueftAt: m.geprueftAt?.toISOString() ?? null,
    })),
    freigaben: offen.slice(0, ZEIGE).map((a) => ({
      id: a.id,
      tool: a.tool,
      riskTier: a.riskTier,
      argumentsPreview: a.argumentsPreview,
      expiresAt: a.expiresAt.toISOString(),
    })),
    /*
     * Die Gesamtzahl getrennt von den gezeigten fuenf. "und 3 weitere" ist
     * eine ehrlichere Angabe als eine Liste, die stillschweigend endet —
     * sonst haelt man fuenf fuer alles und uebersieht den Rest dauerhaft.
     */
    gesamt: { meldungen: anzahlMeldungen, freigaben: offen.length },
  };
}
