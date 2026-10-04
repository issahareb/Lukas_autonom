import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Telefon from "./telefon";

const kontakt = { id: 7, nummer: "4915112345678", name: "Max Muster", stufe: "oeffentlich", darfAngerufenWerden: true,
  aufnahmeZustimmung: true, aufnahmeQuelle: "homepage", aufnahmeBestaetigtAm: "2026-10-04T10:00:00Z" };
function setup(nummern: unknown[] = [], anrufe: unknown[] = []) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = String(url).endsWith("/telnyx") ? {} : String(url).endsWith("/sms") ? { sms: [], bereit: false }
      : { nummern, anrufe, bereit: { webhook: true, anrufen: true }, anbieter: "telnyx" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}
describe("Telefonkontakte", () => {
  it("speichert Namen und ausdrückliche Aufnahmezustimmung getrennt von der Anruffreigabe", async () => {
    const calls = setup();
    render(<Telefon />);
    await userEvent.click(screen.getByRole("button", { name: "Kontakt hinzufügen" }));
    await userEvent.type(screen.getByLabelText("Telefonnummer"), "+4915112345678");
    await userEvent.type(screen.getByLabelText("Kontaktname"), "Max Muster");
    expect(screen.getByLabelText(/Zustimmung zur Gesprächsaufzeichnung/)).toHaveValue("");
    await userEvent.selectOptions(screen.getByLabelText(/Zustimmung zur Gesprächsaufzeichnung/), "email");
    expect(screen.getByLabelText(/Schriftliche Zustimmung zum Live-Mithören/)).toHaveValue("");
    await userEvent.selectOptions(screen.getByLabelText(/Schriftliche Zustimmung zum Live-Mithören/), "homepage");
    await userEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));
    await waitFor(() => expect(calls.some(c => c.init?.method === "POST")).toBe(true));
    const saved = JSON.parse(String(calls.find(c => c.init?.method === "POST")?.init?.body));
    expect(saved).toMatchObject({ name: "Max Muster", aufnahmeZustimmung: true, aufnahmeQuelle: "email", darfAngerufenWerden: false, mithoerenZustimmung: true, mithoerenQuelle: "homepage" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("kann die Zustimmung eines bestehenden Kontakts zurücknehmen", async () => {
    const calls = setup([kontakt]);
    render(<Telefon />);
    await screen.findAllByText("Max Muster");
    await userEvent.click(screen.getByText("Kontakt bearbeiten"));
    await userEvent.selectOptions(screen.getByLabelText(/Zustimmung zur Gesprächsaufzeichnung/), "");
    await waitFor(() => expect(calls.some(c => c.init?.method === "PATCH")).toBe(true));
    const patch = calls.find(c => c.init?.method === "PATCH")!;
    expect(patch.url).toBe("/api/lukas/telefon/7");
    expect(JSON.parse(String(patch.init?.body))).toEqual({ aufnahmeZustimmung: false, aufnahmeQuelle: "" });
    expect(calls.some(c => c.url.includes("testanruf"))).toBe(false);
  });
  it("zeigt Aufnahmen erst nach bestätigter Fertigstellung und lädt sie nur auf Klick", async () => {
    const calls = setup([kontakt], [{ id: 12, nummer: kontakt.nummer, richtung: "ausgehend", ergebnis: "beendet", createdAt: "2026-10-04T10:05:00Z", aufnahmeStatus: "completed", aufnahmeDauer: 34 }]);
    render(<Telefon />);
    await userEvent.click(await screen.findByRole("tab", { name: /Aufnahmen/ }));
    expect(await screen.findByRole("button", { name: /Aufnahme anhören/ })).toBeEnabled();
    expect(calls.some(c => c.url.endsWith("/aufnahme"))).toBe(false);
  });
  it("zeigt kompakte Kontakte, durchsucht auch nicht angezeigte Kontakte und erreicht Aufnahmen direkt", async () => {
    setup(Array.from({ length: 25 }, (_, i) => ({ ...kontakt, id: i + 1, name: `Kontakt ${i + 1}`, nummer: `4915112300${i + 1}` })), [{ id: 90, nummer: kontakt.nummer, richtung: "ausgehend", ergebnis: "beendet", createdAt: "2026-10-04T10:05:00Z", aufnahmeStatus: "completed" }]);
    render(<Telefon />);
    await screen.findByRole("heading", { name: "Kontakt 1" });
    expect(screen.queryByRole("heading", { name: "Kontakt 25" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Kontaktname" })).toBeNull();
    expect(screen.queryByText(/Telnyx · Ein/)).toBeNull();
    await userEvent.type(screen.getByRole("searchbox"), "Kontakt 25");
    expect(screen.getByRole("heading", { name: "Kontakt 25" })).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: /Aufnahmen/ }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: /Aufnahme anhören/ })).toBeVisible();
  });
});
