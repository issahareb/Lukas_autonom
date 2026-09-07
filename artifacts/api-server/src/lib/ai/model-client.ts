import type OpenAI from "openai";
import { openai } from "@workspace/integrations-openai-ai";
import { logger } from "../logger";
import { fitLukasContext } from "./context-window";
import type { ModelRoute } from "./model-router";
import { localBaseUrl } from "./model-router";
import { herkunft, zugVerbraucht } from "../zug";
import { CACHE_TRENNER, ohneTrenner, systemBloecke } from "./cache-marke";

export type LukasToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type LukasModelResult = {
  content: string;
  toolCalls: LukasToolCall[];
  finishReason: string | null;
  route: ModelRoute;
  /*
   * Was dieser eine Aufruf gekostet hat. Bisher wanderte das nur in die
   * Gesamtstatistik — die weiss aber nicht, welcher Zug dahintersteckt. Fuer
   * ein Budget PRO ZUG muss die Arbeitsschleife es sehen.
   */
  usage?: { rein: number; raus: number };
};

type CallInput = {
  route: ModelRoute;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  maxTokens?: number;
  /*
   * Lenkt gleichartige Anfragen auf dieselbe Maschine, damit der Cache
   * ueberhaupt greifen kann. Pro Unterhaltung, nicht pro Aufruf: die Runden
   * EINES Zuges teilen sich den Praefix.
   */
  cacheKey?: string;
};

function anthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY ist nicht gesetzt");
  return key;
}

function googleKey(): string {
  const key =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY/GOOGLE_GENERATIVE_AI_API_KEY ist nicht gesetzt");
  return key;
}

function asText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: any) => (part?.type === "text" ? String(part.text ?? "") : ""))
    .filter(Boolean)
    .join("\n");
}

function dataUrl(value: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

function toAnthropicUserContent(content: unknown): any[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [{ type: "text", text: String(content ?? "") }];

  const blocks: any[] = [];
  for (const part of content as any[]) {
    if (part?.type === "text") {
      blocks.push({ type: "text", text: String(part.text ?? "") });
      continue;
    }
    if (part?.type === "image_url") {
      const parsed = dataUrl(String(part.image_url?.url ?? ""));
      if (parsed) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
        });
      }
      continue;
    }
    if (part?.type === "file") {
      const parsed = dataUrl(String(part.file?.file_data ?? ""));
      if (parsed?.mediaType === "application/pdf") {
        blocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: parsed.data },
          title: String(part.file?.filename ?? "document.pdf"),
        });
      } else {
        blocks.push({
          type: "text",
          text: `[Datei ${String(part.file?.filename ?? "unbekannt")} konnte fuer dieses Modell nicht direkt eingebettet werden.]`,
        });
      }
    }
  }
  return blocks.length > 0 ? blocks : [{ type: "text", text: "" }];
}

function toAnthropicMessages(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): { system: string; messages: any[] } {
  const systemParts: string[] = [];
  const out: any[] = [];

  for (const message of messages as any[]) {
    if (message.role === "system") {
      const text = asText(message.content);
      if (text) systemParts.push(text);
      continue;
    }

    if (message.role === "tool") {
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: String(message.tool_call_id ?? ""),
            content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
          },
        ],
      });
      continue;
    }

    if (message.role === "assistant") {
      const blocks: any[] = [];
      const text = asText(message.content);
      if (text) blocks.push({ type: "text", text });
      for (const tc of message.tool_calls ?? []) {
        if (tc.type !== "function") continue;
        let parsedInput: unknown = {};
        try {
          parsedInput = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          parsedInput = { raw_arguments: tc.function.arguments ?? "" };
        }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: parsedInput });
      }
      out.push({ role: "assistant", content: blocks.length ? blocks : [{ type: "text", text: "" }] });
      continue;
    }

    out.push({ role: "user", content: toAnthropicUserContent(message.content) });
  }

  return { system: systemParts.join("\n\n"), messages: out };
}

/*
 * OpenAI Function Tools akzeptieren an der Wurzel nur ein Objekt-Schema.
 * Fremde MCP-Server (u.a. Higgsfield) liefern teilweise oneOf/anyOf/allOf etc.
 * direkt oben. Ein einziges solches Tool wuerde sonst den gesamten Request mit
 * HTTP 400 ablehnen. Deshalb wird DIREKT an der Provider-Grenze nochmals
 * normalisiert, unabhaengig davon, woher das Tool stammt.
 */
function sanitizeOpenAIToolSchema(schema: unknown): Record<string, unknown> {
  const empty: Record<string, unknown> = { type: "object", properties: {} };
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return empty;

  const source = schema as Record<string, unknown>;
  let base: Record<string, unknown> = { ...source };

  // Wenn das eigentliche Objekt in genau einer Variante steckt, behalten wir
  // dessen Felder statt sie beim Entfernen von oneOf/anyOf/allOf zu verlieren.
  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    const variants = source[key];
    if (Array.isArray(variants)) {
      const objectVariant = variants.find(
        (v) => v && typeof v === "object" && !Array.isArray(v) && (v as any).type === "object",
      );
      if (objectVariant) base = { ...base, ...(objectVariant as Record<string, unknown>) };
    }
  }

  for (const key of ["oneOf", "anyOf", "allOf", "not", "enum", "const"]) delete base[key];
  base.type = "object";
  if (!base.properties || typeof base.properties !== "object" || Array.isArray(base.properties)) {
    base.properties = {};
  }
  return base;
}

function toResponsesTools(tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined): any[] {
  return (tools ?? [])
    .filter((tool: any) => tool?.type === "function" && tool.function?.name)
    .map((tool: any) => ({
      type: "function",
      name: String(tool.function.name),
      description: String(tool.function.description ?? ""),
      parameters: sanitizeOpenAIToolSchema(tool.function.parameters),
      // Viele Lukas/MCP-Schemas haben optionale Felder und sind nicht im
      // strict-JSON-Schema-Subset formuliert. Validierung macht weiterhin das
      // Tool selbst; wichtig ist hier, dass OpenAI den Werkzeugkasten annimmt.
      strict: false,
    }));
}

function toResponsesContent(content: unknown): any {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");

  const out: any[] = [];
  for (const part of content as any[]) {
    if (part?.type === "text") {
      out.push({ type: "input_text", text: String(part.text ?? "") });
      continue;
    }
    if (part?.type === "image_url") {
      const url = String(part.image_url?.url ?? "");
      if (url) out.push({ type: "input_image", image_url: url, detail: part.image_url?.detail ?? "auto" });
      continue;
    }
    if (part?.type === "file") {
      const fileData = String(part.file?.file_data ?? "");
      if (fileData) {
        out.push({
          type: "input_file",
          file_data: fileData,
          filename: String(part.file?.filename ?? "document"),
        });
      }
    }
  }
  return out.length ? out : "";
}

function toResponsesInput(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  /*
   * Ohne Werkzeuge im Aufruf duerfen auch keine Werkzeug-Elemente in den
   * Verlauf. Die Responses-API weist function_call/function_call_output
   * zurueck, wenn im selben Aufruf keine Werkzeuge definiert sind — und ein
   * abgewiesener Aufruf heisst hier: keine Antwort.
   *
   * Zweite Sicherung neben dem Filter im voice-renderer: dass ein Aufrufer
   * dieselbe Falle noch einmal baut, soll nicht wieder eine Antwort kosten.
   */
  mitWerkzeugen = true,
): any[] {
  const out: any[] = [];

  for (const message of messages as any[]) {
    if (message.role === "tool") {
      if (!mitWerkzeugen) continue;
      out.push({
        type: "function_call_output",
        call_id: String(message.tool_call_id ?? ""),
        output: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      });
      continue;
    }

    if (message.role === "assistant") {
      const text = asText(message.content);
      if (text) out.push({ role: "assistant", content: text });
      for (const tc of mitWerkzeugen ? (message.tool_calls ?? []) : []) {
        if (tc?.type !== "function") continue;
        out.push({
          type: "function_call",
          call_id: String(tc.id ?? ""),
          name: String(tc.function?.name ?? ""),
          arguments: String(tc.function?.arguments ?? "{}"),
        });
      }
      continue;
    }

    if (message.role === "system" || message.role === "developer" || message.role === "user") {
      out.push({ role: message.role, content: toResponsesContent(message.content) });
      continue;
    }

    // Unbekannte Chat-Rollen nicht still verlieren.
    out.push({ role: "user", content: toResponsesContent(message.content) });
  }

  return out;
}

/*
 * Tokenverbrauch pro Modell, seit dem Start des Servers.
 *
 * Im Speicher und bewusst schlicht: es geht darum, ueberhaupt eine Zahl zu
 * haben. Wer wissen will, wohin die Credits gehen, sieht hier, WELCHES Modell
 * wie viel verbraucht — und das ist die Frage, die zaehlt, denn zwischen
 * luna und sol liegt ein Vielfaches.
 */
const verbrauch = new Map<
  string,
  { aufrufe: number; rein: number; raus: number; ausCache: number; inCache: number }
>();

/*
 * Beide Anbieter melden Cache-Treffer, nur unter verschiedenen Namen:
 *   OpenAI     usage.input_tokens_details.cached_tokens
 *   Anthropic  usage.cache_read_input_tokens / cache_creation_input_tokens
 *
 * Vorher wurde nichts davon gelesen. Damit liess sich nicht beantworten, ob
 * Caching ueberhaupt greift — und ohne diese Zahl ist jede Aussage ueber
 * Kosten geraten.
 */
function cacheTreffer(usage: any): { gelesen: number; geschrieben: number; imEingang: boolean } {
  /*
   * Und hier liegt die Falle, an der jede Cache-Quote falsch wird:
   *
   *   OpenAI     input_tokens ENTHAELT die gecachten Tokens bereits.
   *              cached_tokens ist eine Teilmenge davon.
   *   Anthropic  input_tokens enthaelt sie NICHT. cache_read_input_tokens und
   *              cache_creation_input_tokens stehen daneben.
   *
   * Wer beides gleich behandelt, zaehlt bei OpenAI dieselben Tokens zweimal —
   * einmal als Eingang, einmal als Cache — und bekommt eine Quote, die zu
   * niedrig ist. Genau das stand hier. Deshalb sagt `imEingang`, welcher Fall
   * vorliegt, und merkeVerbrauch rechnet danach.
   */
  const anthropisch = usage.cache_read_input_tokens !== undefined || usage.cache_creation_input_tokens !== undefined;
  if (anthropisch) {
    return {
      gelesen: Number(usage.cache_read_input_tokens ?? 0),
      geschrieben: Number(usage.cache_creation_input_tokens ?? 0),
      imEingang: false,
    };
  }
  return {
    gelesen: Number(
      usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0,
    ),
    geschrieben: 0,
    imEingang: true,
  };
}

function merkeVerbrauch(model: string, usage: any, provider = "unbekannt"): { rein: number; raus: number } {
  if (!usage) return { rein: 0, raus: 0 };
  const eintrag = verbrauch.get(model) ?? { aufrufe: 0, rein: 0, raus: 0, ausCache: 0, inCache: 0 };
  const cache = cacheTreffer(usage);
  const gemeldet = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  eintrag.aufrufe++;
  /*
   * `rein` heisst ab hier ueberall dasselbe: frisch bezahlter Eingang, ohne
   * das, was aus dem Cache kam. Nur so ist rein + ausCache der ganze Eingang —
   * bei beiden Anbietern.
   */
  eintrag.rein += cache.imEingang ? Math.max(0, gemeldet - cache.gelesen) : gemeldet;
  eintrag.raus += Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
  eintrag.ausCache += cache.gelesen;
  eintrag.inCache += cache.geschrieben;
  verbrauch.set(model, eintrag);

  logger.info(
    {
      model,
      rein: eintrag.rein,
      raus: eintrag.raus,
      ausCache: eintrag.ausCache,
      aufrufe: eintrag.aufrufe,
    },
    "Modellverbrauch",
  );

  /*
   * Zusaetzlich dauerhaft, pro Tag. Die Map oben ist nach jedem Neustart leer
   * — und Railway startet bei jeder Variablenaenderung neu. Ohne die Zeile
   * hier faengt jedes Tagesbudget staendig wieder bei null an.
   *
   * Bewusst ohne await: die Buchhaltung darf den Zug nicht aufhalten und
   * schon gar nicht kippen.
   */
  /*
   * Spaeter Import, mit Absicht.
   *
   * Ein statisches `import { verbucheTag } from "../tagesbudget"` zieht ueber
   * @workspace/db den Postgres-Treiber in JEDEN, der model-client benutzt —
   * und damit in ein halbes Dutzend Pruefungen, die mit einer Datenbank
   * nichts zu tun haben. Zwei davon sind daran sofort gescheitert.
   *
   * Die Buchhaltung ist ohnehin nebenlaeufig ("void"), also kostet der spaete
   * Import nichts: er passiert einmal beim ersten Modellaufruf.
   */
  const rein = cache.imEingang ? Math.max(0, gemeldet - cache.gelesen) : gemeldet;
  const raus = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);

  /*
   * Auf die laufende Aufgabe buchen, BEVOR die Datenbank drankommt.
   *
   * Der Deckel muss auch dann greifen, wenn Postgres gerade nicht erreichbar
   * ist — sonst waere ein Datenbankausfall ausgerechnet der Moment, in dem
   * die Kostenbremse verschwindet. Der Zaehler liegt deshalb im Speicher und
   * haengt an nichts.
   *
   * Fuer die Aufgabe zaehlt der GANZE Eingang, den gecachten Teil
   * eingeschlossen: guenstiger heisst nicht kostenlos, und ein Zug, der sich
   * an billigen Wiederholungen festfrisst, ist genau der Fall, den der Deckel
   * fangen soll.
   */
  zugVerbraucht(gemeldet + raus);

  void import("../tagesbudget").then(({ verbucheTag }) =>
    verbucheTag({
      provider,
      model,
      herkunft: herkunft(),
      rein,
      raus,
      ausCache: cache.gelesen,
      inCache: cache.geschrieben,
    }),
  );

  // Fuer das Budget zaehlt der ganze Eingang, auch der gecachte Teil: guenstiger
  // heisst nicht kostenlos.
  return {
    rein: cache.imEingang ? gemeldet : gemeldet + cache.gelesen + cache.geschrieben,
    raus: Number(usage.output_tokens ?? usage.completion_tokens ?? 0),
  };
}

export function verbrauchsUebersicht(): Array<{
  model: string;
  aufrufe: number;
  rein: number;
  raus: number;
  ausCache: number;
  inCache: number;
}> {
  return [...verbrauch.entries()]
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.rein + b.raus - (a.rein + a.raus));
}

async function callOpenAI(input: CallInput): Promise<LukasModelResult> {
  /*
   * Lukas ist ein Tool-Agent. Die 5.6-Reasoning-Modelle unterstuetzen Function
   * Tools nicht zusammen mit reasoning_effort auf /v1/chat/completions. Die
   * Responses API ist der vorgesehene Pfad fuer genau diese Kombination.
   */
  const request: any = {
    model: input.route.model,
    /*
     * Bei den Reasoning-Modellen zaehlen die Denk-Tokens mit. 8192 waren fuer
     * chat.completions ein sinnvoller Deckel fuer die reine Antwort; hier
     * teilen sich Denken und Antwort dasselbe Budget. Deshalb hoeher, und per
     * Variable nachstellbar.
     */
    max_output_tokens: input.maxTokens ?? Number(process.env.LUKAS_MAX_OUTPUT_TOKENS ?? 16384),
  };
  /*
   * OpenAI cached Praefixe ab etwa 1024 Token von selbst — aber nur, wenn
   * gleichartige Anfragen auf derselben Maschine landen. Der Schluessel lenkt
   * sie dorthin. Ohne ihn ist der Treffer Zufall, gerade wenn parallel noch
   * ein autonomer Lauf unterwegs ist.
   *
   * Pro Unterhaltung, nicht pro Aufruf: die Runden EINES Zuges teilen sich den
   * Praefix, und genau die sollen sich treffen.
   */
  request.prompt_cache_key = input.cacheKey ?? "lukas";

  const tools = toResponsesTools(input.tools);
  if (tools.length) request.tools = tools;
  // Der Verlauf richtet sich danach, ob dieser Aufruf ueberhaupt Werkzeuge hat.
  request.input = toResponsesInput(input.messages, tools.length > 0);

  const response: any = await openai.responses.create(request);
  const toolCalls: LukasToolCall[] = [];
  for (const item of response.output ?? []) {
    if (item?.type !== "function_call") continue;
    toolCalls.push({
      id: String(item.call_id ?? item.id ?? `tool_${Date.now()}_${toolCalls.length}`),
      name: String(item.name ?? ""),
      arguments: String(item.arguments ?? "{}"),
    });
  }

  /*
   * Was der Aufruf gekostet hat — und zwar sichtbar.
   *
   * Der Verbrauch wurde bisher NIRGENDS erfasst. Weder Issa noch Lukas konnten
   * sehen, wohin die Credits gehen; man merkte es erst an der Rechnung. Genau
   * dieselbe Blindheit wie beim Fehlerprotokoll.
   *
   * Die Zahlen kommen ohnehin in jeder Antwort mit, sie wurden nur weggeworfen.
   */
  const verbraucht = merkeVerbrauch(input.route.model, response.usage, input.route.provider);

  const content = String(response.output_text ?? "");

  /*
   * Leere Antwort ohne Werkzeugaufruf ist kein Ergebnis, sondern ein Ausfall.
   *
   * Bei der Responses-API zaehlen die Denk-Tokens der 5.6-Modelle gegen
   * max_output_tokens. Reicht das Budget nicht, kommt status "incomplete"
   * zurueck — mit leerem Text und ohne Werkzeug. Stillschweigend
   * durchgereicht landet das im Chat als leere Antwort, ohne dass irgendwo
   * steht, warum. Deshalb hier mit dem echten Grund abbrechen — der landet im
   * Log und in der Diagnose, statt als Raetsel im Chat.
   */
  if (!content && toolCalls.length === 0) {
    const grund = response.incomplete_details?.reason ?? response.status ?? "unbekannt";
    throw new Error(
      `Modell ${input.route.model} hat nichts geliefert (Status: ${grund}). ` +
        `Bei "max_output_tokens" hilft ein groesseres Budget ueber LUKAS_MAX_OUTPUT_TOKENS.`,
    );
  }

  return {
    content,
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : String(response.status ?? "stop"),
    route: input.route,
    usage: verbraucht,
  };
}

async function callAnthropic(input: CallInput): Promise<LukasModelResult> {
  const converted = toAnthropicMessages(input.messages);
  const tools = (input.tools ?? []).map((tool: any) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters ?? { type: "object", properties: {} },
  }));

  /*
   * Prompt-Caching.
   *
   * Anthropic rendert in der Reihenfolge tools -> system -> messages. Eine
   * Cache-Marke am ENDE des System-Prompts deckt damit beides ab: die
   * Werkzeugliste und die Seele — zusammen rund 11.600 Token, die bei jeder
   * einzelnen Runde eines Zuges byte-gleich wieder rausgehen.
   *
   * Ohne das zahlt ein Zug mit zehn Werkzeugrunden diesen Block zehnmal voll.
   * Genau das hat die Rechnung getrieben.
   *
   * Es MUSS explizit angefordert werden — anders als bei OpenAI passiert hier
   * ohne cache_control nichts. Unter etwa 1024 Token greift es nicht, was hier
   * nie der Fall ist.
   */
  /*
   * ZWEI Cache-Marken statt einer.
   *
   * Anthropic vergleicht Praefixe nur an gesetzten Marken. Eine einzige am
   * Ende des gesamten System-Prompts hiess: der gespeicherte Block endet auf
   * Gefuehlszustand, Erinnerungen und Budget — auf lauter Dinge, die sich
   * zwischen zwei Nachrichten aendern. Damit traf er innerhalb eines Zuges
   * (der Prompt wird einmal gebaut) und zwischen zwei Nachrichten NIE, obwohl
   * die ersten rund 11.600 Token byte-gleich waren.
   *
   * Jetzt: eine Marke nach dem stabilen Teil (Werkzeuge, Seele,
   * Kontinuitaet), eine am Ende. Aendert sich der wechselnde Teil, faellt nur
   * dessen Treffer aus — der stabile Block wird weiterhin gelesen statt
   * bezahlt.
   *
   * Gibt es keine Trennmarke (Untermitarbeiter, oeffentlicher Prompt, ein
   * uebergebener System-Text), bleibt es bei EINEM Block mit einer Marke. Das
   * ist genau das alte Verhalten und fuer kurze Prompts auch das richtige.
   */
  const systemBloecke_ = systemBloecke(converted.system);

  const body: any = {
    model: input.route.model,
    max_tokens: input.maxTokens ?? 8192,
    system: systemBloecke_,
    messages: converted.messages,
  };
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = { type: "auto" };
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`Anthropic ${response.status}: ${raw.slice(0, 1000)}`);
  const data = JSON.parse(raw) as any;
  const verbraucht = merkeVerbrauch(input.route.model, data.usage, input.route.provider);
  const text: string[] = [];
  const toolCalls: LukasToolCall[] = [];
  for (const block of data.content ?? []) {
    if (block?.type === "text" && block.text) text.push(String(block.text));
    if (block?.type === "tool_use") {
      toolCalls.push({
        id: String(block.id ?? `tool_${Date.now()}_${toolCalls.length}`),
        name: String(block.name ?? ""),
        arguments: JSON.stringify(block.input ?? {}),
      });
    }
  }
  return {
    content: text.join(""),
    toolCalls,
    finishReason: data.stop_reason === "tool_use" ? "tool_calls" : String(data.stop_reason ?? "stop"),
    route: input.route,
    usage: verbraucht,
  };
}

/*
 * Ein lokales oder selbst gehostetes Modell.
 *
 * Bewusst die OpenAI-Schnittstelle: Ollama, llama.cpp, vLLM, LM Studio und
 * praktisch jeder Anbieter offener Modelle sprechen sie. Damit ist das hier
 * KEINE Anbindung an ein bestimmtes Modell, sondern an alle, die so erreichbar
 * sind — Wechsel kostet eine Umgebungsvariable, keinen Code.
 *
 * Absichtlich nicht ueber die Responses-API: die kennt nur OpenAI. Lokale
 * Server koennen /v1/chat/completions, und Werkzeugaufrufe gehen dort genauso.
 *
 * Zwei Dinge, die im Betrieb zaehlen:
 *  - Ein grosszuegiges Zeitlimit. Ein Modell auf einer CPU rechnet minutenlang;
 *    mit dem Standardlimit waere jeder zweite Aufruf ein Zeitfehler.
 *  - Ein Schluessel ist optional. Die meisten lokalen Server haben keinen, und
 *    einen leeren Authorization-Header mitzuschicken bringt manche zum Stolpern.
 */
async function callLocal(input: CallInput): Promise<LukasModelResult> {
  const base = localBaseUrl();
  if (!base) throw new Error("LUKAS_LOCAL_BASE_URL ist nicht gesetzt");

  const url = `${base.replace(/\/+$/, "")}/chat/completions`;
  const key = process.env.LUKAS_LOCAL_API_KEY?.trim();

  const body: any = {
    model: input.route.model,
    messages: input.messages,
    max_tokens: input.maxTokens ?? 4096,
    stream: false,
  };
  if (input.tools?.length) body.tools = input.tools;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.LUKAS_LOCAL_TIMEOUT_MS ?? 300000)),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Lokales Modell ${response.status}: ${raw.slice(0, 500)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Lokales Modell hat kein JSON geliefert: ${raw.slice(0, 300)}`);
  }

  const verbraucht = merkeVerbrauch(input.route.model, data.usage, input.route.provider);
  const choice = data.choices?.[0];
  const toolCalls: LukasToolCall[] = [];
  for (const tc of choice?.message?.tool_calls ?? []) {
    // Manche Server lassen "type" weg — der Name entscheidet, nicht das Feld.
    const name = String(tc?.function?.name ?? "");
    if (!name) continue;
    toolCalls.push({
      id: String(tc.id ?? `tool_${Date.now()}_${toolCalls.length}`),
      name,
      arguments: String(tc.function?.arguments ?? "{}"),
    });
  }

  return {
    content: String(choice?.message?.content ?? ""),
    toolCalls,
    finishReason: String(choice?.finish_reason ?? "stop"),
    route: input.route,
    usage: verbraucht,
  };
}

async function callGoogle(input: CallInput): Promise<LukasModelResult> {
  const body: any = {
    model: input.route.model,
    max_tokens: input.maxTokens ?? 8192,
    messages: input.messages,
    stream: false,
  };
  if (input.tools?.length) body.tools = input.tools;

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${googleKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${raw.slice(0, 1000)}`);
  const data = JSON.parse(raw) as any;
  const verbraucht = merkeVerbrauch(input.route.model, data.usage, input.route.provider);
  const choice = data.choices?.[0];
  const toolCalls: LukasToolCall[] = [];
  for (const tc of choice?.message?.tool_calls ?? []) {
    if (tc?.type !== "function") continue;
    toolCalls.push({
      id: String(tc.id ?? `tool_${Date.now()}_${toolCalls.length}`),
      name: String(tc.function?.name ?? ""),
      arguments: String(tc.function?.arguments ?? "{}"),
    });
  }
  return {
    content: String(choice?.message?.content ?? ""),
    toolCalls,
    finishReason: String(choice?.finish_reason ?? "stop"),
    route: input.route,
    usage: verbraucht,
  };
}

/** Ein gemeinsamer Modell-Aufruf. Provider sind Rechenkerne, nicht Identitaeten. */
export async function callLukasModel(input: CallInput): Promise<LukasModelResult> {
  // Die vollstaendige Historie bleibt persistent in DB/Memory. Nur die aktive
  // Payload wird bei sehr langen Threads auf das Provider-Fenster gepackt.
  const prepared: CallInput = { ...input, messages: fitLukasContext(input.messages) };

  /*
   * NUR Anthropic kennt die Trennmarke. Bei allen anderen wird sie hier
   * entfernt, BEVOR irgendein Anbieterpfad sie zu sehen bekommt.
   *
   * An genau einer Stelle, nicht in jedem Pfad einzeln: eine Marke, die
   * durchrutscht, steht mitten im Prompt und richtet dort still Schaden an —
   * kein Fehler, keine Ausnahme, nur ein Modell, das eine sinnlose Zeile liest
   * und sich fragt, was sie bedeutet. Genau die Sorte Fehler, die man erst
   * bemerkt, wenn die Antworten seltsam werden.
   *
   * Auch bei OpenAI kostet das nichts: dort laeuft das Zwischenspeichern
   * automatisch ueber den laengsten passenden Praefix, ganz ohne Marken.
   */
  const ohne: CallInput = {
    ...prepared,
    messages: prepared.messages.map((m: any) =>
      typeof m?.content === "string" && m.content.includes(CACHE_TRENNER)
        ? { ...m, content: ohneTrenner(m.content) }
        : m,
    ),
  };

  try {
    if (prepared.route.provider === "anthropic") return await callAnthropic(prepared);
    if (prepared.route.provider === "google") return await callGoogle(ohne);
    if (prepared.route.provider === "local") return await callLocal(ohne);
    return await callOpenAI(ohne);
  } catch (err) {
    logger.warn(
      {
        err,
        provider: prepared.route.provider,
        model: prepared.route.model,
        profile: prepared.route.profile,
      },
      "Lukas provider call failed",
    );
    if (prepared.route.provider !== "openai") {
      const fallback: ModelRoute = {
        provider: "openai",
        model: process.env.LUKAS_CORE_MODEL ?? "gpt-4o",
        profile: prepared.route.profile,
        reason: `Fallback nach ${prepared.route.provider}-Fehler`,
      };
      // Exakt dieselbe vorbereitete Lukas-Historie geht an den Fallback.
      return await callOpenAI({ ...ohne, route: fallback });
    }

    /*
     * OpenAI-Modell nicht nutzbar — z.B. weil der Account es nicht
     * freigeschaltet hat oder die ID nicht mehr existiert.
     *
     * Vorher flog der Fehler hier ungebremst durch und riss den kompletten Zug
     * mit: im Chat stand nur noch "Hmm, da ist etwas schiefgelaufen". Genau so
     * ist der oeffentliche Chat schon einmal ausgefallen, nachdem eine neue
     * Modell-ID eingetragen wurde, die der Account nicht hatte.
     *
     * Jetzt: einmal auf den Core zurueckfallen und die kaputte ID fuer eine
     * Weile merken, damit nicht jeder Aufruf erneut in denselben Fehler
     * laeuft. Eine falsche Modell-ID kostet damit Qualitaet, nicht die
     * Funktion.
     */
    const core = process.env.LUKAS_CORE_MODEL?.trim() || "gpt-4o";
    if (prepared.route.model !== core && isModelUnavailable(err)) {
      markModelBroken(prepared.route.model, err);
      return await callOpenAI({
        ...prepared,
        route: {
          provider: "openai",
          model: core,
          profile: prepared.route.profile,
          reason: `Fallback: ${prepared.route.model} nicht nutzbar`,
        },
      });
    }
    throw err;
  }
}

/*
 * Modelle, die dieser Account gerade nicht nutzen kann. Nur im Speicher und
 * mit Ablauf: nach einem Neustart oder einer Stunde wird es erneut versucht —
 * eine Freischaltung soll nicht bis zum naechsten Deploy unbemerkt bleiben.
 */
const brokenModels = new Map<string, number>();
const BROKEN_TTL_MS = 60 * 60 * 1000;

export function isModelBroken(model: string): boolean {
  const until = brokenModels.get(model);
  if (until === undefined) return false;
  if (Date.now() > until) {
    brokenModels.delete(model);
    return false;
  }
  return true;
}

function markModelBroken(model: string, err: unknown): void {
  brokenModels.set(model, Date.now() + BROKEN_TTL_MS);
  logger.error(
    { model, err },
    "Modell nicht nutzbar — Lukas arbeitet vorerst mit dem Core-Modell weiter",
  );
}

/** Fehlerbilder, bei denen ein anderes Modell nicht hilft, dieses aber tot ist. */
function isModelUnavailable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const message = String((err as { message?: string })?.message ?? "").toLowerCase();
  if (status === 404) return true;
  if (status === 403 && message.includes("model")) return true;
  return (
    message.includes("does not exist") ||
    message.includes("do not have access") ||
    message.includes("unknown model") ||
    message.includes("unsupported model") ||
    message.includes("invalid model")
  );
}
