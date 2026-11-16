import { projekteImText, projektKontext } from "./projekt-aliasse";
import { boundedMemory, relevantEnough } from "./memory-relevance";

type Treffer = { kind: string; id: number; text: string; observedAt?: Date };
type Bereich = "Zustand" | "Aufgaben und Blocker" | "Technik und Artefakte" | "Entscheidungen" | "Weitere Quellen";
const REIHENFOLGE: Bereich[] = ["Zustand", "Aufgaben und Blocker", "Technik und Artefakte", "Entscheidungen", "Weitere Quellen"];
function bereich(text: string): Bereich {
  if (/\b(blocked.by|blockiert|blocker|has.task|aufgabe|offen|todo|freigabe|has.approval)\b/i.test(text)) return "Aufgaben und Blocker";
  if (/\b(has.decision|entscheidungen?|beschlossen|supersedes|ersetzt)\b/i.test(text)) return "Entscheidungen";
  if (/\b(repository|repo|domain|hosting|deployed.on|uses.technology|has.artifact|artefakt|datei|technologie|technisch\w*|aufgebaut|architektur|nutzt|verwendet)\b/i.test(text)) return "Technik und Artefakte";
  if (/\b(zustand|status|fortschritt|recent.change|geaendert|geändert|erledigt|abgeschlossen|deploy)\b/i.test(text)) return "Zustand";
  return "Weitere Quellen";
}

/** A bounded view of existing canonical-memory hits. No separate project store,
 * no inferred completion, and no traversal through an owner's other projects. */
export function projektGedachtnis(query: string, hits: Treffer[], maxChars = 6000): string {
  const projects = projekteImText(query);
  if (!projects.length) return boundedMemory(hits, maxChars);
  const ids = new Set(projects.map(p => p.id));
  const matching = hits.filter(h => projekteImText(h.text).some(p => ids.has(p.id)));
  const priority = bereich(query);
  const order = priority === "Weitere Quellen" ? REIHENFOLGE : [priority, ...REIHENFOLGE.filter(b => b !== priority)];
  let pack = projektKontext(query) + "\n[Projektkontext: gespeicherte Quellen, kein geprüfter Live-Status. Fehlende Angaben bleiben unbekannt.]";
  const used = new Set<Treffer>();
  const packLimit = Math.min(3000, maxChars);
  for (const b of order) {
    const rows = matching.filter(h => bereich(h.text) === b);
    let heading = false;
    for (const h of rows) {
      const date = h.observedAt instanceof Date && Number.isFinite(h.observedAt.getTime()) ? `; Stand ${h.observedAt.toISOString()}` : "";
      const source = `[${h.kind} #${h.id}${date}] `;
      const excerpt = h.text.length > 950 ? h.text.slice(0, 950) + " … [Auszug]" : h.text;
      const line = `${heading ? "" : "\n" + b + ":"}\n- ${source}${excerpt}`;
      if (pack.length + line.length > packLimit) continue;
      pack += line; heading = true; used.add(h);
    }
  }
  if (!used.size) pack += "\nKeine passende gespeicherte Quelle im Abruf. Kein belegter Zustand oder Fortschritt.";
  const rest = boundedMemory(hits.filter(h => !used.has(h) && relevantEnough(query, h.text)), Math.max(0, maxChars - pack.length - 1));
  return [pack, rest].filter(Boolean).join("\n").slice(0, maxChars);
}
