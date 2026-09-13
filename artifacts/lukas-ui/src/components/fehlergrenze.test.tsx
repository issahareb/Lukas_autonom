/*
 * Die Fehlergrenze.
 *
 * Sie ist eine Zusage: EINE kaputte Seite kostet nicht die ganze Anwendung.
 * Eine Zusage, die nie geprueft wurde, ist eine Behauptung — und diese hier
 * ist besonders leicht falsch, weil sie im Normalbetrieb nie ausloest. Man
 * merkt erst am schwarzen Bildschirm, dass sie nicht funktioniert.
 *
 * Geprueft wird deshalb genau das, was im Ernstfall passieren muss:
 *   1. Im Normalfall ist sie unsichtbar.
 *   2. Wirft ein Kind, steht eine Meldung da — und die Anwendung DRUMHERUM
 *      steht noch (das ist der eigentliche Punkt).
 *   3. Beim Seitenwechsel gibt sie den Platz wieder frei. Ohne das waere die
 *      Anwendung nach einem Fehler bis zum Neuladen unbenutzbar — fast so
 *      schlimm wie das, wogegen sie hilft.
 */
import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Fehlergrenze } from "./fehlergrenze";

function Stolpert({ wirft }: { wirft: boolean }) {
  if (wirft) throw new Error("unerwartete Antwort vom Server");
  return <p>Inhalt der Seite</p>;
}

/*
 * React schreibt bei einem gefangenen Fehler von sich aus in die Konsole, und
 * componentDidCatch tut es auch. Beides ist hier erwuenscht und wuerde die
 * Testausgabe nur zumuellen — deshalb stillgelegt, aber nur hier.
 */
beforeAll(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterAll(() => vi.restoreAllMocks());

describe("Fehlergrenze", () => {
  it("haelt sich raus, solange nichts schiefgeht", () => {
    render(
      <Fehlergrenze>
        <Stolpert wirft={false} />
      </Fehlergrenze>,
    );
    expect(screen.getByText("Inhalt der Seite")).toBeInTheDocument();
    expect(screen.queryByText(/gestolpert/)).toBeNull();
  });

  it("faengt den Fehler und laesst stehen, was drumherum steht", () => {
    render(
      <div>
        <nav>Menü</nav>
        <Fehlergrenze>
          <Stolpert wirft={true} />
        </Fehlergrenze>
      </div>,
    );
    expect(screen.getByText(/gestolpert/)).toBeInTheDocument();
    // Das ist der ganze Zweck: ohne Grenze waere auch das Menue weg.
    expect(screen.getByText("Menü")).toBeInTheDocument();
    // Und die Meldung steht da, statt still verschluckt zu werden.
    expect(screen.getByText("unerwartete Antwort vom Server")).toBeInTheDocument();
  });

  it("gibt beim Seitenwechsel wieder frei", () => {
    const { rerender } = render(
      <Fehlergrenze schluessel="/telefon">
        <Stolpert wirft={true} />
      </Fehlergrenze>,
    );
    expect(screen.getByText(/gestolpert/)).toBeInTheDocument();

    rerender(
      <Fehlergrenze schluessel="/diary">
        <Stolpert wirft={false} />
      </Fehlergrenze>,
    );
    expect(screen.getByText("Inhalt der Seite")).toBeInTheDocument();
    expect(screen.queryByText(/gestolpert/)).toBeNull();
  });
});
