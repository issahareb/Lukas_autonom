import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Verbrauch from "./verbrauch";

const tokens = { aufrufe: 12, eingabe: 1_000_000, ausgabe: 200_000, cacheLesen: 400_000, cacheSchreiben: 100, gesamt: 1_600_100 };
const bericht = {
  stand: "2026-10-05T10:00:00Z", guthaben: { usd: 42.5, organisation: "Issa", bestaetigtAt: "2026-10-04T09:00:00Z" },
  tageswerte: [
    { ...tokens, tag: "2026-10-04", erfasst: true, liveSekunden: 120, liveSitzungen: 1, liveOhneMesswert: 0, liveOffen: 0 },
    { ...tokens, aufrufe: 0, gesamt: 0, tag: "2026-10-05", erfasst: false, liveSekunden: 0, liveSitzungen: 0, liveOhneMesswert: 0, liveOffen: 0 },
  ],
  modelle: [{ ...tokens, provider: "openai", model: "gpt-6.1-sol", quelle: "chat" }],
  liveModelle: [{ model: "gpt-live-1", quelle: "telefon", sekunden: 120, sitzungen: 1, ohneMesswert: 0, offen: 0 }],
};

describe("Verbrauch und Guthaben", () => {
  it("zeigt exakte Zahlen, Messlücken und den datierten manuellen Guthabenstand", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(bericht)));
    render(<Verbrauch />);
    expect(await screen.findByText("1.600.100 Tokens")).toBeInTheDocument();
    expect(screen.getByText("Keine Tokenmessung")).toBeInTheDocument();
    expect(screen.getByText(/Manuell bestätigt/)).toHaveTextContent("Issa");
    expect(screen.getByText(/keine Live-Abfrage/)).toBeInTheDocument();
    expect(screen.getByText("2 Minuten")).toBeInTheDocument();
    const row = screen.getByText("gpt-6.1-sol").closest("tr")!;
    expect(within(row).getByText("400.000")).toBeInTheDocument();
  });
  it("speichert USD mit Organisation und behält bei Fehlern den bisherigen Stand", async () => {
    const calls: {url: string; init?: RequestInit}[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({url, init}); return init?.method === "PUT" ? new Response("", {status:503}) : Response.json(bericht);
    });
    localStorage.setItem("lukas_token", "test-only");
    render(<Verbrauch />);
    await screen.findByText(/Manuell bestätigt/);
    await userEvent.click(screen.getByText("Guthabenstand übernehmen"));
    await userEvent.type(screen.getByLabelText("OpenAI-Organisation"), "Meine Organisation");
    await userEvent.type(screen.getByLabelText("Guthaben in USD"), "17,25");
    await userEvent.click(screen.getByRole("button", {name:"Als aktuellen Stand speichern"}));
    await screen.findByText(/Speichern fehlgeschlagen/);
    const put = calls.find(c => c.init?.method === "PUT")!;
    expect(put.url).toBe("/api/lukas/openai-guthaben");
    expect(JSON.parse(String(put.init?.body))).toEqual({usd:17.25, organisation:"Meine Organisation"});
    expect((put.init?.headers as Record<string,string>).Authorization).toBe("Bearer test-only");
    expect(screen.getByLabelText("Guthaben in USD")).toHaveValue("17,25");
    expect(screen.getByText(/Manuell bestätigt/)).toHaveTextContent("Issa");
  });
  it("behält Messwerte bei fehlgeschlagener Aktualisierung sichtbar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(bericht)).mockResolvedValue(new Response("", {status:503})));
    render(<Verbrauch />);
    await screen.findByText("1.600.100 Tokens");
    await userEvent.click(screen.getByRole("button", {name:"Aktualisieren"}));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("letzten erfolgreichen Abruf"));
    expect(screen.getByText("1.600.100 Tokens")).toBeInTheDocument();
  });
});
