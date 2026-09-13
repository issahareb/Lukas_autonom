import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/*
 * Der Seitenkopf fuer die zwei Seiten mit eigenem Layout: Studio (zwei
 * Spalten nebeneinander) und Gehirn (3D-Flaeche, die den Rest der Hoehe
 * fuellt). Alle anderen Seiten benutzen `Seite` aus components/seite.tsx,
 * das den Kopf selbst mitbringt.
 *
 * Angeglichen an dieselbe Sprache: das Sinnbild sitzt in einer weichen
 * Kachel wie auf der Startseite, und die harte Trennlinie quer ueber die
 * Seite ist weg. Sie war ein grosser Teil des Terminal-Eindrucks — sie
 * zerschneidet die Seite in Zonen, wo Abstand voellig reicht.
 *
 * `actions` nimmt Buttons/Dialoge rechts im Kopf auf; auf schmalen Screens
 * rutschen sie unter die Ueberschrift statt sie zu zerquetschen.
 */
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="shrink-0 space-y-4 px-5 pb-5 pt-6 sm:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {Icon && (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                <Icon className="h-[1.15rem] w-[1.15rem] text-primary" />
              </span>
            )}
            <h1 className="truncate text-[1.6rem] font-semibold leading-tight tracking-tight sm:text-[1.9rem]">
              {title}
            </h1>
          </div>
          {subtitle && (
            <p className="mt-2 text-sm leading-relaxed text-pretty text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
