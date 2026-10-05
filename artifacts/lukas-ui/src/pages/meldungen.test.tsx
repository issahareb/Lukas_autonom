/*
 * Der Meldungs-Tab.
 *
 * Er ist der einzige Rueckkanal von Issa zu Lukas, wenn der allein arbeitet:
 * Lukas fragt, bleibt stehen, und die Antwort hier ist der Grund, warum er
 * weitermacht. Geht sie an die falsche ID oder gar nicht raus, wartet er
 * weiter — ohne dass jemand merkt, worauf.
 *
 * Zwei Dinge, die dabei leicht kaputtgehen und beide teuer sind: eine leere
 * Antwort, die trotzdem abgeschickt wird (die Meldung gilt dann als erledigt,
 * ohne dass etwas beantwortet wurde), und ein Entwurf, der nach dem Senden
 * stehen bleibt (beim naechsten Klick geht er ein zweites Mal raus).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Meldungen from "./meldungen";

type Ruf = { url: string; init?: RequestInit };

function mitMeldungen(rows: unknown[]): Ruf[] {
  const rufe: Ruf[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    rufe.push({ url: String(url), init });
    const body = init?.method === "POST" ? {} : rows;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return rufe;
}

const offen = {
  id: 7,
  betreff: "Zugang zum Kundenpostfach fehlt",
  text: "Ich komme an die Mails nicht ran und kann das Angebot nicht nachfassen.",
  dringend: false,
  status: "offen" as const,
  antwort: null,
  createdAt: new Date().toISOString(),
  erledigtAt: null,
};

describe("Meldungen", () => {
  it("behält alte Meldungen offen und verlangt eine ausdrückliche Aktualitätsbestätigung", async () => {
    const rufe = mitMeldungen([{ ...offen, veraltet: true }]);
    render(<Meldungen />);
    await screen.findByText(/ältere Meldung/);
    expect(screen.queryByText(offen.betreff)).not.toBeInTheDocument();
    expect(screen.getByText("1 offen")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ältere Meldungen prüfen" }));
    expect(screen.getByText(offen.betreff)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Weiterhin aktuell" }));
    expect(rufe.find(r => r.init?.method === "POST")?.url).toBe("/api/lukas/meldungen/7/bestaetigen");
  });

  it("behält den Antwortentwurf bei einem Serverfehler", async () => {
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => init?.method === "POST" ? new Response("", {status:503}) : Response.json([offen]));
    render(<Meldungen />);
    await screen.findByText(offen.betreff);
    await userEvent.type(screen.getByRole("textbox"), "Mein Entwurf");
    await userEvent.click(screen.getByRole("button", {name:/Antworten/}));
    await screen.findByRole("alert");
    expect(screen.getByRole("textbox")).toHaveValue("Mein Entwurf");
  });

  it("zeigt Betreff und Text der offenen Meldung", async () => {
    mitMeldungen([offen]);
    render(<Meldungen />);

    expect(await screen.findByText("Zugang zum Kundenpostfach fehlt")).toBeInTheDocument();
    expect(screen.getByText(/nicht nachfassen/)).toBeInTheDocument();
    expect(screen.getByText("1 offen")).toBeInTheDocument();
  });

  it("schickt die Antwort als JSON an die richtige Meldung", async () => {
    const rufe = mitMeldungen([offen]);
    render(<Meldungen />);
    await screen.findByText("Zugang zum Kundenpostfach fehlt");

    await userEvent.type(screen.getByRole("textbox"), "Zugang liegt im Passwortmanager.");
    await userEvent.click(screen.getByRole("button", { name: /Antworten/ }));

    await waitFor(() => {
      const post = rufe.find((r) => r.init?.method === "POST");
      expect(post?.url).toBe("/api/lukas/meldungen/7/antwort");
      expect(JSON.parse(String(post?.init?.body))).toEqual({
        antwort: "Zugang liegt im Passwortmanager.",
      });
    });
  });

  /*
   * Ohne Text passiert NICHTS.
   *
   * Sonst haekelt ein Fehlklick die Meldung ab: sie gilt als erledigt, Lukas
   * bekommt eine leere Antwort vorgelegt und macht damit weiter — die Frage
   * ist weg, beantwortet ist sie nicht.
   */
  it("schickt eine leere Antwort nicht ab", async () => {
    const rufe = mitMeldungen([offen]);
    render(<Meldungen />);
    await screen.findByText("Zugang zum Kundenpostfach fehlt");

    const taste = screen.getByRole("button", { name: /Antworten/ });
    expect(taste).toBeDisabled();

    await userEvent.type(screen.getByRole("textbox"), "   ");
    expect(taste).toBeDisabled();
    expect(rufe.some((r) => r.init?.method === "POST")).toBe(false);
  });

  it("leert den Entwurf danach, damit er nicht ein zweites Mal rausgeht", async () => {
    mitMeldungen([offen]);
    render(<Meldungen />);
    await screen.findByText("Zugang zum Kundenpostfach fehlt");

    const feld = screen.getByRole("textbox");
    await userEvent.type(feld, "Erledigt.");
    await userEvent.click(screen.getByRole("button", { name: /Antworten/ }));

    await waitFor(() => expect(feld).toHaveValue(""));
  });

  it("nimmt den Token mit", async () => {
    localStorage.setItem("lukas_token", "geheim-123");
    const rufe = mitMeldungen([offen]);
    render(<Meldungen />);
    await screen.findByText("Zugang zum Kundenpostfach fehlt");

    await userEvent.type(screen.getByRole("textbox"), "Ja.");
    await userEvent.click(screen.getByRole("button", { name: /Antworten/ }));

    await waitFor(() => {
      const post = rufe.find((r) => r.init?.method === "POST");
      const kopf = post?.init?.headers as Record<string, string>;
      expect(kopf.Authorization).toBe("Bearer geheim-123");
      expect(kopf["Content-Type"]).toBe("application/json");
    });
  });

  /* Dringend ist nicht nur eine Farbe — sonst sieht es niemand, der Farben
     anders wahrnimmt, und niemand auf einem Ausdruck. */
  it("macht Dringendes ohne Farbe erkennbar", async () => {
    mitMeldungen([{ ...offen, dringend: true }]);
    render(<Meldungen />);
    expect(await screen.findByLabelText("dringend")).toBeInTheDocument();
  });

  it("zeigt bei einer erledigten Meldung Issas Antwort", async () => {
    mitMeldungen([
      {
        ...offen,
        status: "erledigt",
        antwort: "Steht im Passwortmanager unter 'Kunde X'.",
        erledigtAt: new Date().toISOString(),
      },
    ]);
    render(<Meldungen />);

    expect(await screen.findByText(/Steht im Passwortmanager/)).toBeInTheDocument();
    expect(screen.getByText("nichts offen")).toBeInTheDocument();
  });

  it("sagt es, wenn Lukas sich noch nie gemeldet hat", async () => {
    mitMeldungen([]);
    render(<Meldungen />);
    expect(await screen.findByText(/hat sich noch nicht gemeldet/)).toBeInTheDocument();
  });
});
