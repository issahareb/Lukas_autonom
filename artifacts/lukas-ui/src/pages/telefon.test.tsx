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
    await userEvent.type(screen.getByLabelText("Telefonnummer"), "+4915112345678");
    await userEvent.type(screen.getByLabelText("Kontaktname"), "Max Muster");
    expect(screen.getByLabelText(/Zustimmung zur Gesprächsaufzeichnung/)).toHaveValue("");
    await userEvent.selectOptions(screen.getByLabelText(/Zustimmung zur Gesprächsaufzeichnung/), "email");
    await userEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));
    await waitFor(() => expect(calls.some(c => c.init?.method === "POST")).toBe(true));
    const saved = JSON.parse(String(calls.find(c => c.init?.method === "POST")?.init?.body));
    expect(saved).toMatchObject({ name: "Max Muster", aufnahmeZustimmung: true, aufnahmeQuelle: "email", darfAngerufenWerden: false });
    expect(screen.getByLabelText(/Zustimmung zur Gesprächsaufzeichnung/)).toHaveValue("");
  });
  it("kann die Zustimmung eines bestehenden Kontakts zurücknehmen", async () => {
    const calls = setup([kontakt]);
    render(<Telefon />);
    await screen.findAllByText("Max Muster");
    await userEvent.selectOptions(screen.getAllByLabelText(/Zustimmung zur Gesprächsaufzeichnung/)[1], "");
    await waitFor(() => expect(calls.some(c => c.init?.method === "PATCH")).toBe(true));
    const patch = calls.find(c => c.init?.method === "PATCH")!;
    expect(patch.url).toBe("/api/lukas/telefon/7");
    expect(JSON.parse(String(patch.init?.body))).toEqual({ aufnahmeZustimmung: false, aufnahmeQuelle: "" });
    expect(calls.some(c => c.url.includes("testanruf"))).toBe(false);
  });
  it("zeigt Aufnahmen erst nach bestätigter Fertigstellung und lädt sie nur auf Klick", async () => {
    const calls = setup([kontakt], [{ id: 12, nummer: kontakt.nummer, richtung: "ausgehend", ergebnis: "beendet", createdAt: "2026-10-04T10:05:00Z", aufnahmeStatus: "completed", aufnahmeDauer: 34 }]);
    render(<Telefon />);
    expect(await screen.findByRole("button", { name: /Aufnahme anhören/ })).toBeEnabled();
    expect(calls.some(c => c.url.endsWith("/aufnahme"))).toBe(false);
  });
});
