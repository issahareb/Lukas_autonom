import { useGetDiaryEntries } from "@workspace/api-client-react";
import { BookOpen } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Seite, Karte, Chip, Leer, Laedt, staffel } from "@/components/seite";
import { stimmung, energie } from "@/lib/worte";

/*
 * Das Tagebuch als Verlauf, nicht als Liste von Kaesten: eine Linie laeuft
 * durch die Eintraege, die Punkte darauf sind die Tage. Es IST eine zeitliche
 * Abfolge — dann soll man das auch sehen.
 */

/** Die Stimmung faerbt den Punkt. Sonst sind alle Eintraege gleich grau. */
const TON: Record<string, "gut" | "warnung" | "schlecht" | "info" | "akzent" | "neutral"> = {
  curious: "info",
  focused: "akzent",
  energized: "gut",
  inspired: "gut",
  frustrated: "schlecht",
  suspicious: "warnung",
  scattered: "warnung",
  cold: "info",
  neutral: "neutral",
};

const ENERGIE_TON: Record<string, string> = {
  high: "text-emerald-300",
  normal: "text-amber-300",
  low: "text-muted-foreground",
};

export default function Diary() {
  const { data: entries = [], isLoading } = useGetDiaryEntries({ limit: 50 });

  return (
    <Seite
      icon={BookOpen}
      titel="Tagebuch"
      unterzeile="Was Lukas sich nach einem Gespräch selbst notiert — unredigiert."
    >
      {isLoading && <Laedt was="Einträge werden geladen…" />}

      <div className="space-y-5">
        {entries.map((entry, idx) => (
          <article key={entry.id} className="relative">
            {/* Die Linie zum naechsten Eintrag. Am letzten faellt sie weg,
                sonst haengt sie ins Nichts. */}
            {idx < entries.length - 1 && (
              <div className="absolute bottom-[-20px] left-[15px] top-10 w-px bg-border/60" />
            )}
            <div className="flex items-start gap-4">
              <span className="z-10 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <BookOpen className="h-3.5 w-3.5 text-primary" />
              </span>
              <Karte verzoegerung={staffel(idx)} className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip ton={TON[entry.mood] ?? "neutral"}>{stimmung(entry.mood)}</Chip>
                  <span
                    className={`text-[11px] ${ENERGIE_TON[entry.energy] ?? "text-muted-foreground"}`}
                  >
                    Energie {energie(entry.energy)}
                  </span>
                  {/*
                    Kurzes Datum und `ml-auto` erst ab sm: auf 390px passte
                    "13. September, 16:20" nicht neben Stimmung und Energie,
                    rutschte in eine eigene Zeile und stand dort rechts allein
                    im Nichts. Im Bild sah das aus wie ein Umbruchfehler.
                  */}
                  <span className="text-[11px] text-muted-foreground sm:ml-auto">
                    {format(new Date(entry.createdAt), "d. MMM, HH:mm", { locale: de })}
                  </span>
                </div>
                {/* break-words: ein Eintrag kann eine URL oder einen Hash
                    enthalten; ohne das schiebt der die Karte seitlich raus. */}
                <p className="mt-3 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-foreground/90">
                  {entry.content}
                </p>
              </Karte>
            </div>
          </article>
        ))}
      </div>

      {!isLoading && entries.length === 0 && (
        <Leer
          icon={BookOpen}
          titel="Noch nichts geschrieben"
          hinweis="Lukas schreibt nach jedem Gespräch einen Eintrag. Sobald ihr geredet habt, steht hier etwas."
        />
      )}
    </Seite>
  );
}
