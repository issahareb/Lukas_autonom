import { describe, expect, it } from "vitest";
import { lege, normalisiere, umfeld, type Gehirn, type Knoten } from "./modell";

const node = (id: string, art = "erinnerung"): Knoten => ({
  id,
  art,
  titel: id,
  gewicht: 0.5,
  text: "",
  daten: {},
  datei: "",
  ordner: "",
});
const graph = (): Gehirn => ({
  stand: "2026-09-15",
  zahlen: {},
  knoten: [
    node("lukas", "identitaet"),
    node("a", "thema"),
    node("b"),
    node("c", "aussage"),
    node("island"),
  ],
  kanten: [
    { von: "lukas", nach: "a", art: "kennt", gewicht: 1 },
    { von: "a", nach: "b", art: "Thema", gewicht: 0.5 },
    { von: "b", nach: "c", art: "belegt", gewicht: 0.5 },
  ],
});

describe("Gedächtnisraum", () => {
  it("liefert dieselben Positionen bei umsortierten API-Daten", () => {
    const a = graph(),
      b = graph();
    b.knoten.reverse();
    b.kanten.reverse();
    expect(lege(normalisiere(a))).toEqual(lege(normalisiere(b)));
  });
  it("verwirft kaputte Endpunkte und doppelte IDs, ohne neue Beziehungen zu erfinden", () => {
    const g = graph();
    g.knoten.push(node("a"));
    g.knoten[2].gewicht = NaN;
    g.kanten.push(
      { von: "missing", nach: "b", art: "fehlt", gewicht: 1 },
      { von: "b", nach: "b", art: "selbst", gewicht: 1 },
    );
    const clean = normalisiere(g);
    expect(clean.knoten).toHaveLength(5);
    expect(clean.kanten).toHaveLength(3);
    expect([...lege(clean).positionen].every(Number.isFinite)).toBe(true);
  });
  it("zeigt nur erreichbare Nachbarn bis zur gewählten Tiefe, unabhängig von Kantenrichtung", () => {
    const g = graph(),
      all = new Set(g.knoten.map((k) => k.id));
    expect([...umfeld(g, "b", all, 1).keys()].sort()).toEqual(["a", "b", "c"]);
    expect(umfeld(g, "b", all, 2).get("lukas")).toBe(2);
    expect(umfeld(g, "b", all, 2).has("island")).toBe(false);
  });
  it("durchquert keine ausgefilterten Knoten", () => {
    const g = graph(),
      visible = new Set(["lukas", "b", "c"]);
    expect([...umfeld(g, "b", visible, 2).keys()].sort()).toEqual(["b", "c"]);
    expect(umfeld(g, "a", visible, 2).size).toBe(0);
  });
  it("behandelt leere und isolierte Graphen ohne NaN", () => {
    const g: Gehirn = { stand: "", zahlen: {}, knoten: [], kanten: [] };
    expect(lege(g).positionen.length).toBe(0);
    g.knoten = [node("alone")];
    expect([...lege(g).positionen].every(Number.isFinite)).toBe(true);
  });
});
