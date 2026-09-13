/*
 * Der Block ganz oben auf der Startseite.
 *
 * Er hat einen einzigen Zweck: dass Issa etwas SIEHT, ohne es zu suchen, und
 * es an Ort und Stelle erledigen kann. Eine Übersicht, die nur zählt und zum
 * Weiterklicken auffordert, wird zum Zähler, der wochenlang auf 3 steht.
 *
 * Deshalb prüft der Test nicht nur, ob etwas dasteht, sondern ob die
 * Handgriffe von hier aus wirklich ankommen — mit der richtigen ID und dem
 * richtigen Verb. Eine Freigabe von der Startseite aus ist genauso bindend
 * wie eine aus dem Freigabe-Tab.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WartetAufDich } from "./wartet-auf-dich";

type Ruf = { url: string; init?: RequestInit };

const freigabe = {
  id: 42,
  tool: "email_send",
  riskTier: "R2",
  argumentsPreview: 'an: "kunde@example.com"\nbetreff: "Angebot"',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

const meldung = {
  id: 7,
  betreff: "Zugang zum Kundenpostfach fehlt",
  text: "Ich komme an die Mails nicht ran.",
  dringend: false,
  createdAt: new Date().toISOString(),
};

const leer = { meldungen: [], freigaben: [], gesamt: { meldungen: 0, freigaben: 0 } };

function mitAntwort(daten: unknown): Ruf[] {
  const rufe: Ruf[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    rufe.push({ url: String(url), init });
    const body = init?.method === "POST" ? {} : daten;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return rufe;
}

describe("Wartet auf dich", () => {
  it("zeigt Meldung und Freigabe mit dem, worauf es ankommt", async () => {
    mitAntwort({
      meldungen: [meldung],
      freigaben: [freigabe],
      gesamt: { meldungen: 1, freigaben: 1 },
    });
    render(<WartetAufDich />);

    expect(await screen.findByText("Zugang zum Kundenpostfach fehlt")).toBeInTheDocument();
    expect(screen.getByText("email_send")).toBeInTheDocument();
    // Das WORT, nicht der Code: in der Oberflaeche steht "heikel" statt "R2".
    expect(screen.getByText("heikel")).toBeInTheDocument();
    /* Man gibt frei, was man sieht — der Werkzeugname allein ist eine
       Unterschrift auf einem leeren Blatt. */
    expect(screen.getByText(/kunde@example\.com/)).toBeInTheDocument();
  });

  it("erlaubt direkt von der Startseite aus — richtige ID, richtiges Verb", async () => {
    const rufe = mitAntwort({ meldungen: [], freigaben: [freigabe], gesamt: { meldungen: 0, freigaben: 1 } });
    render(<WartetAufDich />);
    await screen.findByText("email_send");

    await userEvent.click(screen.getByRole("button", { name: /Erlauben/ }));

    await waitFor(() => {
      const post = rufe.find((r) => r.init?.method === "POST");
      expect(post?.url).toBe("/api/lukas/approvals/42/allow");
    });
  });

  it("lehnt mit deny ab, nicht mit allow", async () => {
    const rufe = mitAntwort({ meldungen: [], freigaben: [freigabe], gesamt: { meldungen: 0, freigaben: 1 } });
    render(<WartetAufDich />);
    await screen.findByText("email_send");

    await userEvent.click(screen.getByRole("button", { name: /Ablehnen/ }));

    await waitFor(() => {
      const post = rufe.find((r) => r.init?.method === "POST");
      expect(post?.url).toBe("/api/lukas/approvals/42/deny");
    });
    expect(rufe.every((r) => !r.url.includes("/allow"))).toBe(true);
  });

  /*
   * "Für die Aufgabe" ist die Entscheidung, die Issa meistens meint: er hat
   * einen Auftrag erteilt, nicht einen einzelnen Aufruf erlaubt. Sie führt
   * auf eine ANDERE Route — geht die verloren, klickt er weiter sechsmal, ohne
   * dass irgendwo ein Fehler erschiene.
   */
  it("gibt für die ganze Aufgabe frei — eigene Route", async () => {
    const rufe = mitAntwort({ meldungen: [], freigaben: [freigabe], gesamt: { meldungen: 0, freigaben: 1 } });
    render(<WartetAufDich />);
    await screen.findByText("email_send");

    await userEvent.click(screen.getByRole("button", { name: /Für die Aufgabe/ }));

    await waitFor(() => {
      const post = rufe.find((r) => r.init?.method === "POST");
      expect(post?.url).toBe("/api/lukas/approvals/42/allow-auftrag");
    });
  });

  /*
   * Bei R3 darf es den Knopf NICHT geben. Geld, Zugangsdaten und
   * Unumkehrbares bleiben Einzelentscheidungen — der Server lehnt es zwar
   * ohnehin ab, aber ein Knopf, der nichts tut, ist eine Lüge.
   */
  it("bietet bei R3 keine Freigabe für die ganze Aufgabe an", async () => {
    mitAntwort({
      meldungen: [],
      freigaben: [{ ...freigabe, riskTier: "R3" }],
      gesamt: { meldungen: 0, freigaben: 1 },
    });
    render(<WartetAufDich />);
    await screen.findByText("email_send");

    expect(screen.queryByRole("button", { name: /Für die Aufgabe/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Erlauben/ })).toBeInTheDocument();
  });

  it("beantwortet eine Meldung an Ort und Stelle", async () => {
    const rufe = mitAntwort({ meldungen: [meldung], freigaben: [], gesamt: { meldungen: 1, freigaben: 0 } });
    render(<WartetAufDich />);
    await screen.findByText("Zugang zum Kundenpostfach fehlt");

    const feld = screen.getByLabelText(/Antwort auf Zugang zum Kundenpostfach/);
    await userEvent.type(feld, "Liegt im Passwortmanager.");
    await userEvent.click(screen.getByRole("button", { name: /Antworten/ }));

    await waitFor(() => {
      const post = rufe.find((r) => r.init?.method === "POST");
      expect(post?.url).toBe("/api/lukas/meldungen/7/antwort");
      expect(JSON.parse(String(post?.init?.body))).toEqual({
        antwort: "Liegt im Passwortmanager.",
      });
    });
    await waitFor(() => expect(feld).toHaveValue(""));
  });

  it("schickt keine leere Antwort", async () => {
    const rufe = mitAntwort({ meldungen: [meldung], freigaben: [], gesamt: { meldungen: 1, freigaben: 0 } });
    render(<WartetAufDich />);
    await screen.findByText("Zugang zum Kundenpostfach fehlt");

    expect(screen.getByRole("button", { name: /Antworten/ })).toBeDisabled();
    expect(rufe.some((r) => r.init?.method === "POST")).toBe(false);
  });

  /*
   * Nichts offen ist eine NACHRICHT. Ohne diesen Satz wirkt die Startseite
   * kaputt, wenn gerade nichts ansteht — und dann glaubt man ihr auch nicht
   * mehr, wenn doch etwas dasteht.
   */
  it("sagt es, wenn nichts offen ist", async () => {
    mitAntwort(leer);
    render(<WartetAufDich />);
    expect(await screen.findByText(/Nichts offen/)).toBeInTheDocument();
  });

  it("nennt ehrlich, wie viel nicht gezeigt wird", async () => {
    mitAntwort({
      meldungen: [meldung],
      freigaben: [freigabe],
      gesamt: { meldungen: 4, freigaben: 9 },
    });
    render(<WartetAufDich />);

    await screen.findByText("email_send");
    expect(screen.getByText(/und 8 weitere/)).toBeInTheDocument();
    expect(screen.getByText(/und 3 weitere/)).toBeInTheDocument();
  });

  it("macht Dringendes ohne Farbe erkennbar", async () => {
    mitAntwort({
      meldungen: [{ ...meldung, dringend: true }],
      freigaben: [],
      gesamt: { meldungen: 1, freigaben: 0 },
    });
    render(<WartetAufDich />);
    expect(await screen.findByLabelText("dringend")).toBeInTheDocument();
  });

  it("nimmt den Token mit", async () => {
    localStorage.setItem("lukas_token", "geheim-123");
    const rufe = mitAntwort(leer);
    render(<WartetAufDich />);
    await screen.findByText(/Nichts offen/);

    expect(rufe[0].url).toBe("/api/lukas/wartet");
    expect((rufe[0].init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer geheim-123",
    );
  });
});
