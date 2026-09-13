import * as React from "react"

import { cn } from "@/lib/utils"

/*
 * WARUM DIESE DATEI GEAENDERT WURDE. Der "Terminal-Look" sass nicht nur in
 * den Seiten, sondern hier unten: jedes Feld war ein eckiger Kasten mit
 * 1px-Rahmen auf durchsichtigem Grund. Solange dieser Baustein so aussieht,
 * bleibt jede Seite halb alt, egal wie man sie darueber streicht.
 *
 * Jetzt: kein Rahmen, sondern eine leicht aufgehellte Flaeche, die beim
 * Tippen etwas heller wird. Dieselbe Sprache wie die Kacheln und die
 * Eingabezeile auf der Startseite.
 *
 * Der Fokusring bleibt — er ist kein Zierat, sondern das, woran man mit der
 * Tastatur erkennt, wo man ist.
 */

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-xl bg-white/[0.05] px-4 py-1 text-base transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/60 hover:bg-white/[0.07] focus-visible:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
