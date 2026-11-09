import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

/*
 * Jeder Test faengt bei null an — und zwar auch beim TOKEN.
 *
 * Die Seiten lesen `lukas_token` aus dem localStorage und haengen ihn an jede
 * Anfrage. Bliebe er zwischen Tests stehen, wuerde ein Test, der ohne Token
 * laeuft, zufaellig den des vorherigen benutzen und dabei gruen werden, ohne
 * dass die Sache stimmt.
 */
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

/*
 * jsdom kennt kein matchMedia. Ohne diese Attrappe stirbt jede Komponente,
 * die irgendwo `use-mobile` benutzt — und das ist das Layout, also praktisch
 * alles.
 */
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Radix und einige Karten messen; jsdom liefert sonst nichts zurueck.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

Element.prototype.scrollIntoView ??= () => {};
