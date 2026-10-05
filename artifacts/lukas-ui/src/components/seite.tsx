import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { PageHeader } from "./page-header";

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
    <div className={`workspace-page ${breit ? "workspace-page--wide" : ""}`}>
      <PageHeader icon={Icon} title={titel} subtitle={unterzeile} actions={aktionen} />
      {unterKopf && <div className="workspace-toolbar">{unterKopf}</div>}
      <div className="workspace-content">{children}</div>
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
    <div className="workspace-empty rise flex flex-col items-center py-12 text-center">
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
    <div role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-red-300">{text}</div>
  );
}
