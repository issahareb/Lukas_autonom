import { Link } from "wouter";
import { Compass } from "lucide-react";

/*
 * Die 404-Seite.
 *
 * Was hier stand, war die Vorlage des Baukastens, unveraendert: ein WEISSER
 * Kasten (`bg-gray-50`, `text-gray-900`) mitten in einer dunklen App, mit dem
 * englischen Text "404 Page Not Found — Did you forget to add the page to the
 * router?". Also eine Frage an den Entwickler, gestellt an den Benutzer, in
 * der falschen Sprache und in den falschen Farben.
 *
 * Jetzt: dunkel wie der Rest, deutsch, und mit einem Weg zurueck statt einer
 * Sackgasse.
 */
export default function NotFound() {
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden px-6">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 h-[40vh] opacity-40"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 130%, color-mix(in oklch, var(--primary) 45%, transparent) 0%, transparent 70%)",
        }}
      />
      <div className="relative flex flex-col items-center text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
          <Compass className="h-7 w-7 text-muted-foreground/50" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Hier ist nichts</h1>
        <p className="mt-2 max-w-sm text-sm text-pretty text-muted-foreground">
          Die Seite gibt es nicht — jedenfalls nicht unter dieser Adresse.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-transform hover:scale-105"
        >
          Zurück zur Übersicht
        </Link>
      </div>
    </div>
  );
}
