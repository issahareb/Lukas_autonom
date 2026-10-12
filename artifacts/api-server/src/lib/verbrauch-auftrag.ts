import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { verbrauchSchreiben } from "./verbrauch-quelle";
import { logger } from "./logger";

type Auftrag = { id: string; rootId: string; parentId: string | null; quelle: string; conversationId?: number; status: string; gestartetAt: Date; beendetAt?: Date };
const auftrag = new AsyncLocalStorage<Auftrag>();
type Usage = { eingabe: number; ausgabe: number; cacheLesen: number; cacheSchreiben: number | null };
const aufruf = new AsyncLocalStorage<{ usage?: Usage }>();

function speichern(job: Promise<unknown>) {
  verbrauchSchreiben(job.catch(err => logger.warn({ err }, "Auftragsmessung nicht gespeichert")));
}
async function schreibeAuftrag(a: Auftrag) {
  const { db, verbrauchAuftraege } = await import("@workspace/db");
  await db.insert(verbrauchAuftraege).values(a).onConflictDoUpdate({ target: verbrauchAuftraege.id,
    set: { status: a.status, beendetAt: a.beendetAt ?? null } });
}

export async function mitVerbrauchsAuftrag<T>(quelle: string, conversationId: number | undefined, fn: () => Promise<T>): Promise<T> {
  const inherited = auftrag.getStore();
  const parent = inherited?.beendetAt ? undefined : inherited; const id = randomUUID();
  const a: Auftrag = { id, rootId: parent?.rootId ?? id, parentId: parent?.id ?? null, quelle,
    conversationId, status: "laeuft", gestartetAt: new Date() };
  // Serialize start/end writes: a late start write must never overwrite completion.
  const start = schreibeAuftrag({ ...a }).catch(err => logger.warn({ err }, "Auftragsstart nicht gespeichert"));
  speichern(start);
  return auftrag.run(a, async () => {
    try { const result = await fn(); if (a.status === "laeuft") a.status = "antwort"; return result; }
    catch (err) { a.status = err instanceof Error && err.name === "AbortError" ? "abgebrochen" : "fehler"; throw err; }
    finally { a.beendetAt = new Date(); speichern(start.then(() => schreibeAuftrag({ ...a }))); }
  });
}

export function hatAktivenAuftrag(): boolean { const a = auftrag.getStore(); return Boolean(a && !a.beendetAt); }
export function ohneAuftragsKontext<T>(fn: () => T): T { return auftrag.exit(fn); }

export function auftragsStatus(status: string) { const a = auftrag.getStore(); if (a) a.status = status; }
export function merkeAufrufUsage(usage: Usage) { const c = aufruf.getStore(); if (c) c.usage = usage; }

export async function messeModellAufruf<T>(input: { route: { model: string; provider: string }; quelle?: string; messages: any[]; tools?: any[] }, phase: string, fn: () => Promise<T>): Promise<T> {
  const a = auftrag.getStore();
  if (!a || a.beendetAt) return mitVerbrauchsAuftrag(input.quelle ?? "sonstige", undefined, () => messeModellAufruf(input, phase, fn));
  const c: { usage?: Usage } = {}; const started = new Date(); let status = "ok";
  const length = (v: unknown) => typeof v === "string" ? v.length : JSON.stringify(v ?? "").length;
  const sum = (role: string) => input.messages.filter(m => m.role === role).reduce((n, m) => n + length(m.content) + (m.tool_calls ? length(m.tool_calls) : 0), 0);
  const kontext = { systemZeichen: sum("system"), verlaufZeichen: sum("user") + sum("assistant"), ergebnisZeichen: sum("tool"), schemaZeichen: JSON.stringify(input.tools ?? []).length, werkzeuge: input.tools?.length ?? 0 };
  try { return await aufruf.run(c, fn); }
  catch (err) { status = "fehler"; throw err; }
  finally {
    const row = { id: randomUUID(), auftragId: a.id, rootId: a.rootId, model: input.route.model, provider: input.route.provider,
      quelle: input.quelle ?? a.quelle, phase, status, eingabe: c.usage?.eingabe ?? null, ausgabe: c.usage?.ausgabe ?? null,
      cacheLesen: c.usage?.cacheLesen ?? null, cacheSchreiben: c.usage?.cacheSchreiben ?? null,
      kontext, dauerMs: Date.now() - started.getTime(), gestartetAt: started };
    speichern(import("@workspace/db").then(async ({ db, verbrauchAufrufe }) => { await db.insert(verbrauchAufrufe).values(row); }));
  }
}
