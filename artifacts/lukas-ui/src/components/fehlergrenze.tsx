import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

/*
 * Die Grenze, an der ein Fehler stehenbleibt.
 *
 * WARUM ES DAS GIBT — und warum nicht schon frueher.
 *
 * React raeumt bei einem Fehler im Rendern den GANZEN Baum ab. Eine einzige
 * Zeile wie `daten.meldungen.length` auf einer unerwarteten Antwort macht
 * damit nicht eine Kachel kaputt, sondern die komplette Anwendung: schwarzer
 * Bildschirm, keine Navigation, kein Hinweis. Genau das ist auf der
 * Startseite schon einmal passiert, und beim Durchsehen aller Seiten fand
 * sich dasselbe Muster noch fuenfmal — in Freigaben, Vorschlaegen, MCP,
 * Telefon und der Diagnose.
 *
 * Jede dieser Stellen ist einzeln repariert worden, und das war richtig: die
 * Antwort zu pruefen ist die eigentliche Arbeit. Aber sechs gleiche Fehler
 * heissen, dass der siebte kommt. Diese Grenze ist die Zusage, dass er dann
 * nur seine Seite kostet.
 *
 * WAS SIE NICHT IST: eine Entschuldigung, Antworten ungeprueft zu lassen.
 * Sie faengt den Fehler, sie behebt ihn nicht — deshalb steht die Meldung
 * auch da und verschwindet nicht still.
 *
 * WARUM EINE KLASSE. componentDidCatch gibt es nur an Klassen; es ist die
 * eine Stelle, an der React keine Funktionskomponente anbietet.
 */

type Stand = { fehler: Error | null };

export class Fehlergrenze extends Component<
  { children: ReactNode; /** Wechselt dieser Wert, wird neu versucht. */ schluessel?: string },
  Stand
> {
  state: Stand = { fehler: null };

  static getDerivedStateFromError(fehler: Error): Stand {
    return { fehler };
  }

  componentDidCatch(fehler: Error, info: ErrorInfo) {
    // In die Konsole, damit er beim Nachsehen auffindbar ist. Eine Meldung,
    // die nur auf dem Bildschirm steht, ist beim Suchen wertlos.
    console.error("Fehler in der Seite:", fehler, info.componentStack);
  }

  componentDidUpdate(vorher: { schluessel?: string }) {
    /*
     * Beim Seitenwechsel zuruecksetzen. Ohne das bliebe die Fehlermeldung
     * stehen, auch wenn man laengst woanders ist — und die Anwendung waere
     * bis zum Neuladen unbenutzbar. Das waere fast so schlimm wie der
     * schwarze Bildschirm.
     */
    if (this.state.fehler && vorher.schluessel !== this.props.schluessel) {
      this.setState({ fehler: null });
    }
  }

  render() {
    if (!this.state.fehler) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="flex max-w-md flex-col items-center text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </span>
          <h1 className="mt-5 text-xl font-semibold tracking-tight">Diese Seite ist gestolpert</h1>
          <p className="mt-2 text-sm text-pretty text-muted-foreground">
            Der Rest von Lukas läuft weiter — du kommst über das Menü überall sonst hin. Was genau
            schiefging, steht unter Diagnose und in der Browser-Konsole.
          </p>
          {/*
            Die Meldung selbst, nicht versteckt. Sie ist technisch, aber sie
            ist das Einzige, womit man den Fehler melden oder suchen kann.
          */}
          <p className="mt-4 rounded-2xl bg-white/[0.04] px-4 py-2.5 font-mono text-xs break-words text-muted-foreground">
            {this.state.fehler.message}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ fehler: null })}
            className="mt-5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-transform hover:scale-105"
          >
            Nochmal versuchen
          </button>
        </div>
      </div>
    );
  }
}
