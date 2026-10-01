import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lege, type Gehirn } from "@/components/gehirn/modell";
const scene = vi.hoisted(() => ({
  update: vi.fn(),
  fokus: vi.fn(),
  zoom: vi.fn(),
  eintauchen: vi.fn(),
  dispose: vi.fn(),
}));
const createScene = vi.hoisted(() => vi.fn(() => scene));
vi.mock("@/components/gehirn/szene", () => ({ erschaffeSzene: createScene }));
import GehirnSeite from "./gehirn";

const knoten = [
  { id: "a", art: "thema", titel: "TaxiBB Essen" },
  { id: "b", art: "erinnerung", titel: "Website planen" },
  { id: "c", art: "aussage", titel: "Domainwissen" },
].map((k) => ({
  ...k,
  gewicht: 0.5,
  text: "Testinhalt",
  daten: {},
  datei: "",
  ordner: "",
}));
const graph: Gehirn = {
  stand: "2026-09-15T10:00:00Z",
  zahlen: {},
  knoten,
  kanten: [
    { von: "a", nach: "b", art: "Thema", gewicht: 0.5 },
    { von: "b", nach: "c", art: "belegt", gewicht: 0.5 },
  ],
};
const workers: { terminate: ReturnType<typeof vi.fn> }[] = [];
beforeEach(() => {
  workers.length = 0;
  Object.values(scene).forEach((fn) => fn.mockClear());
  createScene.mockReset().mockReturnValue(scene);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => graph }),
  );
  vi.stubGlobal(
    "Worker",
    class {
      onmessage:
        ((e: { data: { raum: ReturnType<typeof lege> } }) => void) | null =
        null;
      terminate = vi.fn();
      constructor() {
        workers.push(this);
      }
      postMessage(g: Gehirn) {
        queueMicrotask(() => this.onmessage?.({ data: { raum: lege(g) } }));
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("Gehirnansicht", () => {
  it("speichert die umgekehrte Drehrichtung und übergibt sie an die Szene", async () => {
    const user = userEvent.setup();
    const view = render(<GehirnSeite />);
    await waitFor(() => expect(createScene).toHaveBeenCalled());
    await user.click(
      screen.getByRole("button", { name: "Darstellung erklären" }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Drehrichtung umkehren" }),
    ).toBeChecked();
    await user.click(
      screen.getByRole("checkbox", { name: "Drehrichtung umkehren" }),
    );
    expect(scene.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ invertiert: false }),
    );
    expect(localStorage.getItem("lukas_gehirn_invertiert")).toBe("false");
    view.unmount();
    render(<GehirnSeite />);
    await waitFor(() => expect(createScene).toHaveBeenCalledTimes(2));
    expect(scene.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ invertiert: false }),
    );
  });

  it("bietet mobile Nahfahrt, Rückweg und eine große Ansicht", async () => {
    const user = userEvent.setup();
    render(<GehirnSeite />);
    await user.click(
      await screen.findByRole("button", { name: /TaxiBB Essen/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /Hineinfliegen: TaxiBB Essen/ }),
    );
    expect(scene.eintauchen).toHaveBeenCalledWith("a");
    await user.click(screen.getByRole("button", { name: "Hineinzoomen" }));
    expect(scene.zoom).toHaveBeenCalledWith(0.8);
    await user.click(screen.getByRole("button", { name: "Herauszoomen" }));
    expect(scene.zoom).toHaveBeenCalledWith(1.2);
    await user.click(
      screen.getByRole("button", { name: "Ansicht vergrößern" }),
    );
    expect(screen.getByTestId("gehirn-stage").className).toContain(
      "is-expanded",
    );
    await user.click(
      screen.getByRole("button", { name: "Ansicht verkleinern" }),
    );
    expect(screen.getByTestId("gehirn-stage").className).not.toContain(
      "is-expanded",
    );
  });

  it("sucht in echten Einträgen, fokussiert die Auswahl und pausiert die Bewegung", async () => {
    const user = userEvent.setup();
    localStorage.setItem("lukas_token", "test-token");
    render(<GehirnSeite />);
    await waitFor(() => expect(createScene).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(
      "/api/lukas/gehirn",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-token" },
      }),
    );
    await user.type(screen.getByRole("searchbox"), "TaxiBB");
    const aside = screen.getByRole("complementary");
    await user.click(
      within(aside).getByRole("button", { name: /TaxiBB Essen/ }),
    );
    expect(
      within(aside).getByRole("heading", { name: "TaxiBB Essen" }),
    ).toBeInTheDocument();
    expect(scene.fokus).toHaveBeenLastCalledWith("a");
    await user.click(
      screen.getByRole("button", { name: "Bewegung pausieren" }),
    );
    expect(scene.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ bewegung: false }),
    );
  });
  it("öffnet auch Beziehungen außerhalb des Bereichsfilters", async () => {
    const user = userEvent.setup();
    render(<GehirnSeite />);
    await waitFor(() => expect(createScene).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Erinnerungen.*2/ }));
    await user.click(
      within(screen.getByRole("complementary")).getByRole("button", {
        name: /Website planen/,
      }),
    );
    await user.click(screen.getByRole("button", { name: /Verbindungen 2/ }));
    await user.click(
      within(screen.getByRole("complementary")).getByRole("button", {
        name: /Domainwissen/,
      }),
    );
    expect(screen.getByRole("button", { name: /^Alles$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(scene.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        auswahl: "c",
        sichtbar: new Set(["a", "b", "c"]),
      }),
    );
  });
  it("zeigt und kopiert lange Inhalte vollständig und erhält die Suche beim Schließen", async () => {
    const user = userEvent.setup();
    const inhalt =
      "Cully Hill Boys: ".repeat(80) + "Letzter vollständiger Satz.";
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...graph,
        knoten: graph.knoten.map((k) =>
          k.id === "b" ? { ...k, text: inhalt } : k,
        ),
      }),
    } as Response);
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<GehirnSeite />);
    await user.type(screen.getByRole("searchbox"), "Cully");
    await user.click(
      await screen.findByRole("button", { name: /Website planen/ }),
    );
    expect(screen.getByText(/Letzter vollständiger Satz/)).toHaveTextContent(
      inhalt,
    );
    await user.click(screen.getByRole("button", { name: "Text kopieren" }));
    expect(copy).toHaveBeenCalledWith(inhalt);
    await user.click(screen.getByRole("button", { name: "Auswahl schließen" }));
    expect(screen.getByRole("searchbox")).toHaveValue("Cully");
    expect(
      await screen.findByRole("button", { name: /Website planen/ }),
    ).toBeInTheDocument();
  });
  it("öffnet auf dem iPhone einen Leser mit Rückweg zwischen Einträgen und zur Karte", async () => {
    vi.stubGlobal("innerWidth", 393);
    const user = userEvent.setup();
    render(<GehirnSeite />);
    const ausloeser = await screen.findByRole("button", {
      name: /TaxiBB Essen/,
    });
    await user.click(ausloeser);
    const dialog = await screen.findByRole("dialog", { name: "TaxiBB Essen" });
    await user.click(
      within(dialog).getByRole("button", { name: /Verbindungen 1/ }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: /Website planen/ }),
    );
    expect(
      screen.getByRole("dialog", { name: "Website planen" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Zum vorherigen Eintrag" }),
    );
    expect(
      screen.getByRole("dialog", { name: "TaxiBB Essen" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Zur Gedächtniskarte" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /TaxiBB Essen/ }),
      ).toHaveFocus(),
    );
    expect(scene.fokus).toHaveBeenLastCalledWith(null);
  });
  it("lädt einen ausgewählten Gehirn-Eintrag wirklich als PDF herunter", async () => {
    const NativeURL = globalThis.URL;
    const createObjectURL = vi.fn(() => "blob:lukas-pdf");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends NativeURL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/lukas/gehirn/export/")) {
        return {
          ok: true,
          headers: new Headers({
            "content-type": "application/pdf",
            "content-disposition": 'attachment; filename="lukas-taxibb.pdf"',
          }),
          blob: async () =>
            new Blob(["%PDF-1.4 test"], { type: "application/pdf" }),
        } as Response;
      }
      return { ok: true, json: async () => graph } as Response;
    });

    const user = userEvent.setup();
    render(<GehirnSeite />);
    await user.click(
      await screen.findByRole("button", { name: /TaxiBB Essen/i }),
    );
    await user.click(
      screen.getByRole("button", { name: "Als PDF herunterladen" }),
    );

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/lukas/gehirn/export/a.pdf",
        expect.objectContaining({ headers: expect.any(Object) }),
      ),
    );
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
  });

  it("erhält bei WebGL-Ausfall die durchsuchbare Liste und räumt Worker auf", async () => {
    createScene.mockImplementation(() => {
      throw new Error("No WebGL");
    });
    const user = userEvent.setup(),
      { unmount } = render(<GehirnSeite />);
    await user.click(
      await screen.findByRole("button", { name: "Einträge anzeigen" }),
    );
    const list = screen.getByRole("region", { name: "Gedächtniskarte" });
    expect(
      within(list).getByRole("button", { name: /TaxiBB Essen/ }),
    ).toBeInTheDocument();
    unmount();
    expect(workers.every((w) => w.terminate.mock.calls.length > 0)).toBe(true);
  });
  it("zeigt HTTP-Fehler und bricht ausstehende Anfragen beim Verlassen ab", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);
    const { unmount } = render(<GehirnSeite />);
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 503");
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
