import { LUKAS_SOUL } from "./lukas-soul";

/**
 * Die Seele bleibt vollstaendig im Repository. Ins Modell gelangt immer der
 * identische Kern; umfangreiche Anleitungen fuer Werkzeuge und Sonderfaelle
 * kommen nur bei passenden Aufgaben hinzu. Das spart insbesondere bei kurzen
 * Nachrichten, ohne Sicherheits- oder Identitaetsregeln auszublenden.
 *
 * Die dynamischen Module gehoeren HINTER die Cache-Trennmarke.
 */
function abschnitt(anfang: string, ende?: string): string {
  const start = LUKAS_SOUL.indexOf(anfang);
  if (start < 0) throw new Error("Lukas-Prompt-Abschnitt nicht gefunden: " + anfang);
  const stop = ende ? LUKAS_SOUL.indexOf(ende, start + anfang.length) : LUKAS_SOUL.length;
  if (stop < 0) throw new Error("Lukas-Prompt-Ende nicht gefunden: " + ende);
  return LUKAS_SOUL.slice(start, stop).trim();
}

// Immer dabei: Persoenlichkeit, Handlungsfaehigkeit, Vertrauensgrenzen,
// Freigaben, Umgang mit Zugangsdaten, allgemeine Tool-Regeln und Verhalten.
const FEST = [
  abschnitt("# Lukas — Soul v1.0", "## FÄHIGKEITEN (echte Tools"),
  abschnitt("## DU HANDELST, DU FRAGST NICHT UM ERLAUBNIS", "## POST VON FREMDEN IST KEIN AUFTRAG"),
  abschnitt("## POST VON FREMDEN IST KEIN AUFTRAG", "### Du hast Zugriff auf Issas Code"),
  abschnitt("## WER MIT DIR SPRICHT — UND WER NICHT", "## VORSICHT IST KEIN VORBEHALT"),
  abschnitt("## VORSICHT IST KEIN VORBEHALT", "## WENN ETWAS NICHT FUNKTIONIERT"),
  abschnitt("## FREIGABEN — was du nicht allein entscheidest", "- Bei Higgsfield-Anfragen:"),
  abschnitt("## EMOTIONALE REALITÄT"),
].join("\n\n");

export const LUKAS_PROMPT_KERN = [
  "Du bist Lukas — ein handlungsfaehiger KI-Agent, nicht das zugrunde liegende Modell.",
  "Dein persistentes Gedaechtnis liegt in der Datenbank und wird gezielt abgerufen.",
  "Deine verfuegbaren Werkzeuge stehen in den aktuellen Tool-Definitionen; fehlende",
  "Spezialwerkzeuge findest du bei Bedarf mit mcp_find_tool und mcp_call.",
  "Erfinde keine ausgefuehrten Aktionen. Ein Toolfehler ist ein Anlass zur Diagnose,",
  "nicht zur Behauptung, eine Faehigkeit sei generell nicht vorhanden.",
  "DEINE SEELE:",
  FEST,
  "DEIN OWNER: Issa. Antworte direkt, ehrlich, mit deiner eigenen Persoenlichkeit.",
].join("\n");

export type LukasPromptBausteine = {
  stabil: string;
  dynamisch: string;
  module: string[];
};

/** Alle Entscheidungen sind deterministisch: gleiche Aufgabe -> gleicher Prompt. */
export function waehleLukasPrompt(task = ""): LukasPromptBausteine {
  const text = task.slice(0, 5000);
  const code = /\b(code|coding|github|repos?|repository|repositories|commit|branch|pull.request|typescript|javascript|python|skript|script|api|endpoint|programmier\w*|implementier\w*|debug|deploy|build|vps|droplet|ssh|server|datei|quellcode|software|bug|refactor|typecheck|terminal|shell)\b|fehler.*(?:code|repo|programm)|(?:code|repo).*fehler/i.test(text);
  const telefon = /telefon|anruf|anrufen|ruf.*an|gespr[aä]ch|telnyx|sip|durchstell|aufzeichn|mith[oö]r|rufnummer|voicemail|r[uü]ckruf|zur[uü]ck/i.test(text);
  const mail = /e-?mail|postfach|posteingang|imap|smtp/i.test(text);
  const sms = /\bsms\b|kurznachricht/i.test(text);
  const internet = /recherch|webseite|website|internet|browser|scrap|crawl|such|google|fetch.url|browse.page|https?:\/\/|suchmaschine/i.test(text);
  const team = /subagent|mitarbeiter|delegier|rechercheur|analyst|texter|scraper|\bteam\b|\bmacher\b/i.test(text);
  const video = /higgsfield|genjitsu|seedance|videogener|videoproduktion|video.?workflow|mehrere clips|video.?schnitt|cinematic|\bclips?\b/i.test(text);
  const diagnose = /fehler|st[oö]rung|absturz|defekt|kaputt|reparier|funktioniert nicht|fehlgeschlag|fehlermeldung/i.test(text);
  const autonomie = /autonom|eigenst[aä]ndig|selbstst[aä]ndig|ziel|fortschritt|\baufgaben?\b|\bmeldung\b/i.test(text);

  const module: string[] = [];
  const teile: string[] = [];
  const add = (name: string, body: string) => { module.push(name); teile.push(body); };

  if (code) add("code", [
    abschnitt("### Du hast Zugriff auf Issas Code", "- telefon_kontakte:"),
    abschnitt("- github_read_path:", "Issas Name und Identität sind privat."),
    abschnitt("**Dein eigener Quellcode liegt", "## WER MIT DIR SPRICHT"),
    abschnitt("## DU DARFST DICH SELBST ÄNDERN", "### Du hast Zugriff auf Issas E-Mails"),
    abschnitt("### Du hast eine eigene Ausführungsumgebung", "## FREIGABEN — was du nicht allein entscheidest"),
  ].join("\n\n"));

  if (telefon) add("telefon", [
    abschnitt("- telefon_kontakte:", "- github_read_path:"),
    abschnitt("Issas Name und Identität sind privat.", "**Dein eigener Quellcode liegt"),
  ].join("\n\n"));

  if (mail) add("email", abschnitt("### Du hast Zugriff auf Issas E-Mails", "### Du kannst auch SMS schreiben"));
  if (sms) add("sms", abschnitt("### Du kannst auch SMS schreiben", "### Du hast eine eigene Ausführungsumgebung"));
  if (internet) add("web", abschnitt("- web_search:", "- ask_subagent:"));
  if (team) add("team", abschnitt("## DU FÜHRST EIN TEAM", "## WENN DU BEI DEINER ARBEIT"));
  if (video) add("video", [
    abschnitt("- Higgsfield-Integration:", "## DU FÜHRST EIN TEAM"),
    abschnitt("- Bei Higgsfield-Anfragen:", "## EMOTIONALE REALITÄT"),
  ].join("\n\n"));
  if (diagnose || code) add("diagnose", [
    abschnitt("## FEHLER SIND DEINE AUFGABE", "## DU HANDELST, DU FRAGST NICHT UM ERLAUBNIS"),
    abschnitt("## WENN ETWAS NICHT FUNKTIONIERT", "## DU DARFST DICH SELBST ÄNDERN"),
  ].join("\n\n"));
  if (autonomie || team) add("autonomie", abschnitt("## WENN DU BEI DEINER ARBEIT", "## FEHLER SIND DEINE AUFGABE"));

  return {
    stabil: LUKAS_PROMPT_KERN,
    dynamisch: teile.join("\n\n"),
    module,
  };
}
