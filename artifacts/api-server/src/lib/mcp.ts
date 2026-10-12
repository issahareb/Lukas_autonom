import crypto from "node:crypto";
import { db } from "@workspace/db";
import { mcpServers, type McpServer, type McpToolSpec } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { logger } from "./logger";

/*
 * Anbindung fremder MCP-Server.
 *
 * Ein MCP-Server bringt Lukas Werkzeuge bei, die wir nicht selbst gebaut
 * haben. Der Zugang laeuft ueber OAuth 2.1 mit PKCE, Discovery und Dynamic
 * Client Registration — all das kommt aus dem offiziellen SDK. Das ist
 * Absicht: einen OAuth-Client von Hand zu schreiben ist genau die Sorte
 * Aufgabe, bei der man sich stille Sicherheitsluecken einbaut (fehlende
 * state-Pruefung, PKCE falsch verdrahtet, Redirect nicht validiert).
 *
 * Unsere Aufgabe hier ist nur, dem SDK zu sagen, WO der Zustand liegt: in der
 * Datenbank, nicht im Prozessspeicher. Railway startet Container neu, wann es
 * will — laege der OAuth-Zustand im Speicher, muesste Issa sich nach jedem
 * Neustart neu anmelden.
 */

export const MCP_TOOL_PREFIX = "mcp__";

function publicBaseUrl(): string {
  const explicit = process.env.LUKAS_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  // Railway stellt die oeffentliche Domain selbst bereit.
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railway) return `https://${railway}`;
  return `http://localhost:${process.env.PORT ?? 5000}`;
}

export function callbackUrl(): string {
  return `${publicBaseUrl()}/api/lukas/mcp/callback`;
}

/** Aus einem Namen einen stabilen, im Werkzeugnamen benutzbaren Slug machen. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return base || "server";
}

/*
 * Der OAuth-Zustand einer Serverzeile, so wie das SDK ihn braucht.
 *
 * Jede Methode schreibt bzw. liest genau eine Spalte. Nichts davon liegt im
 * Speicher: zwischen "Anmeldung starten" und "Callback kommt zurueck" kann der
 * Container neu gestartet worden sein.
 */
class DbOAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly serverId: number,
    private readonly serverName: string,
  ) {}

  get redirectUrl(): string {
    return callbackUrl();
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: `Lukas — ${this.serverName}`,
      redirect_uris: [callbackUrl()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    };
  }

  private async row(): Promise<McpServer> {
    const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, this.serverId));
    if (!row) throw new Error(`MCP-Server ${this.serverId} existiert nicht mehr.`);
    return row;
  }

  private async patch(values: Partial<typeof mcpServers.$inferInsert>): Promise<void> {
    await db
      .update(mcpServers)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(mcpServers.id, this.serverId));
  }

  async clientInformation(): Promise<OAuthClientInformationFull | undefined> {
    const row = await this.row();
    return (row.clientInfo as OAuthClientInformationFull | null) ?? undefined;
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await this.patch({ clientInfo: info as unknown as Record<string, unknown> });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const row = await this.row();
    return (row.tokens as OAuthTokens | null) ?? undefined;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.patch({
      tokens: tokens as unknown as Record<string, unknown>,
      status: "connected",
      lastError: null,
      // Verbraucht: weder Verifier noch state duerfen einen zweiten Durchlauf
      // ueberleben.
      codeVerifier: null,
      oauthState: null,
    });
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    await this.patch({ codeVerifier: verifier });
  }

  async codeVerifier(): Promise<string> {
    const row = await this.row();
    if (!row.codeVerifier) {
      throw new Error(
        "Kein PKCE-Verifier gespeichert — die Anmeldung wurde nicht über diesen Server gestartet oder ist abgelaufen. Bitte erneut auf „Verbinden“ klicken.",
      );
    }
    return row.codeVerifier;
  }

  async state(): Promise<string> {
    /*
     * Der Callback kommt als Browser-Redirect zurueck und kann deshalb keinen
     * Bearer-Token tragen. Dieser Zufallswert IST der Nachweis, dass die
     * Rueckleitung zu einem Anmeldevorgang gehoert, den wir selbst gestartet
     * haben — und er bindet sie an genau diese Serverzeile.
     */
    const value = crypto.randomBytes(32).toString("base64url");
    await this.patch({ oauthState: value, status: "awaiting_auth" });
    return value;
  }

  /*
   * Das SDK ruft das auf, wenn der Nutzer sich anmelden muss. Wir koennen hier
   * nichts umleiten — wir sind der Server, nicht der Browser. Also merken wir
   * uns die URL und werfen sie nach oben, damit die Route sie an das Dashboard
   * geben kann.
   */
  redirectToAuthorization(authorizationUrl: URL): void {
    throw new AuthorizationRequired(authorizationUrl.toString());
  }
}

/** Signalisiert: Issa muss sich anmelden, hier ist die URL dafuer. */
export class AuthorizationRequired extends Error {
  constructor(readonly authorizationUrl: string) {
    super("Anmeldung erforderlich");
    this.name = "AuthorizationRequired";
  }
}

async function getRow(id: number): Promise<McpServer> {
  const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
  if (!row) throw new Error(`MCP-Server ${id} existiert nicht.`);
  return row;
}

/*
 * Verbindung aufbauen.
 *
 * Zuerst Streamable HTTP (der aktuelle Transport), bei Fehlschlag SSE (der
 * aeltere). Welchen ein Server spricht, steht nirgends verlaesslich — also
 * ausprobieren, statt zu raten und den Nutzer mit einer nichtssagenden
 * Fehlermeldung stehen zu lassen.
 */
async function connect(row: McpServer, authorizationCode?: string): Promise<Client> {
  const provider = new DbOAuthProvider(row.id, row.name);
  const url = new URL(row.url);
  const attempt = async (kind: "http" | "sse") => {
    const client = new Client({ name: "lukas", version: "1.0.0" });
    const transport =
      kind === "http"
        ? new StreamableHTTPClientTransport(url, { authProvider: provider })
        : new SSEClientTransport(url, { authProvider: provider });
    try {
      if (authorizationCode) await transport.finishAuth(authorizationCode);
      await client.connect(transport, { timeout: 15000 });
      return client;
    } catch (err) { await client.close().catch(() => {}); throw err; }
  };

  try {
    return await attempt("http");
  } catch (err) {
    // Anmeldung noetig: nicht als Transportproblem missdeuten, sondern
    // unveraendert nach oben geben.
    if (err instanceof AuthorizationRequired || err instanceof UnauthorizedError) throw err;
    // Only a transport mismatch warrants legacy SSE. Authentication, rate
    // limits and timeouts do not become valid requests on another transport.
    if (!/\b40[45]\b/.test(String(err))) throw err;
    logger.info({ err, server: row.name }, "Streamable HTTP nicht unterstützt — versuche SSE");
    try { return await attempt("sse"); }
    catch (legacy) {
      if (legacy instanceof AuthorizationRequired || legacy instanceof UnauthorizedError) throw legacy;
      throw new Error(`MCP-Verbindung zu ${row.name} fehlgeschlagen: HTTP: ${String(err)}; SSE: ${String(legacy)}`);
    }
  }
}

/**
 * Verbindet und liest die Werkzeugliste. Ist eine Anmeldung noetig, fliegt
 * AuthorizationRequired mit der URL, auf die Issa geschickt werden muss.
 */
export async function connectAndListTools(id: number, authorizationCode?: string): Promise<McpToolSpec[]> {
  const row = await getRow(id);
  const client = await connect(row, authorizationCode);
  try {
    const result = await client.listTools();
    const tools: McpToolSpec[] = result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    await db
      .update(mcpServers)
      .set({
        tools,
        toolsUpdatedAt: new Date(),
        status: "connected",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(mcpServers.id, id));
    logger.info({ server: row.name, count: tools.length }, "MCP-Werkzeuge gelesen");
    return tools;
  } finally {
    await client.close().catch(() => {});
  }
}

/*
 * MCP-Server duerfen ihre Argumente beliebig strukturieren. Higgsfields
 * generate_image/generate_video erwartet die eigentlichen Generierungswerte
 * unter einem Objektfeld "params". Das Studio hatte sie bisher flach gesendet,
 * obwohl das gespeicherte inputSchema den Container beschreibt — dadurch kam
 * -32602 "Invalid input at params".
 *
 * Wir raten nicht anhand des Servernamens. Wenn das konkrete Tool-Schema an der
 * Wurzel ein Objektfeld "params" besitzt und die gelieferten Argumente nicht
 * bereits so verpackt sind, wird der Payload passend zum Schema verschachtelt.
 * Andere MCP-Server und Tools bleiben unveraendert.
 */
function adaptArgsToToolSchema(
  row: McpServer,
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const tool = row.tools.find((t) => t.name === toolName);
  const schema = tool?.inputSchema as Record<string, unknown> | undefined;
  const properties = schema?.properties as Record<string, unknown> | undefined;
  if (!properties || !("params" in properties) || "params" in args) return args;

  const required = Array.isArray(schema?.required)
    ? (schema.required as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  // Ein optionales params neben anderen echten Root-Feldern ist kein Signal,
  // alles blind einzupacken. Bei Higgsfield ist params Pflicht bzw. der einzige
  // eigentliche Eingabecontainer.
  const rootKeys = Object.keys(properties).filter((key) => key !== "params");
  if (!required.includes("params") && rootKeys.length > 0) return args;

  logger.info({ server: row.name, tool: toolName }, "MCP-Argumente unter params verschachtelt");
  return { params: args };
}

export async function callMcpTool(
  serverId: number,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const row = await getRow(serverId);
  if (!row.enabled) throw new Error(`Der MCP-Server "${row.name}" ist im Dashboard deaktiviert.`);

  const client = await connect(row);
  try {
    const adaptedArgs = adaptArgsToToolSchema(row, toolName, args);
    const result = await client.callTool({ name: toolName, arguments: adaptedArgs });

    // MCP-Antworten sind eine Liste von Inhaltsteilen. Fuer Lukas' Kontext
    // zaehlt der Text; Bilder o.ae. werden benannt statt roh eingefuegt.
    const content = Array.isArray(result.content) ? result.content : [];
    const parts = content.map((c: { type?: string; text?: string }) =>
      c?.type === "text" && typeof c.text === "string" ? c.text : `[${c?.type ?? "unbekannt"}]`,
    );
    const text = parts.join("\n").trim() || "(leere Antwort)";
    if (result.isError) throw new Error("FEHLER vom MCP-Server: " + text.slice(0, 12000));
    return text.slice(0, 12000);
  } finally {
    await client.close().catch(() => {});
  }
}

/** Alle Server, deren Werkzeuge Lukas gerade benutzen darf. */
export async function activeServers(): Promise<McpServer[]> {
  return db.select().from(mcpServers).where(eq(mcpServers.status, "connected"));
}

/*
 * Aus einer MCP-Textantwort die fertige Mediendatei ziehen.
 *
 * Genau das war die Luecke: generate_image liefert bei Higgsfield KEINE
 * fertige URL, sondern eine Auftragsnummer. Mein erster Wurf hat nur nach
 * einer URL gesucht, keine gefunden, den Auftrag auf "processing" gesetzt —
 * und weil MCP-Auftraege bewusst nicht mehr gegen die REST-API gepollt werden,
 * hat danach NIEMAND mehr nachgefasst. Der Auftrag haengt dann ewig.
 */
export function extractMediaUrl(text: string): string | null {
  return (
    text.match(/https?:\/\/[^\s"'<>)\\]+\.(?:png|jpe?g|webp|gif|mp4|webm|mov)(?:\?[^\s"'<>)\\]*)?/i)?.[0] ??
    null
  );
}

/*
 * Eine Auftrags-/Generierungsnummer aus der Antwort holen, damit spaeter
 * nachgefragt werden kann. MCP-Server antworten in Prosa oder JSON, also
 * mehrere Muster probieren statt eines zu erraten.
 */
export function extractJobId(text: string): string | null {
  const uuid = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid) return uuid[0];
  const keyed = text.match(/"(?:job_?id|generation_?id|id)"\s*:\s*"([^"]{6,})"/i);
  if (keyed) return keyed[1];
  return null;
}

/*
 * Bei einem laufenden Auftrag nachfragen.
 *
 * Higgsfield bietet dafuer jobs_wait, show_generation_by_ids und job_display
 * an. Welche Werkzeuge ein Server wirklich hat, wissen wir erst zur Laufzeit —
 * deshalb der Reihe nach durchprobieren, statt eines fest zu verdrahten.
 *
 * WICHTIG sind hier die Argumentnamen. Mein erster Wurf hat sie geraten
 * (ids/job_id/job_ids) und lag bei allen dreien daneben: die echten Schemata
 * verlangen jobs:[{index,job_id}] bzw. id. Jede Nachfrage flog also in einen
 * Schema-Fehler, wurde nur als Warnung geloggt, und der Auftrag stand
 * weiterhin auf "processing" bis er nach 20 Minuten als gescheitert galt.
 * Genau so sind die beiden FAILED-Eintraege im Studio entstanden.
 */
export async function pollMcpJob(serverId: number, jobId: string): Promise<string | null> {
  const row = await getRow(serverId);
  const jobs = [{ index: 0, job_id: jobId }];
  const kandidaten: Array<{ tool: string; args: Record<string, unknown> }> = [
    // jobs_wait wartet kurz aktiv ab und liefert Ergebnis-URLs — der guenstigste Weg.
    { tool: "jobs_wait", args: { jobs, timeout_seconds: 10 } },
    { tool: "show_generation_by_ids", args: { jobs } },
    { tool: "job_display", args: { id: jobId } },
  ];

  for (const k of kandidaten) {
    if (!row.tools.some((t) => t.name === k.tool)) continue;
    try {
      const text = await callMcpTool(serverId, k.tool, k.args);
      const url = extractMediaUrl(text);
      if (url) return url;
    } catch (err) {
      logger.warn({ err, tool: k.tool, jobId }, "MCP-Nachfrage fehlgeschlagen");
    }
  }
  return null;
}

/*
 * Ein Bild aus dem Netz in den MCP-Server holen.
 *
 * Higgsfield nimmt Referenzbilder NICHT als URL entgegen — im Schema steht
 * ausdruecklich, dass in medias[].value eine media_id gehoert und keine
 * https://-Adresse. Das Studio hat bisher die URL flach als image_url
 * mitgeschickt; das Feld gibt es dort gar nicht, es wurde stillschweigend
 * ignoriert. Ein Video "aus diesem Bild" war damit nie eins.
 *
 * Der richtige Weg ist zweistufig: media_import_url liefert eine media_id,
 * die dann als Referenz mitgegeben wird.
 */
export async function importMediaUrl(serverId: number, url: string): Promise<string | null> {
  const row = await getRow(serverId);
  if (!row.tools.some((t) => t.name === "media_import_url")) return null;
  try {
    const text = await callMcpTool(serverId, "media_import_url", { url });
    const uuid = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return uuid ? uuid[0] : null;
  } catch (err) {
    logger.warn({ err, url }, "Referenzbild konnte nicht importiert werden");
    return null;
  }
}

/*
 * Einen verbundenen Server suchen, der ein bestimmtes Werkzeug anbietet.
 *
 * Damit koennen auch Teile des Dashboards MCP nutzen, die nicht ueber Lukas'
 * Werkzeugkasten laufen — konkret das Studio. Das rief Higgsfield bisher
 * direkt per REST-API und eigenem Schluessel auf, obwohl daneben eine fertige
 * MCP-Verbindung mit OAuth stand. Zwei Wege zum selben Anbieter, von denen nur
 * einer gepflegt wird, ist genau die Sorte Doppelung, die spaeter auseinander
 * laeuft.
 *
 * Die erste Uebereinstimmung gewinnt; gibt es keine, liefert das null und der
 * Aufrufer entscheidet, ob er einen Ersatzweg hat.
 */
export async function findServerWithTool(
  ...toolNames: string[]
): Promise<{ server: McpServer; tool: string } | null> {
  for (const server of await activeServers()) {
    if (!server.enabled) continue;
    for (const name of toolNames) {
      if (server.tools.some((t) => t.name === name)) return { server, tool: name };
    }
  }
  return null;
}
