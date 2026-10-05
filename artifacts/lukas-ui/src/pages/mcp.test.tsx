import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Mcp from "./mcp";

const server = { id: 1, slug: "kalender", name: "Kalender", url: "https://example.com/mcp", status: "connected", tools: [{name: "read"}], selectedTools: [], riskTier: "R2", enabled: true, authorized: true };
function setup() {
  const requests: Array<{url: string; init?: RequestInit}> = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    requests.push({url: String(url), init});
    return Promise.resolve(new Response(JSON.stringify({servers: [server, {...server, id: 2, name: "Ablage", status: "error"}]}), {status: 200, headers: {"content-type": "application/json"}}));
  });
  return requests;
}
describe("Verbindungen", () => {
  it("filtert Dienste und öffnet die Einrichtung erst auf Wunsch", async () => {
    setup(); render(<Mcp />);
    await screen.findByText("Kalender");
    expect(screen.queryByLabelText("Name des Servers")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Prüfen" }));
    expect(screen.getByText("Ablage")).toBeInTheDocument();
    expect(screen.queryByText("Kalender")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Alle Dienste" }));
    await userEvent.type(screen.getByRole("searchbox"), "Kalender");
    expect(screen.getByText("Kalender")).toBeInTheDocument();
    expect(screen.queryByText("Ablage")).not.toBeInTheDocument();
  });
  it("behält beim Anlegen Adresse und Namen bei und schließt den Dialog nach Erfolg", async () => {
    const requests = setup(); render(<Mcp />);
    await userEvent.click(screen.getByRole("button", {name: "Verbindung hinzufügen"}));
    await userEvent.type(screen.getByLabelText("Name des Servers"), "Projekte");
    await userEvent.type(screen.getByLabelText("Adresse des Servers"), "https://example.com/projects");
    await userEvent.click(screen.getByRole("button", {name: "Anlegen"}));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const request = requests.find(r => r.init?.method === "POST");
    expect(request?.url).toBe("/api/lukas/mcp");
    expect(JSON.parse(String(request?.init?.body))).toEqual({name: "Projekte", url: "https://example.com/projects"});
  });
});
