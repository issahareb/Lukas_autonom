import type OpenAI from "openai";

const GRUPPEN: Array<[RegExp, string[]]> = [
  [/such|recherch|aktuell|quelle|preis|kostet|website|webseite|https?:|internet|öffnungszeit|browser|kommend|protest|nachricht|news/i, ["web_search", "fetch_url", "browse_page", "browser_do"]],
  [/repo|package\.json|quellcode|programmier|build|typecheck|skript|python|javascript|typescript|implement|debug|reparier/i, ["github_list_repos", "github_read_path", "github_search_code", "execute_command", "propose_code_change", "fix_error"]],
  [/mail|postfach|posteingang/i, ["email_search", "email_read", "email_send"]],
  [/telefon|anruf|anruf(en)?|gespräch|gespraech|kontakt|ruf.*an/i, ["telefon_status", "telefon_kontakte", "telefon_hinweis", "ruf_an"]],
  [/ziel|plan|aufgab|fortschritt/i, ["create_goal", "update_goal"]],
  [/merk|speicher|erinner|gedächtnis|gedaechtnis/i, ["save_memory", "query_memory"]],
  [/tagebuch|rückblick|recap/i, ["write_diary"]],
  [/diagnos|störung|status|fehler/i, ["read_diagnostics", "set_status"]],
  [/verbrauch|token|budget|kosten/i, ["read_usage"]],
  [/trading|trade|bankroll/i, ["get_trading_stats"]],
  [/moltbook/i, ["get_moltbook_activity"]],
  [/sms|nachricht.*schick/i, ["send_sms"]],
  [/gefühl|fühl|fuehl/i, ["feel"]],
  [/host|vps|droplet|sandbox|\bssh\b/i, ["execute_command", "execute_on_host", "reset_sandbox"]],
  [/team|agent|mitarbeiter|analyst|texter/i, ["ask_subagent", "list_subagents", "create_subagent"]],
];

export function waehleWerkzeuge(tools: OpenAI.Chat.Completions.ChatCompletionTool[], task?: string) {
  if (task === undefined) return tools;
  // Discovery remains available, so a missed synonym does not remove a capability.
  const names = new Set(["set_expression", "web_search", "query_memory", "mcp_find_tool", "mcp_call", "ask_subagent", "melde_dich_bei_issa"]);
  for (const [pattern, group] of GRUPPEN) if (pattern.test(task)) group.forEach(n => names.add(n));
  return tools.filter(t => t.type === "function" && names.has(t.function.name));
}

export function zugangsFehler(name: string, error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /EMAIL_USER|EMAIL_APP_PASSWORD|VPS_SSH_KEY|All configured authentication methods failed|Anmeldung erforderlich|Unauthorized|\b401\b|\b403\b/.test(text);
}

export function werkzeugeNachFehler(tools: OpenAI.Chat.Completions.ChatCompletionTool[], name: string, error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  if (!zugangsFehler(name, error)) return tools;
  const blocked = /VPS_SSH_KEY|authentication methods failed/.test(text)
    ? new Set(["execute_command", "execute_on_host", "reset_sandbox", ...(process.env.LUKAS_BROWSER_URL?.trim() ? [] : ["browse_page", "browser_do"])])
    : /EMAIL_USER|EMAIL_APP_PASSWORD/.test(text)
    ? new Set(["email_search", "email_read", "email_send"])
    : new Set([name]);
  return tools.filter(t => t.type !== "function" || !blocked.has(t.function.name));
}
