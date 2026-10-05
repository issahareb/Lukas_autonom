/*
 * Die Kennzahlen-Seite.
 *
 * Sie existiert wegen eines einzigen Satzes aus der README: man konnte
 * nachrechnen, ob heute mehr scheitert als gestern, aber niemand bekam es
 * gesagt. Deshalb pruefen die Tests hier vor allem, ob GESAGT wird — und ob
 * "keine Daten" von "der Wert ist null" unterschieden bleibt. Verwechselt man
 * die beiden, sieht ein Tag ohne einen einzigen Aufruf aus wie ein Tag mit
 * perfekter Bilanz.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Kennzahlen from "./kennzahlen";

const tag = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const leererTag = (i: number) => ({
  tag: tag(i),
  werkzeugAufrufe: 0,
  werkzeugFehler: 0,
  fehlerquote: null,
  modellAufrufe: 0,
  tokenRein: 0,
  tokenRaus: 0,
  cacheQuote: null,
  freigabenGefragt: 0,
  freigabenErteilt: 0,
  meldungenNeu: 0,
  stoerungen: 0,
});

function mitDaten(daten: unknown) {
  vi.stubGlobal("fetch", (url: string) =>
    Promise.resolve(
      new Response(JSON.stringify(String(url).endsWith("/verbrauch") ? { stand: new Date().toISOString(), tageswerte: [], modelle: [], liveModelle: [], guthaben: null } : daten), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

const grundgeruest = {
  reihe: Array.from({ length: 14 }, (_, i) => leererTag(13 - i)),
  auffaelligkeiten: [],
  jetzt: { freigabenOffen: 0, meldungenOffen: 0 },
  schlechtesteWerkzeuge: [],
};

describe("Kennzahlen", () => {
  it("sagt eine Warnung als Warnung an — nicht nur in Rot", async () => {
    mitDaten({
      ...grundgeruest,
      auffaelligkeiten: [
        {
          kennzahl: "werkzeug-fehlerquote",
          heute: 0.45,
          ueblich: 0.1,
          schwere: "warnung",
          satz: "Heute scheitern 45 % der Werkzeugaufrufe (9 von 20). Üblich sind 10 %.",
        },
      ],
    });
    render(<Kennzahlen />);

    expect(await screen.findByText(/Warnung · werkzeug-fehlerquote/)).toBeInTheDocument();
    expect(screen.getByText(/45 % der Werkzeugaufrufe/)).toBeInTheDocument();
  });

  it("unterscheidet Hinweis von Warnung", async () => {
    mitDaten({
      ...grundgeruest,
      auffaelligkeiten: [
        {
          kennzahl: "cache-quote",
          heute: 0.1,
          ueblich: 0.5,
          schwere: "hinweis",
          satz: "Vom Prompt kommen heute nur 10 % aus dem Cache, sonst 50 %.",
        },
      ],
    });
    render(<Kennzahlen />);

    expect(await screen.findByText(/Hinweis · cache-quote/)).toBeInTheDocument();
    expect(screen.queryByText(/Warnung ·/)).not.toBeInTheDocument();
  });

  /*
   * Leer ist ein ERGEBNIS, keine leere Seite. Wer hier nichts liest, soll
   * wissen, dass gemessen wurde und nichts auffiel — sonst haelt man die Seite
   * fuer kaputt und sieht kuenftig gar nicht mehr hin.
   */
  it("beschriftet den unauffälligen Fall, statt nichts anzuzeigen", async () => {
    mitDaten(grundgeruest);
    render(<Kennzahlen />);
    expect(await screen.findByText(/Keine Auffälligkeit/)).toBeInTheDocument();
  });

  it("zeigt 'keine Daten' als – und nicht als 0", async () => {
    /*
     * Ein Tag ohne einen einzigen Werkzeugaufruf hat KEINE Fehlerquote. Als
     * "0 %" gelesen waere das der beste Tag der Woche — tatsaechlich war
     * einfach nichts los.
     */
    mitDaten(grundgeruest);
    render(<Kennzahlen />);

    await screen.findByText(/Keine Auffälligkeit/);
    const karte = screen.getByText("Werkzeuge gescheitert").parentElement;
    expect(karte?.textContent).toContain("–");
    expect(karte?.textContent).not.toMatch(/\b0\b/);
  });

  it("zeigt den offenen Zustand als Zahl", async () => {
    mitDaten({ ...grundgeruest, jetzt: { freigabenOffen: 3, meldungenOffen: 1 } });
    render(<Kennzahlen />);

    await screen.findByText("Freigaben offen");
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("nennt bei scheiternden Werkzeugen den Grund, nicht nur die Zahl", async () => {
    mitDaten({
      ...grundgeruest,
      schlechtesteWerkzeuge: [
        { schluessel: "browser_do@kunde.de", fehler: 12, grund: "Element nicht gefunden" },
      ],
    });
    render(<Kennzahlen />);

    expect(await screen.findByText("browser_do@kunde.de")).toBeInTheDocument();
    expect(screen.getByText("Element nicht gefunden")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("verschweigt einen Ladefehler nicht", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("nope", { status: 500 })));
    render(<Kennzahlen />);
    expect(await screen.findByText(/konnten nicht geladen werden/)).toBeInTheDocument();
  });

  it("nimmt den Token mit", async () => {
    localStorage.setItem("lukas_token", "geheim-123");
    const rufe: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      rufe.push({ url: String(url), init });
      return Promise.resolve(
        new Response(JSON.stringify(String(url).endsWith("/verbrauch") ? { stand: new Date().toISOString(), tageswerte: [], modelle: [], liveModelle: [], guthaben: null } : grundgeruest), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    render(<Kennzahlen />);

    await screen.findByText(/Keine Auffälligkeit/);
    const metrics = rufe.find(r => r.url === "/api/lukas/kennzahlen");
    expect(metrics).toBeDefined();
    expect((metrics?.init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer geheim-123",
    );
  });
});
