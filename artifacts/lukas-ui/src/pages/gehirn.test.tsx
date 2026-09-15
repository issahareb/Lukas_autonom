import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lege, type Gehirn } from "@/components/gehirn/modell";
const scene = vi.hoisted(() => ({
  update: vi.fn(),
  fokus: vi.fn(),
  zoom: vi.fn(),
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
