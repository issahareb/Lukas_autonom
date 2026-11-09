import type OpenAI from "openai";
import { istAntwortEntwurf } from "./aufgaben-bedarf";

const WEBSITE_KENNZAHLEN = /aufrufzahl|\baufrufe\b|seitenaufruf|besucher|pageviews?|scrolltiefe|verweildauer|analytics|website.{0,30}(?:statistik|kennzahl|traffic)|(?:statistik|kennzahl|traffic).{0,30}website/i;
const GRUPPEN: Array<[RegExp, string[]]> = [
  [/frage_issa|r[uü]ckfrag|frage? (?:mich|issa)|entscheidungsfrage|auswahlfenster/i, ['frage_issa']],
  [WEBSITE_KENNZAHLEN, ["lese_website_kennzahlen"]],
  [/anfrag|interessent|kunden?anliegen|leads?\b|eingegangen|eingänge|eingange/i, ["lese_anfragen"]],
  [/such|recherch|aktuell|quelle|preis|kostet|internet|öffnungszeit|kommend|protest|news|wetter|ceo|präsident|\bmorgen\b|\bheute\b/i, ["web_search"]],
  [/https?:|webseite|website|fetch|url|link/i, ["fetch_url"]],
  [/browser|scrap|crawl|render|seite.*(?:öffn|oeffn|anseh|les)/i, ["browse_page"]],
  [/browser.*(?:bedien|klick|tipp|anmeld|login|formular)|(?:klick|tipp|anmeld|login|formular).*browser/i, ["browser_do"]],
  [/repo|package\.json|quellcode|programmier|build|typecheck|skript|python|javascript|typescript|implement|debug|reparier|\.(?:tsx?|jsx?|py)\b/i, ["github_list_repos", "github_read_path", "github_search_code"]],
  [/implement|programmier|debug|reparier|behebe|refactor|deploy|(?:schreib|erstell|änder|aender|bau).*?(?:code|skript|repo|typescript)|(?:führ|fuehr).*?(?:test|build|befehl)/i, ["execute_command", "propose_code_change", "fix_error"]],
  [/mail|postfach|posteingang/i, ["email_search", "email_read"]],
  [/(?:schreib|sende|schick|versend).*?(?:mail|e-mail)|(?:mail|e-mail).*?(?:sende|schick|versend)/i, ["email_send"]],
  [/telefon|anruf|gespräch|gespraech|\bkontakte?\b|\bruf(?:e)?\b.{0,120}\ban\b/i, ["telefon_status", "telefon_kontakte"]],
  [/\banrufen\b|\bruf(?:e)?\b.*\ban\b|starte.*anruf/i, ["ruf_an"]],
  [/r[uü]ckruf|zur[uü]ckruf|\bruf(?:e)?\b.{0,120}\bzur[uü]ck\b/i, ["rueckruf_status"]],
  [/\b(?:plane?|terminier\w*)\b.*r[uü]ckruf|\bruf(?:e)?\b.{0,120}\bzur[uü]ck\b|\b(?:in|um)\b.*zur[uü]ckrufen/i, ["plane_rueckruf"]],
  [/(?:stornier|absag|abbrechen).*r[uü]ckruf|r[uü]ckruf.*(?:stornier|absag|abbrechen)/i, ["storniere_rueckruf"]],
  [/fl[uü]ster|whisper|(?:sag|hinweis).*?(?:telefon|gespr[aä]ch|anruf)/i, ["telefon_hinweis"]],
  [/\bziele?\b|\bplan\b|\bplane\b|aufgab|fortschritt/i, ["create_goal", "update_goal"]],
  [/merk|speicher/i, ["save_memory", "query_memory"]],
  [/erinner|gedächtnis|gedaechtnis|wei[ßs]t.*(?:noch|mich)|wei[ßs].*über mich|vorliebe|damals|vorhin|wer bin ich|mein name/i, ["query_memory"]],
  [/tagebuch|rückblick|recap/i, ["write_diary"]],
  [/diagnos|störung|fehler/i, ["read_diagnostics"]],
  [/(?:setz|änder|aender).*status|status.*(?:setz|änder|aender)/i, ["set_status"]],
  [/verbrauch|token|budget|kosten/i, ["read_usage"]],
  [/trading|trade|bankroll/i, ["get_trading_stats"]],
  [/moltbook/i, ["get_moltbook_activity"]],
  [/sms|nachricht.*schick/i, ["send_sms"]],
  [/gefühl|fühl|fuehl/i, ["feel"]],
  [/gesicht|mimik|ausdruck|guck|schau.*(?:böse|boese|traurig|fröhlich)|lächel|laechel/i, ["set_expression"]],
  [/autonom|eigenständig|selbstständig|melde.*issa|fortschritt|freigabe|blockiert/i, ["melde_dich_bei_issa"]],
  [/host|vps|droplet|sandbox|\bssh\b/i, ["execute_command", "execute_on_host", "reset_sandbox"]],
  [/team|agent|mitarbeiter|analyst|texter/i, ["ask_subagent", "list_subagents", "create_subagent"]],
];

export function isToolFreeTask(task: string): boolean {
  return /^(?:hallo|hi|hey|guten (?:morgen|tag|abend)|(?:vielen )?dank(?:e)?(?: dir)?)[.!\s]*$/i.test(task.trim());
}

export function waehleWerkzeuge(tools: OpenAI.Chat.Completions.ChatCompletionTool[], task?: string) {
  // Missing task context must never mean loading the complete catalogue.
  const text = task?.trim() ?? "";
  if (isToolFreeTask(text)) return [];
  if (istAntwortEntwurf(text)) {
    return tools.filter(t => t.type === 'function' &&
      ['mcp_find_tool', 'mcp_call', 'query_memory'].includes(t.function.name));
  }
  // Discovery remains available, so a missed synonym does not remove a capability.
  const names = new Set(["mcp_find_tool", "mcp_call"]);
  for (const [pattern, group] of GRUPPEN) if (pattern.test(text)) group.forEach(n => names.add(n));
  if (WEBSITE_KENNZAHLEN.test(text) && !/internet|recherch|quelle|vergleich.*konkurrenz/i.test(text)) {
    names.delete("web_search"); names.delete("fetch_url");
  }
  if (/anfrag|postfach|posteingang|tokenverbrauch|anrufstatus/i.test(text) &&
      !/web|internet|recherch|quelle|öffnungszeit|wetter/i.test(text.replace(/websites?/gi, ""))) names.delete("web_search");
  if (/anfrag|postfach|posteingang/i.test(text) && !/https?:|\burl\b|verlink|webseite.*(?:les|prüf|pruef)/i.test(text)) names.delete("fetch_url");
  return tools.filter(t => t.type === "function" && names.has(t.function.name));
}

/** Names come only from the controlled discovery tool's output. */
export function discoveredToolNames(result: string): string[] {
  // A broad catalogue without schemas is for browsing, not an eager load.
  if (!result.includes("Schema:")) return [];
  return [...new Set([...result.matchAll(/■ ([a-zA-Z0-9_-]+)\s+\[/g)].map(match => match[1]))].slice(0, 8);
}

export function mergeDiscoveredTools(
  current: OpenAI.Chat.Completions.ChatCompletionTool[], loaded: OpenAI.Chat.Completions.ChatCompletionTool[],
  blocked: Set<string>,
) {
  const names = new Set(current.filter(t => t.type === "function").map(t => t.function.name));
  return [...current, ...loaded.filter(t => t.type === "function" && !blocked.has(t.function.name) && !names.has(t.function.name))];
}

export function zugangsFehler(name: string, error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /EMAIL_USER|EMAIL_APP_PASSWORD|VPS_SSH_KEY|All configured authentication methods failed|Anmeldung erforderlich|Unauthorized|\b401\b|\b403\b/.test(text);
}

/** Include unavailable siblings even when task routing omitted their schemas. */
export function gesperrteWerkzeugNamen(name: string, error: unknown): Set<string> {
  if (!zugangsFehler(name, error)) return new Set();
  const text = error instanceof Error ? error.message : String(error);
  return /VPS_SSH_KEY|authentication methods failed/.test(text)
    ? new Set(["execute_command", "execute_on_host", "reset_sandbox", ...(process.env.LUKAS_BROWSER_URL?.trim() ? [] : ["browse_page", "browser_do"])])
    : /EMAIL_USER|EMAIL_APP_PASSWORD/.test(text)
    ? new Set(["email_search", "email_read", "email_send"])
    : new Set([name]);
}

export function werkzeugeNachFehler(tools: OpenAI.Chat.Completions.ChatCompletionTool[], name: string, error: unknown) {
  const blocked = gesperrteWerkzeugNamen(name, error);
  return tools.filter(t => t.type !== "function" || !blocked.has(t.function.name));
}
