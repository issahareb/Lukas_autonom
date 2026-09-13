/*
 * Die Startseite.
 *
 * Sie ist das Erste, was man von Lukas sieht, und sie hat nur wenige
 * bewegliche Teile — aber jedes davon sagt etwas aus. Geprüft wird deshalb
 * nicht, ob es hübsch ist (das kann kein Test), sondern ob die Aussagen
 * stimmen:
 *
 *  1. Der Orb zeigt den Zustand, in dem Lukas WIRKLICH ist. Ein Orb, der
 *     "hört zu" zeigt, während das Mikro aus ist, ist schlimmer als gar
 *     keine Anzeige.
 *  2. Die Taste rechts wechselt mit dem, was man tut. Wer tippt, will
 *     senden; wer nicht tippt, will reden. Steht dort die falsche, schickt
 *     ein Klick die Frage nicht ab — oder öffnet ungefragt das Mikro.
 *  3. Die Frage geht nicht verloren. Sie wird an den Chat übergeben; kommt
 *     sie dort nicht an, hat man sie umsonst getippt.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigiert: string[] = [];
vi.mock("wouter", () => ({
  useLocation: () => ["/", (ziel: string) => navigiert.push(ziel)],
}));

// Der Sprachkanal wird gestellt: eine echte WebRTC-Verbindung hat in einem
// Test nichts verloren, und geprüft wird hier, was die Seite DARAUS macht.
const sprachStand = {
  status: "aus" as string,
  fehler: null as string | null,
  zeilen: [] as { role: "user" | "assistant"; text: string }[],
  mikro: null,
  ausgabe: null,
  aktiv: false,
  starten: vi.fn(),
  beenden: vi.fn(),
};
vi.mock("@/hooks/use-sprachsitzung", () => ({
  useSprachsitzung: () => sprachStand,
}));
vi.mock("@/hooks/use-audio-pegel", () => ({
  useAudioPegel: () => ({ current: 0 }),
}));

// Die Kacheln zeigen echte Werte. Hier stehen feste, damit der Test prüft,
// dass sie ANKOMMEN — nicht, was der Server gerade zufällig liefert.
const dashboardStand = {
  data: {
    status: {
      mood: "wach",
      energy: "hoch",
      obsession: "Die Migrationskette",
      note: "",
      activeGoalsCount: 3,
      memoriesCount: 128,
      lastActive: new Date().toISOString(),
    },
    recentDiary: [{ id: 1, content: "Heute lief der Umstieg.", createdAt: new Date().toISOString() }],
    recentMemories: [{ id: 1, content: "Issa mag kurze Antworten.", createdAt: new Date().toISOString() }],
    activeGoals: [],
    mediaJobs: [],
    recentEmotions: [],
    character: null,
  } as unknown,
};
vi.mock("@workspace/api-client-react", () => ({
  useGetLukasDashboard: () => dashboardStand,
}));
// Der Block "Wartet auf dich" holt sich eigene Daten; er hat hier nichts zu
// prüfen und wird deshalb stillgelegt.
vi.mock("@/components/wartet-auf-dich", () => ({ WartetAufDich: () => null }));

import Dashboard from "./dashboard";

beforeEach(() => {
  navigiert.length = 0;
  sessionStorage.clear();
  Object.assign(sprachStand, {
    status: "aus",
    fehler: null,
    zeilen: [],
    aktiv: false,
    starten: vi.fn(),
    beenden: vi.fn(),
  });
});

describe("Startseite", () => {
  it("zeigt den Orb in Ruhe, solange nichts läuft", () => {
    render(<Dashboard />);
    expect(screen.getByTestId("orb-ruhe")).toBeTruthy();
    expect(screen.getByLabelText("Lukas wartet")).toBeTruthy();
  });

  it("zeigt 'hört zu' und 'spricht' genau dann, wenn es auch so ist", () => {
    sprachStand.status = "hoert";
    sprachStand.aktiv = true;
    const { rerender } = render(<Dashboard />);
    expect(screen.getByTestId("orb-hoert")).toBeTruthy();

    sprachStand.status = "spricht";
    rerender(<Dashboard />);
    expect(screen.getByTestId("orb-spricht")).toBeTruthy();
  });

  it("bietet die Stimme an, solange nichts getippt ist", () => {
    render(<Dashboard />);
    expect(screen.getByLabelText("Mit Lukas sprechen")).toBeTruthy();
    expect(screen.queryByLabelText("Senden")).toBeNull();
  });

  it("wechselt auf Senden, sobald etwas im Feld steht", async () => {
    const nutzer = userEvent.setup();
    render(<Dashboard />);
    await nutzer.type(screen.getByLabelText("Frage an Lukas"), "Was ist heute wichtig?");

    expect(screen.getByLabelText("Senden")).toBeTruthy();
    // Sonst öffnete ein Klick auf dieselbe Stelle ungefragt das Mikrofon.
    expect(screen.queryByLabelText("Mit Lukas sprechen")).toBeNull();
  });

  it("übergibt die Frage an den Chat und leert das Feld", async () => {
    const nutzer = userEvent.setup();
    render(<Dashboard />);
    const feld = screen.getByLabelText("Frage an Lukas") as HTMLTextAreaElement;
    await nutzer.type(feld, "Wie steht es um die Ziele?");
    await nutzer.click(screen.getByLabelText("Senden"));

    await waitFor(() => {
      expect(sessionStorage.getItem("lukas_startfrage")).toBe("Wie steht es um die Ziele?");
    });
    expect(navigiert).toContain("/chat");
    expect(feld.value).toBe("");
  });

  it("schickt keine leere Frage ab", async () => {
    const nutzer = userEvent.setup();
    render(<Dashboard />);
    // Nur Leerzeichen: die Taste bleibt die Stimme, es gibt nichts zu senden.
    await nutzer.type(screen.getByLabelText("Frage an Lukas"), "   ");
    expect(screen.queryByLabelText("Senden")).toBeNull();
    expect(sessionStorage.getItem("lukas_startfrage")).toBeNull();
    expect(navigiert).toHaveLength(0);
  });

  it("startet das Gespräch auf Klick und beendet es auf denselben Platz", async () => {
    const nutzer = userEvent.setup();
    const { rerender } = render(<Dashboard />);
    await nutzer.click(screen.getByLabelText("Mit Lukas sprechen"));
    expect(sprachStand.starten).toHaveBeenCalled();

    sprachStand.status = "hoert";
    sprachStand.aktiv = true;
    rerender(<Dashboard />);
    await nutzer.click(screen.getByLabelText("Gespräch beenden"));
    expect(sprachStand.beenden).toHaveBeenCalled();
  });

  it("zeigt einen Fehler der Sprachverbindung an, statt still zu bleiben", () => {
    sprachStand.status = "fehler";
    sprachStand.fehler = "Mikrofon nicht erlaubt";
    render(<Dashboard />);
    expect(screen.getByText("Mikrofon nicht erlaubt")).toBeTruthy();
  });

  it("zeigt in den Kacheln, was Lukas wirklich gerade hat", () => {
    render(<Dashboard />);
    // Ohne diese Werte wäre die Seite hübsch und leer — genau das war der
    // Grund, die alte Übersicht zurückzuholen.
    expect(screen.getByText("wach")).toBeTruthy();
    expect(screen.getByText("Die Migrationskette")).toBeTruthy();
    expect(screen.getByText("128 Erinnerungen")).toBeTruthy();
    expect(screen.getByText("3 aktive Ziele")).toBeTruthy();
  });

  it("führt von einer Kachel dorthin, wo mehr davon steht", async () => {
    const nutzer = userEvent.setup();
    render(<Dashboard />);
    await nutzer.click(screen.getByText("128 Erinnerungen"));
    expect(navigiert).toContain("/memory");
  });
});
