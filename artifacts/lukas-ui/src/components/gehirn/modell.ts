export type Knoten = {
  id: string;
  art: string;
  titel: string;
  gewicht: number;
  text: string;
  daten: Record<string, string | number | boolean>;
  datei: string;
  ordner: string;
};
export type Kante = { von: string; nach: string; art: string; gewicht: number };
export type Gehirn = {
  stand: string;
  knoten: Knoten[];
  kanten: Kante[];
  zahlen: Record<string, number>;
};
export type Raum = {
  positionen: Float32Array;
  regionen: Uint8Array;
  grad: Uint32Array;
};

// Inhaltliche Bereiche, keine Behauptung über biologische Hirnareale.
export const BEREICHE = [
  { name: "Erinnerungen", farbe: "#78baff", mitte: [-76, 20, 0] },
  { name: "Wissen", farbe: "#9f99ff", mitte: [70, 28, -8] },
  { name: "Erlebnisse", farbe: "#65d8ce", mitte: [-44, -63, 18] },
  { name: "Ziele", farbe: "#e8c687", mitte: [40, 91, -15] },
  { name: "Beziehungen", farbe: "#87c8bc", mitte: [77, -52, 12] },
  { name: "Gefühle", farbe: "#d7a1d8", mitte: [-57, 91, -18] },
] as const;
export const ARTEN: Record<string, string> = {
  identitaet: "Identität",
  erinnerung: "Erinnerung",
  kategorie: "Kategorie",
  thema: "Thema",
  subjekt: "Subjekt",
  aussage: "Aussage",
  episode: "Episode",
  episodenart: "Episodenart",
  tagebuch: "Tagebuch",
  ziel: "Ziel",
  strategie: "Strategie",
  agent: "Agent",
  mitarbeiter: "Team",
  gefuehl: "Gefühl",
  meldung: "Meldung",
};
export function bereich(art: string): number {
  if (["subjekt", "aussage"].includes(art)) return 1;
  if (["episode", "episodenart", "tagebuch", "meldung"].includes(art)) return 2;
  if (["ziel", "strategie"].includes(art)) return 3;
  if (["agent", "mitarbeiter"].includes(art)) return 4;
  if (art === "gefuehl") return 5;
  return 0;
}
export const istHub = (art: string) =>
  ["identitaet", "thema", "kategorie", "subjekt", "episodenart"].includes(art);
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function normalisiere(g: Gehirn): Gehirn {
  if (!g || !Array.isArray(g.knoten) || !Array.isArray(g.kanten))
    throw new Error("Ungültige Gedächtnisdaten.");
  const ids = new Set<string>();
  const knoten = g.knoten
    .filter((k) => {
      if (!k || typeof k.id !== "string" || ids.has(k.id)) return false;
      ids.add(k.id);
      return true;
    })
    .map((k) => ({
      ...k,
      art: k.art || "erinnerung",
      titel: String(k.titel || k.id),
      text: String(k.text || ""),
      daten: k.daten || {},
      gewicht: Number.isFinite(k.gewicht)
        ? Math.max(0, Math.min(1, k.gewicht))
        : 0.2,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const kanten = g.kanten
    .filter((e) => e && ids.has(e.von) && ids.has(e.nach) && e.von !== e.nach)
    .map((e) => ({
      ...e,
      gewicht: Number.isFinite(e.gewicht)
        ? Math.max(0, Math.min(1, e.gewicht))
        : 0.5,
    }))
    .sort((a, b) =>
      `${a.von}/${a.nach}/${a.art}`.localeCompare(
        `${b.von}/${b.nach}/${b.art}`,
      ),
    );
  return { ...g, knoten, kanten };
}

/** Stable, bounded clustered layout. All iterations run in a module worker. */
export function lege(g: Gehirn): Raum {
  const n = g.knoten.length;
  const positionen = new Float32Array(n * 3);
  const regionen = new Uint8Array(n);
  const grad = new Uint32Array(n);
  const idx = new Map(g.knoten.map((k, i) => [k.id, i]));
  const paare = g.kanten.map((e) => [
    idx.get(e.von)!,
    idx.get(e.nach)!,
    e.gewicht,
  ]);
  const anker = new Float32Array(n * 3);
  const nachbarn: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of paare) {
    grad[a]++;
    grad[b]++;
    nachbarn[a].push(b);
    nachbarn[b].push(a);
  }
  const anz = BEREICHE.map(
    (_, r) =>
      g.knoten.filter((k) => k.art !== "identitaet" && bereich(k.art) === r)
        .length,
  );
  g.knoten.forEach((k, i) => {
    const r = bereich(k.art);
    regionen[i] = r;
    if (k.art === "identitaet") return;
    const h = hash(k.id);
    const u = (h % 65521) / 65521;
    const v = (hash(k.id + ":v") % 65521) / 65521;
    const w = (hash(k.id + ":w") % 65521) / 65521;
    const theta = u * Math.PI * 2,
      z = 2 * v - 1;
    const radius =
      (24 + Math.min(34, Math.cbrt(anz[r]) * 5)) * Math.cbrt(0.1 + w * 0.9);
    const xy = Math.sqrt(1 - z * z);
    const c = BEREICHE[r].mitte;
    positionen.set(
      [
        c[0] + Math.cos(theta) * xy * radius,
        c[1] + Math.sin(theta) * xy * radius * 0.78,
        c[2] + z * radius * 0.95,
      ],
      i * 3,
    );
  });
  anker.set(positionen);
  // Child memories settle near their real topic/category, never invented edges.
  g.knoten.forEach((k, i) => {
    if (istHub(k.art)) return;
    const hubs = nachbarn[i].filter(
      (j) =>
        istHub(g.knoten[j].art) &&
        g.knoten[j].art !== "identitaet" &&
        regionen[j] === regionen[i],
    );
    if (!hubs.length) return;
    for (let d = 0; d < 3; d++)
      anker[i * 3 + d] =
        anker[i * 3 + d] * 0.45 +
        (hubs.reduce((s, j) => s + positionen[j * 3 + d], 0) / hubs.length) *
          0.55;
  });
  const forces = new Float32Array(n * 3),
    cell = 14;
  for (let step = 0; step < 65; step++) {
    forces.fill(0);
    const grid = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const p = i * 3,
        key = `${Math.floor(positionen[p] / cell)},${Math.floor(positionen[p + 1] / cell)},${Math.floor(positionen[p + 2] / cell)}`;
      const list = grid.get(key);
      if (list) list.push(i);
      else grid.set(key, [i]);
    }
    for (let i = 0; i < n; i++) {
      const p = i * 3,
        cx = Math.floor(positionen[p] / cell),
        cy = Math.floor(positionen[p + 1] / cell),
        cz = Math.floor(positionen[p + 2] / cell);
      for (let x = -1; x <= 1; x++)
        for (let y = -1; y <= 1; y++)
          for (let z = -1; z <= 1; z++) {
            for (const j of grid.get(`${cx + x},${cy + y},${cz + z}`) ?? []) {
              if (j <= i) continue;
              const q = j * 3,
                dx = positionen[p] - positionen[q],
                dy = positionen[p + 1] - positionen[q + 1],
                dz = positionen[p + 2] - positionen[q + 2];
              const d2 = Math.max(0.2, dx * dx + dy * dy + dz * dz),
                f = Math.min(1.2, 13 / d2);
              for (const [d, delta] of [
                [0, dx],
                [1, dy],
                [2, dz],
              ]) {
                forces[p + d] += delta * f;
                forces[q + d] -= delta * f;
              }
            }
          }
    }
    for (const [a, b, weight] of paare) {
      if (
        regionen[a] !== regionen[b] ||
        g.knoten[a].art === "identitaet" ||
        g.knoten[b].art === "identitaet"
      )
        continue;
      const f = 0.004 + weight * 0.008;
      for (let d = 0; d < 3; d++) {
        const delta = (positionen[b * 3 + d] - positionen[a * 3 + d]) * f;
        forces[a * 3 + d] += delta;
        forces[b * 3 + d] -= delta;
      }
    }
    for (let i = 0; i < n; i++) {
      if (g.knoten[i].art === "identitaet") continue;
      for (let d = 0; d < 3; d++) {
        const p = i * 3 + d;
        positionen[p] +=
          Math.max(
            -2,
            Math.min(2, forces[p] + (anker[p] - positionen[p]) * 0.06),
          ) *
          (1 - step / 90);
      }
    }
  }
  return { positionen, regionen, grad };
}

/** Undirected exploration of stored relations, restricted to visible nodes. */
export function umfeld(
  g: Gehirn,
  start: string | null,
  sichtbar: Set<string>,
  tiefe: number,
): Map<string, number> {
  const dist = new Map<string, number>();
  if (!start || !sichtbar.has(start)) return dist;
  const adj = new Map<string, string[]>();
  for (const e of g.kanten) {
    if (!sichtbar.has(e.von) || !sichtbar.has(e.nach)) continue;
    for (const [a, b] of [
      [e.von, e.nach],
      [e.nach, e.von],
    ]) {
      const l = adj.get(a);
      if (l) l.push(b);
      else adj.set(a, [b]);
    }
  }
  const queue = [start];
  dist.set(start, 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i],
      d = dist.get(id)!;
    if (d >= tiefe) continue;
    for (const next of adj.get(id) ?? [])
      if (!dist.has(next)) {
        dist.set(next, d + 1);
        queue.push(next);
      }
  }
  return dist;
}
