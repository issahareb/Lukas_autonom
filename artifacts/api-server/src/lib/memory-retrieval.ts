import { projekteImText, projektKontext } from "./projekt-aliasse";
/*
 * Memory-Retrieval — bewertete Suche ueber Memories, Claims, Episoden UND den
 * rohen Chat-Archivbestand. Damit ist "nicht im aktuellen Modellkontext" nicht
 * gleichbedeutend mit "vergessen": alte Originalnachrichten bleiben suchbar.
 */
import { db } from "@workspace/db";
import {
  memoriesTable,
  claimsTable,
  episodesTable,
  messages,
  type Claim,
} from "@workspace/db";
import { desc, eq, isNull, ilike, or } from "drizzle-orm";
import { formatClaim } from "./memory-writer";
import { graphTreffer, erinnerungenZuKnoten, episodenZuIds } from "./memory-graph";
import { logger } from "./logger";

/*
 * Kategorien, deren Inhalt NICHT von Issa und nicht aus Lukas' eigener Arbeit
 * stammt, sondern von Fremden.
 *
 * Beim Abruf landen Erinnerungen in derselben Liste wie Fakten ueber Issa. Was
 * ein unbekannter Agent auf Moltbook behauptet hat, darf dort nicht so
 * aussehen wie etwas, das Issa selbst gesagt hat — sonst ist der Umweg ueber
 * das Gedaechtnis der bequemste Weg, Lukas langfristig etwas unterzuschieben.
 */
const FREMDE_HERKUNFT = new Set(["moltbook"]);

const VOYAGE_MODEL = "voyage-3.5-lite";

export type MemoryHit = {
  kind: "memory" | "claim" | "episode" | "conversation" | "graph";
  id: number;
  text: string;
  score: number;
};

async function embed(texts: string[]): Promise<number[][] | null> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key || texts.length === 0) return null;
  try {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: VOYAGE_MODEL, input: texts.slice(0, 128) }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Voyage-Embedding fehlgeschlagen");
      return null;
    }
    const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    return data.data?.map((d) => d.embedding) ?? null;
  } catch (err) {
    logger.warn({ err }, "Voyage-Embedding Fehler");
    return null;
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function queryWords(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((w) => w.trim())
        .filter((w) => w.length > 2),
    ),
  ).slice(0, 10);
}

function lexicalRelevance(query: string, text: string): number {
  const words = queryWords(query);
  if (words.length === 0) return 0;
  const t = text.toLowerCase();
  const hits = words.filter((w) => t.includes(w)).length;
  const projektTreffer = projekteImText(query).some(p => projekteImText(text).some(t => t.id === p.id));
  return Math.max(hits / words.length, projektTreffer ? 0.9 : 0);
}

export async function embedNewRows(): Promise<number> {
  if (!process.env.VOYAGE_API_KEY) return 0;
  let count = 0;

  const newMemories = await db
    .select()
    .from(memoriesTable)
    .where(isNull(memoriesTable.embedding))
    .limit(64);
  if (newMemories.length > 0) {
    const vecs = await embed(newMemories.map((m) => m.content));
    if (vecs) {
      for (let i = 0; i < newMemories.length && i < vecs.length; i++) {
        await db
          .update(memoriesTable)
          .set({ embedding: vecs[i] })
          .where(eq(memoriesTable.id, newMemories[i].id));
        count++;
      }
    }
  }

  const newClaims = await db
    .select()
    .from(claimsTable)
    .where(isNull(claimsTable.embedding))
    .limit(64);
  if (newClaims.length > 0) {
    const vecs = await embed(newClaims.map((c) => `${c.subject} ${c.predicate} ${c.value}`));
    if (vecs) {
      for (let i = 0; i < newClaims.length && i < vecs.length; i++) {
        await db
          .update(claimsTable)
          .set({ embedding: vecs[i] })
          .where(eq(claimsTable.id, newClaims[i].id));
        count++;
      }
    }
  }
  return count;
}

const recency = (d: Date) => Math.exp(-((Date.now() - d.getTime()) / 86400000) / 30);

function claimSourceFactor(c: Claim): number {
  switch (c.status) {
    case "verified": return 1.0;
    case "corroborated": return 0.9;
    case "contradicted": return 0.2;
    case "retracted": return 0.1;
    default: return 0.6;
  }
}

async function archiveCandidates(query: string) {
  const words = queryWords(query);
  if (words.length === 0) {
    return db.select().from(messages).orderBy(desc(messages.createdAt)).limit(100);
  }

  // Diese Query geht direkt auf das kanonische Chat-Archiv und ist NICHT auf
  // die letzten 300 Erinnerungen beschraenkt. Dadurch kann Lukas auch sehr alte
  // Originalsaetze wiederfinden. Fuer semantische Paraphrasen helfen zusaetzlich
  // die kuratierten/embedded Memories.
  const terms = [...new Set([...projekteImText(query).flatMap(p => p.aliases), ...words])].slice(0, 18);
  const conditions = terms.map((word) => ilike(messages.content, `%${word}%`));
  return db
    .select()
    .from(messages)
    .where(or(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(300);
}

/*
 * Wie viele Zeilen die bewertete Suche durchgeht.
 *
 * "breit" ist der alte Weg: alles laden, in JavaScript bewerten. Er bleibt
 * noetig, solange die Frage an keinem benannten Ding haengt ("was habe ich
 * letzte Woche gesagt?").
 *
 * "eng" gilt, sobald der Graph einen Einstieg gefunden hat. Dann ist der
 * praezise Teil der Antwort bereits ueber Kanten geholt, und der Durchlauf
 * muss nur noch ergaenzen statt zu suchen. Genau hier faellt die Arbeit weg.
 */
const BREIT = { memories: 500, claims: 300, episodes: 150 };
const ENG = { memories: 150, claims: 80, episodes: 50 };

export async function searchMemory(query: string, limit = 8): Promise<MemoryHit[]> {
  const q = query.trim();
  if (!q) return [];

  /*
   * Zuerst der Graph: zwei indizierte Abfragen, die beim genannten Ding
   * einsteigen und ein bis zwei Kanten weit gehen. Das Ergebnis entscheidet
   * anschliessend, wie breit ueberhaupt noch gesucht werden muss.
   */
  const graph = await graphTreffer(q, Math.max(3, Math.ceil(limit / 2)));
  const gezielt = graph.einstieg.length > 0;
  const budget = gezielt ? ENG : BREIT;

  const [memories, claims, episodes, archive, graphMemories, graphEpisoden] = await Promise.all([
    db.select().from(memoriesTable).orderBy(desc(memoriesTable.createdAt)).limit(budget.memories),
    db.select().from(claimsTable).orderBy(desc(claimsTable.observedAt)).limit(budget.claims),
    db.select().from(episodesTable).orderBy(desc(episodesTable.startedAt)).limit(budget.episodes),
    archiveCandidates(q),
    gezielt ? erinnerungenZuKnoten(graph.knoten, 5) : Promise.resolve([]),
    gezielt ? episodenZuIds(graph.episodenIds, 3) : Promise.resolve([]),
  ]);

  const queryVec = (await embed([q]))?.[0] ?? null;

  const relevance = (text: string, vec: number[] | null): number => {
    const lex = lexicalRelevance(q, text);
    if (queryVec && vec) {
      const sem = Math.max(0, cosine(queryVec, vec));
      return Math.max(lex, sem);
    }
    return lex;
  };

  const hits: MemoryHit[] = [];

  /*
   * Graph-Treffer zuerst und mit Vorrang: sie stammen nicht aus einem
   * Aehnlichkeitsmass, sondern aus einer tatsaechlich vorhandenen Verbindung
   * zwischen zwei Dingen. Das ist die staerkere Aussage.
   */
  for (const t of graph.treffer) {
    hits.push({ kind: "graph", id: t.claimId, text: t.text, score: 1 + t.score });
  }

  // Erinnerungen und Episoden, die am gefundenen Knoten haengen — ohne dass
  // ihr Wortlaut zur Frage passen muss.
  for (const m of graphMemories) {
    hits.push({
      kind: "memory",
      id: m.id,
      text: `[Erinnerung|${m.category}${FREMDE_HERKUNFT.has(m.category) ? " — FREMDE QUELLE, unbestätigt" : ""}] ${m.content}`,
      score: 0.95 * (m.importance / 10),
    });
  }
  for (const e of graphEpisoden) {
    if (!e.summary) continue;
    hits.push({
      kind: "episode",
      id: e.id,
      text: `[Episode ${e.startedAt.toISOString().slice(0, 10)}] ${e.kind}: ${e.summary}`,
      score: 0.85,
    });
  }

  for (const m of memories) {
    const rel = relevance(m.content, m.embedding);
    if (rel <= 0.05) continue;
    hits.push({
      kind: "memory",
      id: m.id,
      text: `[Erinnerung|${m.category}${FREMDE_HERKUNFT.has(m.category) ? " — FREMDE QUELLE, unbestätigt" : ""}] ${m.content}`,
      score: rel * 0.9 * (m.importance / 10) * Math.max(0.3, recency(m.createdAt)),
    });
  }

  for (const c of claims) {
    const rel = relevance(`${c.subject} ${c.predicate} ${c.value}`, c.embedding);
    if (rel <= 0.05) continue;
    hits.push({
      kind: "claim",
      id: c.id,
      text: `[Wissen] ${formatClaim(c)}`,
      score:
        rel *
        (0.5 + c.confidence / 2) *
        claimSourceFactor(c) *
        Math.max(0.3, recency(c.observedAt)),
    });
  }

  for (const e of episodes) {
    const text = `${e.kind}: ${e.summary}`;
    const rel = relevance(text, null);
    if (rel <= 0.05 || !e.summary) continue;
    hits.push({
      kind: "episode",
      id: e.id,
      text: `[Episode ${e.startedAt.toISOString().slice(0, 10)}] ${text}`,
      score: rel * 0.7 * Math.max(0.2, recency(e.startedAt)),
    });
  }

  for (const m of archive) {
    const rel = lexicalRelevance(q, m.content);
    if (rel <= 0.05) continue;
    const speaker = m.role === "assistant" ? "Lukas" : "Issa";
    hits.push({
      kind: "conversation",
      id: m.id,
      text: `[Original-Chat ${m.createdAt.toISOString()}|${speaker}] ${m.content}`,
      // Originalquellen bekommen einen hohen Quellenfaktor; Alter senkt sie
      // nur wenig, weil ein alter exakter Satz fuer Erinnerungsfragen wichtig ist.
      score: rel * 0.95 * Math.max(0.55, recency(m.createdAt)),
    });
  }

  // Gleiche Texte nicht doppelt aus Memory + Original-Archiv ausgeben.
  const seen = new Set<string>();
  return hits
    .sort((a, b) => b.score - a.score)
    .filter((hit) => {
      const key = hit.text.replace(/^\[[^\]]+\]\s*/, "").slice(0, 500).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export async function memoryContextFor(query: string, limit = 6): Promise<string> {
  const hits = await searchMemory(query, limit);
  return [projektKontext(query), ...hits.map((h) => `- ${h.text}`)].filter(Boolean).join("\n");
}

/*
 * Dasselbe, aber ohne das, was ohnehin schon im Prompt steht.
 *
 * DAS PROBLEM, gegen das das steht: der System-Prompt traegt bereits die zehn
 * wichtigsten und die zehn neuesten Erinnerungen. Die Suche daneben lieferte
 * dieselben Zeilen ein zweites Mal — in einem anderen Format, weshalb es beim
 * Lesen nicht auffiel. Bezahlt wurde es zweimal, und schlimmer: eine doppelt
 * genannte Erinnerung wirkt auf ein Modell wichtiger als eine einmal genannte.
 * Die Wiederholung hat also nicht nur Geld gekostet, sie hat auch das Gewicht
 * verschoben.
 *
 * NACHGEFASST STATT NUR GESTRICHEN: waeren die Doppelten einfach entfernt
 * worden, blieben von acht Plaetzen vielleicht fuenf uebrig — die Suche haette
 * sich also selbst bestraft. Deshalb wird breiter geholt und danach auf die
 * gewuenschte Zahl aufgefuellt.
 */
/**
 * Die Auswahl selbst — ohne Datenbank, damit sie pruefbar ist.
 *
 * NUR `kind === "memory"` wird verglichen, und das ist keine Feinheit: IDs
 * sind pro Tabelle vergeben. Die Episode 3 ist nicht die Erinnerung 3. Wer
 * bloss die Zahl vergleicht, wirft richtige Treffer weg und merkt es nie —
 * es fehlt ja nur etwas, es steht nichts Falsches da.
 */
export function waehleOhneDoppel(
  hits: MemoryHit[],
  limit: number,
  ausser: Set<number>,
): MemoryHit[] {
  return hits.filter((h) => !(h.kind === "memory" && ausser.has(h.id))).slice(0, limit);
}

export async function memoryContextOhne(
  query: string,
  limit: number,
  ausser: Set<number>,
): Promise<string> {
  if (ausser.size === 0) return memoryContextFor(query, limit);

  /*
   * BREITER HOLEN, dann auswaehlen. Wer nur streicht, laesst von acht
   * Treffern vielleicht fuenf uebrig — dann bestraft sich die Suche fuer
   * jede Erinnerung, die ohnehin schon wichtig genug war, um oben zu stehen.
   */
  const hits = await searchMemory(query, limit + ausser.size);
  const uebrig = waehleOhneDoppel(hits, limit, ausser);
  return [projektKontext(query), ...uebrig.map((h) => `- ${h.text}`)].filter(Boolean).join("\n");
}
