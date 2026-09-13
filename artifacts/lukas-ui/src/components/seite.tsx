import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/*
 * Die gemeinsame Sprache aller Seiten.
 *
 * WARUM ES DAS GIBT. Die Startseite wurde umgebaut — Orb, weiche Kacheln,
 * runde Kanten, Luft. Die uebrigen vierzehn Seiten blieben, wie sie waren:
 * harte Trennlinien quer ueber die Breite, flache Kaesten mit 1px-Rahmen,
 * Zustaende in Grossbuchstaben ("ALL", "ACTIVE", "REAKTIVIEREN") und rohe
 * englische Datenbankwerte als Beschriftung ("curious", "preference"). Das
 * ist der "Terminal-Look": es liest sich wie eine Konsolenausgabe, nicht wie
 * eine App.
 *
 * Statt jede Seite einzeln umzustreichen — und beim naechsten Mal wieder —
 * stehen die Bausteine hier an EINER Stelle. Wer eine neue Seite baut, nimmt
 * sie und ist automatisch im richtigen Bild.
 *
 * DIE REGELN, die dahinterstehen:
 *
 *   1. Keine Linie, wo Abstand reicht. Eine Trennlinie quer ueber die
 *      Seitenbreite zerschneidet sie in Zonen; Weissraum gliedert genauso
 *      und wirkt nicht wie ein Formular.
 *   2. Karten heben sich ab, statt umrandet zu sein — `card-soft` hat einen
 *      leichten Verlauf und hebt sich beim Zeigen an.
 *   3. Alles auf Deutsch und in Satzschrift. Grossbuchstaben sind Schreien,
 *      und `status.toUpperCase()` zeigt dem Menschen den Datenbankwert.
 *   4. Die Seite scrollt als Ganzes, wie eine App — kein Kopf, der stehen
 *      bleibt, waehrend darunter eine zweite Bildlaufleiste laeuft.
 */

/** Der Schein von unten, den auch die Startseite hat. */
function Schein() {
  return (
    <div
      aria-hidden="true"
      /*
       * `fixed`, nicht `absolute`: mitscrollend reisst der Verlauf beim
       * Scrollen sichtbar ab — genau der schwarze Balken, der auf der
       * Startseite schon einmal gemeldet wurde.
       */
      className="pointer-events-none fixed inset-x-0 bottom-0 h-[40vh] opacity-40"
      style={{
        background:
          "radial-gradient(120% 100% at 50% 130%, color-mix(in oklch, var(--primary) 45%, transparent) 0%, transparent 70%)",
      }}
    />
  );
}

/**
 * Der Rahmen einer Seite: Schein, Breitenbegrenzung, Kopf, Inhalt.
 *
 * `breit` fuer Seiten, die Spalten nebeneinander stellen (Kennzahlen, MCP);
 * der Rest liest sich in einer Spalte besser.
 */
export function Seite({
  icon: Icon,
  titel,
  unterzeile,
  aktionen,
  unterKopf,
  breit = false,
  children,
}: {
  icon?: LucideIcon;
  titel: string;
  unterzeile?: ReactNode;
  aktionen?: ReactNode;
  unterKopf?: ReactNode;
  breit?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative h-full overflow-y-auto overflow-x-hidden">
      <Schein />
      <div
        className={`relative mx-auto flex w-full flex-col px-5 pb-20 pt-6 sm:px-8 sm:pt-8 ${
          breit ? "max-w-6xl" : "max-w-4xl"
        }`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              {Icon && (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                  <Icon className="h-[1.15rem] w-[1.15rem] text-primary" />
                </span>
              )}
              <h1 className="text-[1.6rem] font-semibold leading-tight tracking-tight sm:text-[1.9rem]">
                {titel}
              </h1>
            </div>
            {unterzeile && (
              <p className="mt-2 text-sm leading-relaxed text-pretty text-muted-foreground">
                {unterzeile}
              </p>
            )}
          </div>
          {aktionen && <div className="flex shrink-0 flex-wrap items-center gap-2">{aktionen}</div>}
        </div>

        {unterKopf && <div className="mt-5">{unterKopf}</div>}

        <div className="mt-6 sm:mt-7">{children}</div>
      </div>
    </div>
  );
}

/**
 * Eine Karte. Dasselbe `card-soft rise`, das die Kacheln der Startseite
 * benutzen — damit eine Liste von Eintraegen aussieht wie dort und nicht wie
 * Tabellenzeilen.
 *
 * `verzoegerung` staffelt das Auftauchen; ohne sie erscheinen zwanzig Karten
 * gleichzeitig und die Animation wirkt wie ein Zucken.
 */
export function Karte({
  verzoegerung = 0,
  className = "",
  children,
}: {
  verzoegerung?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={verzoegerung ? { animationDelay: `${verzoegerung}ms` } : undefined}
      className={`card-soft rise rounded-3xl p-5 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Staffelung fuer Listen: nach dem achten Eintrag nicht weiter verzoegern.
 *
 * Sonst wartet der dreissigste Eintrag zwei Sekunden auf sein Erscheinen —
 * und wer schnell nach unten scrollt, sieht eine leere Seite.
 */
export const staffel = (i: number) => Math.min(i, 8) * 45;

type Ton = "neutral" | "gut" | "warnung" | "schlecht" | "info" | "akzent";

const TON: Record<Ton, string> = {
  neutral: "bg-white/[0.06] text-muted-foreground",
  gut: "bg-emerald-400/10 text-emerald-300",
  warnung: "bg-amber-400/10 text-amber-300",
  schlecht: "bg-destructive/15 text-red-300",
  info: "bg-sky-400/10 text-sky-300",
  akzent: "bg-primary/12 text-primary",
};

/**
 * Ein Pill-Etikett. Ohne Rahmen: der 1px-Strich um jedes kleine Etikett war
 * ein grosser Teil des Terminal-Eindrucks.
 */
export function Chip({
  ton = "neutral",
  className = "",
  children,
}: {
  ton?: Ton;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[11px] font-medium leading-none ${TON[ton]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Nichts da. Mit einem Satz, der sagt, warum — nicht nur "Keine Daten". */
export function Leer({
  icon: Icon,
  titel,
  hinweis,
}: {
  icon: LucideIcon;
  titel: string;
  hinweis?: string;
}) {
  return (
    <div className="rise flex flex-col items-center py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
        <Icon className="h-7 w-7 text-muted-foreground/50" />
      </span>
      <p className="mt-4 font-medium">{titel}</p>
      {hinweis && (
        <p className="mt-1.5 max-w-sm text-sm text-pretty text-muted-foreground">{hinweis}</p>
      )}
    </div>
  );
}

/** Wird geladen. Bewusst zurueckhaltend — es ist kein Ereignis. */
export function Laedt({ was = "Wird geladen…" }: { was?: string }) {
  return <p className="py-14 text-center text-sm text-muted-foreground">{was}</p>;
}

/**
 * Ein Fehler beim Laden, sichtbar statt still.
 *
 * Eine Seite, die bei einem Fehler einfach leer bleibt, sieht aus wie eine
 * Seite ohne Daten — und man sucht an der falschen Stelle.
 */
export function Fehler({ text }: { text: string }) {
  return (
    <div className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-red-300">{text}</div>
  );
}
