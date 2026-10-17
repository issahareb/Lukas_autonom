import type OpenAI from "openai";
import { logger } from "../logger";
import { BILD_MARKE } from "../bildablage";

/*
 * Wie viel Gespraech ueberhaupt mitgeschickt wird.
 *
 * Der Wert stand auf 220.000 Zeichen — rund 60.000 Tokens. Erreicht ein Thread
 * diese Groesse, wird er ab dann jede Runde in voller Laenge erneut bezahlt,
 * und ein Zug mit zehn Werkzeugrunden zehnmal. Fuer ein Modellfenster war das
 * grosszuegig gedacht; fuer die Rechnung ist es der teuerste Posten ueberhaupt.
 *
 * Kurze Unterhaltungen brauchen standardmaessig nur 32.000 Zeichen.
 * Code, Analysen, Recherchen und komplexe Auftraege behalten 60.000.
 * Was davor liegt, ist NICHT verloren: der Rohverlauf bleibt vollstaendig in
 * der Datenbank, relevante Stellen kommen per gezieltem Memory-Retrieval zurueck.
 * Beide Grenzen sind per Umgebungsvariable anpassbar.
 */
const DEFAULT_MAX_CONTEXT_CHARS = 32_000;
const DEFAULT_COMPLEX_CONTEXT_CHARS = 60_000;

function contentCost(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 200;

  let total = 0;
  for (const part of content as any[]) {
    if (part?.type === "text") total += String(part.text ?? "").length;
    else if (part?.type === "image_url") total += 2500; // Bildtokens statt Base64-Laenge schaetzen.
    else if (part?.type === "file") total += 8000;
    else total += 500;
  }
  return total;
}

function messageCost(message: OpenAI.Chat.Completions.ChatCompletionMessageParam): number {
  const m = message as any;
  let total = 100 + contentCost(m.content);
  if (Array.isArray(m.tool_calls)) {
    total += m.tool_calls.reduce(
      (sum: number, tc: any) =>
        sum + String(tc?.function?.name ?? "").length + String(tc?.function?.arguments ?? "").length + 100,
      0,
    );
  }
  return total;
}

function maxContextChars(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): number {
  const explizit = Number(process.env.LUKAS_CONTEXT_MAX_CHARS);
  // Ein konfiguriertes Limit gewinnt immer, auch wenn die Aufgabe komplex ist.
  if (Number.isFinite(explizit) && explizit > 0) return Math.max(12_000, Math.floor(explizit));

  // Die letzten echten Nutzer-Nachrichten bestimmen die Tiefe. Ein kurzes
  // "weiter" nach einer Code-Recherche darf den erforderlichen Kontext
  // nicht wegwerfen. Die History und alle Memories bleiben unveraendert.
  const letzte = messages.filter((m) => m.role === "user").slice(-3);
  const aufgabe = letzte.map(m => typeof m.content === "string" ? m.content : "").join(" ").slice(-4000);
  const komplex = /repo|github|typescript|javascript|python|code|programmier|implementier|skript|debug|deploy|fehler|recherch|analys|strategie|architektur|verglei|audit|projekt|website|webseite|https?:|datei|dokument|konzept|mehrere|schritt.fuer.schritt/i.test(aufgabe) ||
    letzte.some(m => typeof m.content !== "string");
  if (!komplex) return DEFAULT_MAX_CONTEXT_CHARS;
  const configured = Number(process.env.LUKAS_CONTEXT_COMPLEX_MAX_CHARS ?? DEFAULT_COMPLEX_CONTEXT_CHARS);
  return Number.isFinite(configured) && configured > 0
    ? Math.max(DEFAULT_MAX_CONTEXT_CHARS, Math.floor(configured))
    : DEFAULT_COMPLEX_CONTEXT_CHARS;
}

/**
 * Alles bleibt dauerhaft in DB/Memory. Nur wenn ein Thread groesser als das
 * aktive Modellfenster wird, wird fuer DIESEN Modellaufruf ein Suffix gepackt.
 * Der aktuelle Turn bleibt immer drin; alte relevante Stellen kommen bereits
 * ueber buildSystemPrompt -> memoryContextFor aus dem Originalarchiv zurueck.
 */
export function fitLukasContext(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const maxChars = maxContextChars(messages);
  const total = messages.reduce((sum, message) => sum + messageCost(message), 0);
  if (total <= maxChars) return messages;

  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");
  const systemCost = systemMessages.reduce((sum, message) => sum + messageCost(message), 0);
  const budget = Math.max(0, maxChars - systemCost - 1500);
  // Ganze Dialogzuege statt einzelner Nachrichten: aktuelle Frage und alle
  // zusammengehoerigen Werkzeugaufrufe/-ergebnisse bleiben beieinander.
  const groups: typeof nonSystem[] = [];
  for (const message of nonSystem) {
    const toolImage = Array.isArray(message.content) && message.content.some((p: any) =>
      p?.type === "text" && String(p.text ?? "").includes(BILD_MARKE));
    if ((message.role === "user" && !toolImage) || groups.length === 0) groups.push([]);
    groups[groups.length - 1].push(message);
  }
  const keptGroups: typeof groups = [];
  let used = 0;
  for (let i = groups.length - 1; i >= 0; i--) {
    const cost = groups[i].reduce((sum, m) => sum + messageCost(m), 0);
    // Protect the immediately preceding exchange as well as the current one.
    // Optional memory must not displace the answer a follow-up refers to.
    if (keptGroups.length >= 2 && used + cost > budget) break;
    keptGroups.unshift(groups[i]);
    used += cost;
  }
  const kept = keptGroups.flat();
  while (kept[0]?.role === "tool") kept.shift();
  if (systemCost + used > maxChars) {
    logger.info({ systemCost, currentTurnCost: used, maxChars }, "Aktueller Zug ueberschreitet Kontextziel; bleibt vollstaendig");
  }

  const dropped = nonSystem.length - kept.length;
  const archiveHint: OpenAI.Chat.Completions.ChatCompletionSystemMessageParam = {
    role: "system",
    content:
      `KONTEXTFENSTER-HINWEIS: ${dropped} ältere Nachrichten dieses Threads sind aus Platzgründen ` +
      `nicht wörtlich in diesem einzelnen Modellaufruf enthalten. Sie sind NICHT vergessen oder gelöscht: ` +
      `sie liegen im kanonischen Chat-Archiv und im Lukas-Gedächtnis. Relevante alte Originalstellen wurden ` +
      `für die aktuelle Frage bereits per Memory-Retrieval gesucht; bei weiterer Unsicherheit nutze query_memory.`,
  };

  logger.info({ totalCost: total, maxChars, dropped, kept: kept.length }, "Lukas context window packed");
  return [...systemMessages, archiveHint, ...kept];
}
