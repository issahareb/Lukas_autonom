/*
 * Die Zugangs-Seite.
 *
 * Der Test, der hier zaehlt, ist ein negativer: diese Oberflaeche darf einen
 * hinterlegten Wert NIE anzeigen — nicht als Punkte, nicht ausgegraut, nicht
 * hinter einem Klick. Sie kennt ihn gar nicht, weil die API ihn nicht
 * herausgibt, und der Test haelt fest, dass das so bleibt.
 *
 * Dazu zwei Dinge, die im Alltag schiefgehen: das Wertfeld muss nach dem
 * Speichern sofort leer sein (sonst nimmt es ein Screenshot oder ein Blick
 * ueber die Schulter mit), und ohne gesetzten Schluessel muss die Seite es
 * SAGEN, statt still nichts zu speichern.
 *
 * Und ein drittes, seit es die Host-Bindung gibt: ein Zugang OHNE Website
 * darf nicht aussehen wie einer mit. Die Bindung ist das, was verhindert,
 * dass ein Schrittplan das Passwort auf einer fremden Seite eintippt — fehlt
 * sie, muss die Zeile das sichtbar sagen, sonst haelt Issa den Zugang fuer
 * enger, als er ist.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Zugaenge from "./zugaenge";

type Ruf = { url: string; init?: RequestInit };

const eintrag = {
  sitzung: "higgsfield",
  feld: "PASSWORT",
  host: "higgsfield.ai",
  notiz: "Studio-Login",
  zuletztBenutzt: null,
  createdAt: new Date().toISOString(),
};

function mitAntwort(daten: unknown): Ruf[] {
  const rufe: Ruf[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    rufe.push({ url: String(url), init });
    const body = init && init.method && init.method !== "GET" ? {} : daten;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return rufe;
}

describe("Zugänge", () => {
  it("zeigt den Platzhalter, aber niemals einen Wert", async () => {
    /*
     * Die Antwort enthaelt absichtlich zusaetzliche Felder, die ein Server
     * nach einer unachtsamen Aenderung mitschicken koennte. Kommt davon
     * etwas auf den Schirm, faellt der Test — auch wenn es "nur" der
     * Kryptotext ist.
     */
    mitAntwort({
      bereit: true,
      zugaenge: [{ ...eintrag, geheim: "AAA:BBB:CCC", wert: "S3hr-Geheim!" }],
    });
    render(<Zugaenge />);

    expect(await screen.findByText("{{PASSWORT}}")).toBeInTheDocument();
    expect(screen.getByText("higgsfield")).toBeInTheDocument();
    expect(screen.getByText("Studio-Login")).toBeInTheDocument();

    expect(document.body.textContent).not.toContain("S3hr-Geheim!");
    expect(document.body.textContent).not.toContain("AAA:BBB:CCC");
  });

  it("schickt den neuen Zugang an die richtige Route", async () => {
    const rufe = mitAntwort({ bereit: true, zugaenge: [] });
    render(<Zugaenge />);
    await screen.findByText(/Noch nichts hinterlegt/);

    await userEvent.type(screen.getByLabelText(/Sitzung/), "higgsfield");
    await userEvent.type(screen.getByLabelText(/^Feld$/), "PASSWORT");
    await userEvent.type(screen.getByLabelText(/^Wert$/), "geheim123");
    await userEvent.type(screen.getByLabelText(/Nur auf dieser Website/), "higgsfield.ai");
    await userEvent.click(screen.getByRole("button", { name: /Speichern/ }));

    await waitFor(() => {
      const put = rufe.find((r) => r.init?.method === "PUT");
      expect(put?.url).toBe("/api/lukas/zugaenge");
      expect(JSON.parse(String(put?.init?.body))).toMatchObject({
        sitzung: "higgsfield",
        feld: "PASSWORT",
        wert: "geheim123",
        /* Ohne diese Zeile kommt der Host nie beim Server an, und die
           Bindung existiert nur in der Oberflaeche. */
        host: "higgsfield.ai",
      });
    });
  });

  it("leert das Wertfeld sofort nach dem Speichern", async () => {
    mitAntwort({ bereit: true, zugaenge: [] });
    render(<Zugaenge />);
    await screen.findByText(/Noch nichts hinterlegt/);

    await userEvent.type(screen.getByLabelText(/Sitzung/), "x");
    await userEvent.type(screen.getByLabelText(/^Feld$/), "PIN");
    const wertfeld = screen.getByLabelText(/^Wert$/);
    await userEvent.type(wertfeld, "4711");
    await userEvent.click(screen.getByRole("button", { name: /Speichern/ }));

    await waitFor(() => expect(wertfeld).toHaveValue(""));
  });

  it("verdeckt die Eingabe schon beim Tippen", async () => {
    mitAntwort({ bereit: true, zugaenge: [] });
    render(<Zugaenge />);
    await screen.findByText(/Noch nichts hinterlegt/);
    expect(screen.getByLabelText(/^Wert$/)).toHaveAttribute("type", "password");
  });

  it("speichert nicht ohne Sitzung, Feld und Wert", async () => {
    const rufe = mitAntwort({ bereit: true, zugaenge: [] });
    render(<Zugaenge />);
    await screen.findByText(/Noch nichts hinterlegt/);

    const taste = screen.getByRole("button", { name: /Speichern/ });
    expect(taste).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Sitzung/), "x");
    await userEvent.type(screen.getByLabelText(/^Feld$/), "PIN");
    expect(taste).toBeDisabled(); // der Wert fehlt noch
    expect(rufe.some((r) => r.init?.method === "PUT")).toBe(false);
  });

  /*
   * Ohne Schluessel wird serverseitig nichts gespeichert. Sagt die Seite das
   * nicht, tippt Issa sein Passwort ein, sieht keinen Fehler und glaubt, es
   * liege jetzt bereit — und wundert sich spaeter ueber eine fehlgeschlagene
   * Anmeldung.
   */
  it("sagt es, wenn kein Schlüssel gesetzt ist", async () => {
    mitAntwort({ bereit: false, zugaenge: [] });
    render(<Zugaenge />);
    expect(await screen.findByText(/Kein Schlüssel gesetzt/)).toBeInTheDocument();
    expect(screen.getByText(/LUKAS_TRESOR_SCHLUESSEL/)).toBeInTheDocument();
  });

  it("löscht über Sitzung und Feld", async () => {
    const rufe = mitAntwort({ bereit: true, zugaenge: [eintrag] });
    render(<Zugaenge />);
    await screen.findByText("{{PASSWORT}}");

    await userEvent.click(screen.getByRole("button", { name: /PASSWORT löschen/ }));

    await waitFor(() => {
      const weg = rufe.find((r) => r.init?.method === "DELETE");
      expect(weg?.url).toBe("/api/lukas/zugaenge/higgsfield/PASSWORT");
    });
  });

  /*
   * Die Bindung ist der Unterschied zwischen "Lukas darf sich bei Higgsfield
   * anmelden" und "Lukas darf dieses Passwort ueberall eintippen". Beides sah
   * in der Liste identisch aus, solange die Zeile den Host verschwieg.
   */
  it("zeigt, auf welche Website ein Zugang gebunden ist", async () => {
    mitAntwort({ bereit: true, zugaenge: [eintrag] });
    render(<Zugaenge />);

    expect(await screen.findByText(/nur auf higgsfield\.ai/)).toBeInTheDocument();
    expect(screen.queryByText(/gilt überall/)).not.toBeInTheDocument();
  });

  it("warnt sichtbar, wenn ein Zugang ohne Website-Bindung liegt", async () => {
    mitAntwort({ bereit: true, zugaenge: [{ ...eintrag, host: "" }] });
    render(<Zugaenge />);

    const warnung = await screen.findByText(/ohne Website-Bindung/);
    expect(warnung).toBeInTheDocument();
    /* Nicht bloss vorhanden, sondern als Warnung erkennbar: eine graue Zeile
       neben allen anderen grauen Zeilen liest niemand als Hinweis. */
    expect(warnung.className).toContain("amber");
    expect(screen.queryByText(/^nur auf /)).not.toBeInTheDocument();
  });

  it("zeigt den Grund, wenn der Server ablehnt", async () => {
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "PUT"
          ? new Response(JSON.stringify({ error: "\"mein feld\" taugt nicht als Feldname." }), {
              status: 400,
              headers: { "content-type": "application/json" },
            })
          : new Response(JSON.stringify({ bereit: true, zugaenge: [] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
      ),
    );
    render(<Zugaenge />);
    await screen.findByText(/Noch nichts hinterlegt/);

    await userEvent.type(screen.getByLabelText(/Sitzung/), "x");
    await userEvent.type(screen.getByLabelText(/^Feld$/), "y");
    await userEvent.type(screen.getByLabelText(/^Wert$/), "z");
    await userEvent.click(screen.getByRole("button", { name: /Speichern/ }));

    expect(await screen.findByText(/taugt nicht als Feldname/)).toBeInTheDocument();
  });
});
