import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { verbrauchSchreiben } from "./verbrauch-quelle";
import { logger } from "./logger";
import { MESSVERSION, messRevision, aufgabenart, pruefeFallstudie, type Fallstudie } from "./verbrauch-methodik";

type Auftrag = { id: string; rootId: string; parentId: string | null; quelle: string; conversationId?: number; status: string; gestartetAt: Date; beendetAt?: Date; messung: { version: number; revision: string | null; aufgabenart: string; promptHash?: string; fallstudie?: Fallstudie } };
const auftrag = new AsyncLocalStorage<Auftrag>();
type Usage = { eingabe: number; ausgabe: number; cacheLesen: number; cacheSchreiben: number | null };
type ToolSchema = { schemaZeichen: number; schemaBytes: number; werkzeuge: number; schemaFormat: "openai-responses" };
type Nachweis = { version: number; revision: string | null; profil?: string; responseId?: string; gemeldetesModell?: string; usage?: Record<string, unknown>; nurBeleg?: boolean };
const aufruf = new AsyncLocalStorage<{ usage?: Usage; schema?: ToolSchema; nachweis?: Nachweis }>();

function speichern(job: Promise<unknown>) {
  verbrauchSchreiben(job.catch(err => logger.warn({ err }, "Auftragsmessung nicht gespeichert")));
}
async function schreibeAuftrag(a: Auftrag) {
  const { db, verbrauchAuftraege } = await import("@workspace/db");
  await db.insert(verbrauchAuftraege).values(a).onConflictDoUpdate({ target: verbrauchAuftraege.id,
    set: { status: a.status, beendetAt: a.beendetAt ?? null, messung: a.messung } });
}

export async function mitVerbrauchsAuftrag<T>(quelle: string, conversationId: number | undefined, fn: () => Promise<T>): Promise<T> {
  const inherited = auftrag.getStore();
  const parent = inherited?.beendetAt ? undefined : inherited; const id = randomUUID();
  const a: Auftrag = { id, rootId: parent?.rootId ?? id, parentId: parent?.id ?? null, quelle,
    conversationId, status: "laeuft", gestartetAt: new Date(),
    messung: { version: MESSVERSION, revision: messRevision(), aufgabenart: "unbekannt", ...(parent?.messung.fallstudie ? { fallstudie: parent.messung.fallstudie } : {}) } };
  // Serialize start/end writes: a late start write must never overwrite completion.
  const start = schreibeAuftrag({ ...a }).catch(err => logger.warn({ err }, "Auftragsstart nicht gespeichert"));
  speichern(start);
  return auftrag.run(a, async () => {
    try { const result = await fn(); if (a.status === "laeuft") a.status = "antwort"; return result; }
    catch (err) { a.status = err instanceof Error && err.name === "AbortError" ? "abgebrochen" : "fehler"; throw err; }
    finally { a.beendetAt = new Date(); speichern(start.then(() => schreibeAuftrag({ ...a }))); }
  });
}

export function aktuellerAuftragId(): string | undefined { return auftrag.getStore()?.rootId; }
export function markiereAuftrag(text: string, fallstudie?: unknown, profil?: string): void {
  const a = auftrag.getStore(); if (!a) return;
  a.messung.aufgabenart = aufgabenart(text, profil);
  a.messung.promptHash = createHash("sha256").update(text).digest("hex");
  const fall = pruefeFallstudie(fallstudie); if (fall) a.messung.fallstudie = fall;
}
export function merkeProviderBeleg(input: Omit<Nachweis, "version" | "revision">): void {
  const c = aufruf.getStore(); if (c) c.nachweis = { version: MESSVERSION, revision: messRevision(), ...c.nachweis, ...input };
}
export function hatAufrufMessung(): boolean { return Boolean(aufruf.getStore()); }
export function bucheEinzelBeleg(model: string, provider: string, quelle: string, usage: Usage, beleg?: Record<string, unknown>): void {
  // Legacy direct widget calls: receipt-level attribution, explicitly not full attempt coverage.
  const id = randomUUID(); const started = new Date();
  speichern(import("@workspace/db").then(async ({ db, verbrauchAuftraege, verbrauchAufrufe }) => {
    await db.transaction(async tx => {
      await tx.insert(verbrauchAuftraege).values({ id, rootId: id, quelle, status: "antwort", gestartetAt: started, beendetAt: started,
        messung: { version: MESSVERSION, revision: messRevision(), aufgabenart: "unbekannt" } });
      await tx.insert(verbrauchAufrufe).values({ id: randomUUID(), auftragId: id, rootId: id, model, provider, quelle,
        phase: "direktbeleg", status: "ok", ...usage, dauerMs: 0, gestartetAt: started,
        kontext: { systemZeichen: 0, verlaufZeichen: 0, ergebnisZeichen: 0, schemaZeichen: 0, werkzeuge: 0 },
        nachweis: { version: MESSVERSION, revision: messRevision(), usage: beleg, nurBeleg: true } });
    });
  }));
}
export function hatAktivenAuftrag(): boolean { const a = auftrag.getStore(); return Boolean(a && !a.beendetAt); }
export function ohneAuftragsKontext<T>(fn: () => T): T { return auftrag.exit(fn); }

export function auftragsStatus(status: string) { const a = auftrag.getStore(); if (a) a.status = status; }
export function merkeAufrufUsage(usage: Usage) { const c = aufruf.getStore(); if (c) c.usage = usage; }
/** Capture after provider serialization, without persisting schema contents. */
export function merkeToolSchema(tools: unknown[]): void {
  const c = aufruf.getStore(); if (!c) return;
  const json = tools.length ? JSON.stringify(tools) : "";
  c.schema = { schemaZeichen: json.length, schemaBytes: Buffer.byteLength(json), werkzeuge: tools.length, schemaFormat: "openai-responses" };
}

export async function messeModellAufruf<T>(input: { route: { model: string; provider: string; profile?: string }; quelle?: string; messages: any[]; tools?: any[] }, phase: string, fn: () => Promise<T>): Promise<T> {
  const a = auftrag.getStore();
  if (!a || a.beendetAt) return mitVerbrauchsAuftrag(input.quelle ?? "sonstige", undefined, () => messeModellAufruf(input, phase, fn));
  const c: { usage?: Usage; schema?: ToolSchema; nachweis?: Nachweis } = { nachweis: { version: MESSVERSION, revision: messRevision(), profil: input.route.profile } }; const started = new Date(); let status = "ok";
  const length = (v: unknown) => typeof v === "string" ? v.length : JSON.stringify(v ?? "").length;
  const sum = (role: string) => input.messages.filter(m => m.role === role).reduce((n, m) => n + length(m.content) + (m.tool_calls ? length(m.tool_calls) : 0), 0);
  const kontext = { systemZeichen: sum("system") + sum("developer"), verlaufZeichen: sum("user") + sum("assistant"), ergebnisZeichen: sum("tool"), schemaZeichen: JSON.stringify(input.tools ?? []).length, werkzeuge: input.tools?.length ?? 0 };
  try { return await aufruf.run(c, fn); }
  catch (err) { status = "fehler"; throw err; }
  finally {
    const row = { id: randomUUID(), auftragId: a.id, rootId: a.rootId, model: input.route.model, provider: input.route.provider,
      quelle: input.quelle ?? a.quelle, phase, status, eingabe: c.usage?.eingabe ?? null, ausgabe: c.usage?.ausgabe ?? null,
      cacheLesen: c.usage?.cacheLesen ?? null, cacheSchreiben: c.usage?.cacheSchreiben ?? null,
      kontext: { ...kontext, ...c.schema }, dauerMs: Date.now() - started.getTime(), gestartetAt: started, nachweis: c.nachweis };
    speichern(import("@workspace/db").then(async ({ db, verbrauchAufrufe }) => { await db.insert(verbrauchAufrufe).values(row); }));
  }
}
