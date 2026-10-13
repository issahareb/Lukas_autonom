import type { Gehirn } from './gehirn';

/** Only topology crosses the public boundary. Never spread a private record. */
export type PublicBrain = {
  version: 1;
  nodes: { id: number; type: string; weight: number }[];
  edges: { source: number; target: number; weight: number }[];
};
const TYPES = new Set(['identitaet', 'gefuehl', 'ziel', 'erinnerung', 'kategorie', 'thema', 'agent', 'subjekt', 'aussage', 'episode', 'episodenart', 'strategie', 'mitarbeiter', 'tagebuch', 'meldung']);
const weight = (value: number) => Number.isFinite(value) ? Math.round(Math.max(0, Math.min(1, value)) * 100) / 100 : 0.2;

export function publicBrain(graph: Gehirn): PublicBrain {
  const ids = new Map<string, number>();
  const nodes: PublicBrain['nodes'] = [];
  for (const node of graph.knoten) {
    if (!TYPES.has(node.art) || ids.has(node.id)) continue;
    const id = nodes.length;
    ids.set(node.id, id);
    nodes.push({ id, type: node.art, weight: weight(node.gewicht) });
  }
  const seen = new Set<string>();
  const edges: PublicBrain['edges'] = [];
  for (const edge of graph.kanten) {
    const source = ids.get(edge.von), target = ids.get(edge.nach);
    if (source === undefined || target === undefined || source === target) continue;
    const key = `${source}:${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source, target, weight: weight(edge.gewicht) });
  }
  return { version: 1, nodes, edges };
}
