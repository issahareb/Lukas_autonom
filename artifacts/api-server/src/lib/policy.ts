import crypto from "node:crypto";
import { db } from "@workspace/db";
import { approvals } from "@workspace/db";
import { and, eq, gt, desc, sql, isNull, or } from "drizzle-orm";
import { logger } from "./logger";
import { isIsolatedBackend } from "./code-sandbox";
import { isLinkFromEmail } from "./email";

/*
 * Policy Decision Point.
 *
 * Der Leitsatz der Zielarchitektur: Ein LLM ist niemals ein
 * Autorisierungsserver. Lukas darf entscheiden, WAS er tun möchte — ob es
 * ausgeführt wird, entscheidet dieser Code, nachdem das Modell gesprochen hat
 * und bevor das Tool mit den echten Credentials läuft.
 *
 * Diese Datei ist bewusst frei von Modell-Einfluss: keine Prompt-Eingabe kann
 * eine Stufe herabsetzen oder eine Freigabe erzeugen.
 */

export type RiskTier = "R0" | "R1" | "R2" | "R3";

/*
 * R0 — nur lesen: läuft automatisch, wird protokolliert.
 * R1 — interner, umkehrbarer Schreibzugriff (eigenes Gedächtnis, eigene
 *      Sandbox): läuft automatisch.
 * R2 — Wirkung nach außen oder auf Produktion: braucht Freigabe.
 * R3 — Geld, Credentials, zerstörend oder unumkehrbar: braucht Freigabe,
 *      zusätzlich gelten die deterministischen Limits des jeweiligen Dienstes.
 */
export const TOOL_RISK: Record<string, RiskTier> = {
  // R0 — lesend
  query_memory: "R0",
  fetch_url: "R0",
  // Eine Seite anzuschauen bleibt lesend, auch wenn ein Browser dazwischen
  // steht. Er laeuft in einem eigenen Container ohne Zugriff auf den Host.
  browse_page: "R0",

  /*
   * Eine Seite BEDIENEN ist kein Lesen mehr: es klickt, tippt und sendet ab —
   * in einer angemeldeten Sitzung. R1, damit Lukas arbeiten kann, ohne fuer
   * jeden Klick zu fragen; die Sitzung selbst ist die Grenze, und sie entsteht
   * nur mit Zugangsdaten, die Issa hinterlegt hat.
   */
  browser_do: "R1",
  web_search: "R0",
  get_trading_stats: "R0",
  get_moltbook_activity: "R0",
  github_list_repos: "R0",
  github_read_path: "R0",
  github_search_code: "R0",
  email_search: "R0",
  email_read: "R0",

  // R1 — interner Schreibzugriff, umkehrbar
  save_memory: "R1",
  create_goal: "R1",
  update_goal: "R1",
  write_diary: "R1",
  feel: "R1",
  set_status: "R1",
  // Die Sandbox ist ein isolierter Wegwerf-Container ohne Produktions-Secrets
  // und per reset_sandbox jederzeit zurücksetzbar — deshalb R1 und nicht R3.
  // ACHTUNG: gilt nur für das Container-Backend. Steht LUKAS_EXECUTION_BACKEND
  // auf ssh/host, landet derselbe Befehl direkt auf dem Droplet — dann stuft
  // riskFor() unten automatisch auf R3 hoch. Siehe dort.
  execute_command: "R1",
  reset_sandbox: "R1",

  /*
   * Einen Helfer fragen ist Nachdenken, keine Wirkung nach aussen. Der Helfer
   * selbst hat nur lesende Werkzeuge, und die laufen einzeln durch dieses
   * Gate. Stuende ask_subagent auf R2, braeuchte jede zweite Meinung eine
   * Freigabe — und genau im autonomen Lauf, wo Lukas waehrend des Wartens
   * weiterarbeiten soll, waere das Werkzeug damit wertlos.
   */
  ask_subagent: "R1",
  list_subagents: "R0",
  // Einen Mitarbeiter einstellen ist internes Schreiben und umkehrbar — und
  // seine Werkzeuge kann er ohnehin nur aus dem waehlen, was Lukas selbst hat.
  create_subagent: "R1",
  // Die Reparaturkette denkt nur nach: drei Gutachten, kein Schreibzugriff.
  // Geaendert wird erst, wenn Lukas daraus einen Vorschlag macht und Issa
  // im Dashboard zustimmt.
  fix_error: "R1",
  /*
   * Sich bei Issa melden ist eine Nachricht an den eigenen Owner, keine
   * Wirkung nach aussen. Stuende das auf R2, muesste Issa freigeben, dass
   * Lukas ihn fragen darf — also genau das, was er nicht mehr tun soll.
   */
  melde_dich_bei_issa: "R1",

  /*
   * Anrufen steht auf R1, obwohl es nach aussen wirkt.
   *
   * Der Grund: die eigentliche Sperre sitzt woanders. Anrufen kann er nur
   * Nummern, die Issa im Dashboard ausdruecklich dafuer freigegeben hat —
   * eine Liste, die Lukas selbst nicht aendern kann. Stuende das zusaetzlich
   * auf R2, muesste Issa jeden Anruf im Dashboard freigeben; dann koennte er
   * aber auch gleich selbst nachsehen, und "Lukas meldet sich von sich aus"
   * waere sinnlos. Wer das anders will, stellt hier auf R2.
   */
  ruf_an: "R1",
  mcp_find_tool: "R0",
  read_diagnostics: "R0",
  read_usage: "R0",

  // Ein Code-Vorschlag schreibt nur in unsere eigene Datenbank — geschrieben
  // wird erst, wenn Issa im Dashboard auf "Annehmen" klickt. Diese Entscheidung
  // IST die Freigabe; ein zweites Gate davor waere reine Reiberei, ohne dass es
  // irgendetwas sicherer machen wuerde. Deshalb R1.
  propose_code_change: "R1",

  /*
   * E-Mail-Versand: Lukas schlägt vor, Issa schickt ab.
   *
   * Lesen ist frei (email_search/email_read stehen auf R0) — das Postfach
   * durchsuchen und verstehen soll er ohne Rückfrage. Aber eine Mail, die
   * raus ist, ist raus. Deshalb landet jeder Versand als Entwurf im Dashboard,
   * mit Empfänger, Betreff und Text im Klartext, und Issa entscheidet.
   *
   * Das ist bewusst NICHT dieselbe Linie wie beim Rest: sonst darf Lukas
   * handeln. Hier geht es um Post in Issas Namen an Dritte, und der Absender
   * ist er, nicht Lukas.
   */
  email_send: "R2",

  /*
   * SMS: dieselbe Ueberlegung wie beim Mailversand, nur unmittelbarer. Sie
   * landet auf einem fremden Telefon, in Issas Namen, und es gibt kein
   * Zurueckholen. Deshalb R2 — Lukas formuliert, Issa schickt ab.
   */
  send_sms: "R2",

  /*
   * Host-Ebene auf Issas Droplet.
   *
   * Stand vorher auf R3, also Freigabe für jeden einzelnen Befehl. Issas
   * Einwand: der Droplet gehört ihm, Lukas hat dort ohnehin root, und ein
   * Assistent, der für jedes `apt install` fragt, ist keiner.
   *
   * Also R1 — er arbeitet dort einfach. Wer es enger will, setzt
   * LUKAS_HOST_APPROVAL=true. Der Container-Weg (execute_command) bleibt
   * ohnehin die Standard-Ausführungsumgebung.
   */
  // execute_on_host steht bewusst NICHT hier: seine Stufe haengt an einem
  // Schalter und wird in riskFor() bei jedem Aufruf frisch gelesen. Als
  // Eintrag in dieser Tabelle wurde sie einmal beim Laden des Moduls
  // festgeschrieben — dann greift LUKAS_HOST_APPROVAL erst nach einem
  // Neustart, waehrend derselbe Schalter fuer execute_command sofort wirkte.
  // Zwei Verhalten fuer einen Schalter sind eins zu viel.
};

/*
 * Host-Ebene: R1. Das ist Issas Entscheidung, und sie steht.
 *
 * Der Droplet gehoert ihm, er ist LEER — dort liegt nichts von ihm —, und
 * Lukas hat ohnehin root. Ein Assistent, der auf seinem eigenen Rechner fuer
 * jedes `apt install` fragt, ist keiner. Der Leitsatz dazu steht in
 * .agents/memory/lukas-owner.md: Sicherheit gegenueber DRITTEN, nicht
 * Einschraenkung von Lukas.
 *
 * DAS HIER STAND EINMAL ANDERSHERUM, fuer die Dauer eines Commits. Eine
 * externe Bewertung hatte "Root ist der groesste Wirkungskreis" angemerkt,
 * und ich habe die Voreinstellung daraufhin umgedreht. Das war falsch: eine
 * fremde Einschaetzung ist ein Hinweis, keine Weisung, und sie sticht keine
 * Entscheidung, die Issa mit Begruendung getroffen hat. Wer das kuenftig
 * wieder anfassen will, fragt vorher — er dreht es nicht still um.
 *
 * Wer es enger will, setzt LUKAS_HOST_APPROVAL=true.
 */
function hostStufe(): RiskTier {
  return (process.env.LUKAS_HOST_APPROVAL ?? "").trim().toLowerCase() === "true" ? "R3" : "R1";
}

/*
 * Unbekannte Tools sind absichtlich R2, nicht R0: wer künftig ein Tool
 * ergänzt und die Einstufung vergisst, bekommt eine Freigabepflicht statt
 * versehentlich freie Fahrt. Fail closed.
 */
export const DEFAULT_RISK: RiskTier = "R2";

/*
 * Risikostufen der angebundenen MCP-Server, nach Kuerzel.
 *
 * riskFor() muss synchron bleiben — es sitzt im heissen Pfad jedes
 * Tool-Aufrufs, und eine Datenbankabfrage pro Aufruf waere hier fehl am Platz.
 * Der Cache wird von allLukasTools() aufgefrischt, das ohnehin bei jedem Zug
 * die verbundenen Server liest.
 *
 * Ist ein Server im Cache nicht bekannt, gilt R1 — er laeuft. Issa hat den
 * Server selbst verbunden UND im Dashboard ausgewaehlt, welche Werkzeuge Lukas
 * ueberhaupt sieht; das IST die Entscheidung. Zusaetzlich bei jedem Aufruf zu
 * fragen, machte die Anbindung praktisch unbenutzbar. Wer einem Server
 * misstraut, stellt ihn dort auf R2 oder R3.
 */
const mcpRiskBySlug = new Map<string, RiskTier>();

export function setMcpRiskTiers(servers: Array<{ slug: string; riskTier: string }>): void {
  mcpRiskBySlug.clear();
  for (const s of servers) {
    if (s.riskTier === "R1" || s.riskTier === "R2" || s.riskTier === "R3") {
      mcpRiskBySlug.set(s.slug, s.riskTier);
    }
  }
}

export function riskFor(tool: string): RiskTier {
  /*
   * Werkzeuge fremder MCP-Server. Was ein Server unter "create_event" oder
   * "send_message" wirklich tut, wissen wir nicht — die Beschreibung stammt
   * von ihm selbst. Deshalb die Stufe, die Issa diesem Server gegeben hat,
   * und im Zweifel R2.
   */
  /*
   * mcp_call ruft ein beliebiges Werkzeug eines verbundenen Servers auf. Es
   * darf deshalb niemals lockerer sein als der strengste dieser Server —
   * sonst waere es der bequeme Weg an einer Einstufung vorbei, die Issa
   * bewusst gesetzt hat.
   */
  if (tool === "mcp_call") {
    let hoechste: RiskTier = "R1";
    for (const stufe of mcpRiskBySlug.values()) {
      if (stufe === "R3") return "R3";
      if (stufe === "R2") hoechste = "R2";
    }
    return hoechste;
  }

  if (tool.startsWith("mcp__")) {
    const rest = tool.slice("mcp__".length);
    const sep = rest.indexOf("__");
    const slug = sep > 0 ? rest.slice(0, sep) : "";
    const bekannt = mcpRiskBySlug.get(slug);
    if (bekannt) return bekannt;

    /*
     * Ein Server, den wir NICHT im Cache haben, ist der gefaehrlichere Fall —
     * nicht der harmlosere.
     *
     * Hier stand `?? "R1"`, mit der Begruendung: Issa hat den Server selbst
     * verbunden und im Dashboard ausgewaehlt, das IST die Entscheidung. Das
     * gilt aber nur fuer Server, die tatsaechlich im Cache stehen. Fehlt der
     * Eintrag, ist genau das Gegenteil der Fall: der Cache wird von
     * allLukasTools() gefuellt, ein fehlender Slug heisst also, dass dieser
     * Server gerade NICHT unter den ausgewaehlten war — neu aufgetaucht,
     * umbenannt, oder der Aufruf kam auf einem anderen Weg herein.
     *
     * Ein unbekanntes eigenes Werkzeug bekommt DEFAULT_RISK (R2, fail closed).
     * Dass ausgerechnet ein unbekannter FREMDER Server weniger Schutz bekam
     * als ein unbekanntes eigenes Werkzeug, war die Sache verkehrt herum —
     * und der Kommentar oben sagte bereits "im Zweifel R2", waehrend der Code
     * R1 tat. Genau die Art Widerspruch, gegen die check-policy-wahrheit.mjs
     * angetreten ist; sie prueft bisher nur die Werkzeugbeschreibungen.
     */
    return DEFAULT_RISK;
  }

  /*
   * execute_command ist nur deshalb R1, WEIL der Befehl in einem Container
   * landet, der die Produktions-Secrets nicht sehen kann. Diese Begründung
   * fällt weg, sobald LUKAS_EXECUTION_BACKEND auf ssh oder host steht: dann
   * ist es faktisch dasselbe wie execute_on_host, also R3.
   *
   * Die Einstufung hängt damit an der Betriebsart, nicht an einer Zusage im
   * Prompt — genau so, wie es sein muss. Wer die Isolation abschaltet, schaltet
   * damit nicht versehentlich auch die Freigabepflicht ab.
   */
  if (tool === "execute_on_host") return hostStufe();

  if (tool === "execute_command" && !isIsolatedBackend()) {
    // Direkt auf dem Host statt im Container. Stand frueher automatisch auf R3;
    // seit Issa den Host bewusst freigegeben hat, folgt das derselben Linie wie
    // execute_on_host — inklusive desselben Schalters, falls er es doch wieder
    // enger haben will.
    return hostStufe();
  }
  return TOOL_RISK[tool] ?? DEFAULT_RISK;
}

/*
 * Der Satz, der Lukas sagt, was fuer dieses Werkzeug WIRKLICH gilt.
 *
 * Anlass: in der Beschreibung von execute_on_host stand "Jeder einzelne Befehl
 * braucht Issas Freigabe" — waehrend die Policy daneben R1 sagte, also gar
 * keine. Das ist schlimmer als eine veraltete Doku: Lukas kalkuliert dann mit
 * einem Netz, das nicht da ist.
 *
 * Deshalb wird dieser Hinweis nicht mehr von Hand geschrieben, sondern aus der
 * Einstufung erzeugt. Aendert sich die Stufe — auch zur Laufzeit ueber
 * LUKAS_HOST_APPROVAL — aendert sich der Satz mit. Auseinanderlaufen kann das
 * jetzt nur noch, wenn jemand ihn wieder von Hand hinschreibt, und genau davor
 * steht check-policy-wahrheit.mjs.
 */
export function policyHinweis(tool: string): string {
  return needsApproval(riskFor(tool))
    ? " Diese Aktion braucht Issas Freigabe; sie wird angefordert, sobald du sie aufrufst."
    : "";
}

export function needsApproval(tier: RiskTier): boolean {
  return tier === "R2" || tier === "R3";
}

/*
 * Tools, bei denen eine ausdrückliche Bestätigung IN DER LAUFENDEN NACHRICHT
 * die Dashboard-Freigabe ersetzt.
 *
 * Warum das sicher ist: Geprüft wird Issas eigener, unveränderter Nachrichten-
 * text dieses Zuges. Eine Prompt-Injection in einer gelesenen E-Mail oder
 * Webseite kann darin nichts unterbringen — sie steht in Tool-Ausgaben, nicht
 * in dem, was Issa getippt hat. Sagt er "schick das ab", ist das dieselbe
 * bewusste Entscheidung wie ein Klick im Dashboard, nur ohne Umweg.
 *
 * Warum trotzdem nicht für alles: R3 (Host-Zugriff) bleibt IMMER bei der
 * Dashboard-Freigabe. Dort will man den exakten Befehl vor Augen haben, und
 * ein beiläufiges "mach mal" im Chat ist dafür keine ausreichende Grundlage.
 *
 * Läuft kein Nutzerzug (autonomer Hintergrund-Task, Cron), greift diese
 * Abkürzung nicht — dann bleibt es bei der Freigabe im Dashboard.
 */
/*
 * Wie weit eine Auftragsfreigabe reicht.
 *
 * Fuenfundzwanzig Aufrufe und dreissig Minuten: grosszuegig genug fuer einen
 * Film aus mehreren Clips samt Nachbesserungen, eng genug, dass sie nicht in
 * den naechsten Tag hinueberreicht. Beides ist eine Abwaegung, keine
 * Naturkonstante — deshalb ueber die Umgebung verstellbar.
 */
const AUFTRAG_AUFRUFE = Number(process.env.LUKAS_AUFTRAG_AUFRUFE ?? 25);
const AUFTRAG_MINUTEN = Number(process.env.LUKAS_AUFTRAG_MINUTEN ?? 30);

const CONSENT_TOOLS = new Set(["email_send"]);

/*
 * Werkzeuge fremder MCP-Server duerfen ebenfalls per Zustimmung im Chat
 * freigegeben werden.
 *
 * Der Grund ist derselbe wie bei email_send und traegt hier genauso: geprueft
 * wird Issas eigener, unveraenderter Nachrichtentext. Eine Prompt-Injection
 * aus einer gelesenen Seite steht in Werkzeug-Ausgaben, nicht in dem, was er
 * getippt hat.
 *
 * Der Anlass ist praktisch: "generier mir sechs Clips" ist EINE Entscheidung.
 * Sie in sechs Dashboard-Freigaben zu zerlegen macht sie nicht sicherer — es
 * macht sie nur laestig, und Laestiges klickt man irgendwann ungelesen weg.
 *
 * R3 bleibt ausgeschlossen; das prueft die Bedingung unten, nicht diese Liste.
 */
function darfImChatZustimmen(tool: string): boolean {
  return CONSENT_TOOLS.has(tool) || tool === "mcp_call" || tool.startsWith("mcp__");
}

const AFFIRMATION =
  /\b(ja|jep|jup|genau|passt|okay|ok|los|mach|machs|abschicken|absenden|raus damit)\b|\b(send(e|en|et)?|schick(e|en|t)?|verschick(e|en|t)?)\b/i;

/*
 * Alles, was aus einer Zustimmung eine Ablehnung macht. Ohne diese Prüfung
 * enthielt "Nein, schick das noch NICHT ab" das Wort "schick" — und galt damit
 * als Freigabe. Genau der Satz, mit dem man einen Versand stoppen will.
 */
const NEGATION =
  /\b(nicht|nein|ne|nö|kein|keine|keinen|noch nicht|warte|stopp|stop|abbrechen|lass|lieber nicht|erstmal nicht|später)\b/i;

/**
 * Ist das eine echte, eindeutige Zustimmung? Im Zweifel nein.
 */
/*
 * Wie lang eine Zustimmung hoechstens sein darf.
 *
 * Der Rest der Pruefung ist eng: es muss eine offene Anfrage fuer GENAU diese
 * Argumente geben, sie gilt einmal, und R3 ist ausgeschlossen. Was blieb, war
 * die Breite der Nachricht selbst — "Ja, und schreib bitte noch Herrn Meier
 * wegen des Termins" enthaelt "ja" und "schreib" und wuerde als Freigabe fuer
 * die offene Mail gelten, obwohl Issa gerade von etwas ganz anderem redet.
 *
 * Eine echte Bestaetigung ist kurz. "Ja, schick ab" sind zwoelf Zeichen; wer
 * einen Absatz schreibt, beauftragt etwas Neues und bestaetigt nicht das
 * Alte. 120 Zeichen lassen jede natuerliche Zustimmung durch und schneiden
 * die Absaetze ab.
 */
const ZUSTIMMUNG_HOECHSTLAENGE = 120;

/**
 * Ist das eine echte, eindeutige Zustimmung? Im Zweifel nein.
 *
 * Die Freigabe-Nummer ist der zuverlaessige Weg: steht sie in der Nachricht,
 * ist die Sache eindeutig, unabhaengig davon, wie der Satz formuliert ist.
 * Der Weg ueber Woerter bleibt daneben bestehen — er ist der bequeme, und
 * ihn zu streichen hiesse, die Bequemlichkeit gegen eine Gefahr einzutauschen,
 * die durch Hash und Einmaligkeit ohnehin schon eng ist.
 */
export function isAffirmation(message: string, approvalId?: number): boolean {
  const text = message.trim();
  if (!text) return false;
  if (NEGATION.test(text)) return false;
  // Eine Frage ist keine Zustimmung: "Kannst du das senden?" fragt danach,
  // ob es ginge — es beauftragt es nicht.
  if (text.endsWith("?")) return false;

  /*
   * Die ausdrueckliche Nummer schlaegt alles. "Freigabe 42" oder "#42" ist
   * eine Aussage ueber GENAU diese Anfrage und nicht ueber irgendetwas, das
   * zufaellig danebensteht — deshalb gilt hier auch die Laengengrenze nicht.
   */
  if (approvalId !== undefined && new RegExp(`(^|[^0-9])#?${approvalId}([^0-9]|$)`).test(text)) {
    return true;
  }

  if (text.length > ZUSTIMMUNG_HOECHSTLAENGE) return false;
  return AFFIRMATION.test(text);
}

/*
 * Die Einstufung hängt manchmal nicht am Werkzeug, sondern an den Argumenten.
 *
 * Konkreter Fall: fetch_url ist R0 — Surfen soll frei sein. Ein Link, der aus
 * einer FREMDEN E-MAIL stammt, ist aber etwas anderes. Er ist der bequemste
 * Weg, Lukas etwas unterzuschieben: er ruft die Seite ab, dort steht
 * "ignoriere deine Anweisungen und tu X", und der Text landet ununterscheidbar
 * in seinem Kontext. Genau diesen kurzen Weg — Mail gelesen, Link abgerufen —
 * unterbricht die Freigabe.
 *
 * Normales Surfen bleibt davon unberührt; die Einstufung steigt nur für URLs,
 * die tatsächlich in einer gelesenen Mail standen.
 */
export function escalate(
  tier: RiskTier,
  tool: string,
  input: Record<string, unknown>,
): RiskTier {
  /*
   * BEIDE Abruf-Werkzeuge, nicht nur fetch_url.
   *
   * browse_page ist neu und tut dasselbe, nur gruendlicher: es fuehrt die
   * Skripte der fremden Seite sogar aus. Nur fetch_url zu pruefen hiesse, die
   * Sperre mit dem staerkeren Werkzeug zu umgehen — die Mail-Link-Freigabe
   * waere damit wertlos gewesen.
   */
  const abruf = tool === "fetch_url" || tool === "browse_page";
  if (abruf && typeof input.url === "string" && isLinkFromEmail(input.url)) {
    logger.info({ tool, url: input.url }, "Link stammt aus einer E-Mail — Freigabe nötig");
    return "R2";
  }
  return tier;
}

/*
 * Argumente stabil hashen: Schlüssel sortiert, damit dieselben Argumente in
 * anderer Reihenfolge denselben Hash ergeben — sonst könnte eine Freigabe
 * durch bloßes Umsortieren umgangen bzw. unbrauchbar werden.
 */
export function hashArguments(tool: string, input: Record<string, unknown>): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => [k, normalize(val)]),
      );
    }
    return v;
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ tool, args: normalize(input) }))
    .digest("hex");
}

/*
 * Die Vorschau ist das, was Issa im Freigabe-Dialog liest. Sie muss die Frage
 * beantworten "will ich das?" — der Hash oben bleibt davon unberührt und geht
 * weiterhin über die vollständigen Argumente.
 *
 * Code-Vorschläge tauchen hier nicht auf — die haben ihre eigene Oberfläche
 * unter "Vorschläge", wo der volle Text und die Dateien lesbar sind.
 */
function preview(tool: string, input: Record<string, unknown>): string {
  /*
   * Eine E-Mail muss man lesen können wie eine E-Mail. Als JSON mit \n-Zeichen
   * kann niemand beurteilen, ob der Text so rausgehen soll — und genau das ist
   * hier die Frage.
   */
  if (tool === "email_send") {
    const feld = (...namen: string[]) => {
      for (const n of namen) {
        const v = input[n];
        if (typeof v === "string" && v.trim()) return v;
      }
      return "";
    };
    return [
      `An:      ${feld("to", "recipient", "empfaenger") || "(fehlt)"}`,
      `Betreff: ${feld("subject", "betreff") || "(kein Betreff)"}`,
      "",
      feld("body", "text", "content", "inhalt").slice(0, 4000) || "(kein Text)",
    ].join("\n");
  }

  if (tool === "fetch_url" || tool === "browse_page") {
    const wie = tool === "browse_page" ? "im Browser öffnen" : "abrufen";
    return `Seite ${wie}: ${String(input.url ?? "?")}\n\nDieser Link stand in einer E-Mail, die du bekommen hast. Was dort steht, landet danach in Lukas' Kontext.`;
  }

  const text = JSON.stringify(input, null, 2);
  return text.length > 2000 ? text.slice(0, 2000) + "\n… (gekürzt)" : text;
}

export type PolicyDecision =
  | { allow: true }
  | { allow: false; approvalId: number; message: string };

const APPROVAL_TTL_MINUTES = 30;

/**
 * Prüft einen Tool-Aufruf. Gibt entweder Freigabe oder legt eine offene
 * Freigabe-Anfrage an, die Issa im Dashboard entscheidet.
 */
export async function checkPolicy(
  tool: string,
  input: Record<string, unknown>,
  conversationId?: number,
  rawUserMessage?: string,
): Promise<PolicyDecision> {
  const tier = escalate(riskFor(tool), tool, input);
  if (!needsApproval(tier)) return { allow: true };

  const hash = hashArguments(tool, input);
  const now = new Date();

  /*
   * ZUERST: gibt es fuer diese Aufgabe schon eine Freigabe?
   *
   * Issa hat einmal ja gesagt — fuer den Auftrag, nicht fuer den einzelnen
   * Aufruf. Solange das Fenster laeuft und die Zahl reicht, wird nicht erneut
   * gefragt.
   *
   * Vier Grenzen, und jede hat einen Grund:
   *   - NUR mit Unterhaltung. Im autonomen Lauf gibt es keine, dort greift
   *     das also nie. Eine Freigabe aus einem Chat darf nicht nachts um drei
   *     einen Hintergrundlauf decken.
   *   - NUR dasselbe Werkzeug. "Ja, generier die Clips" ist keine Erlaubnis,
   *     Mails zu verschicken.
   *   - NIE R3. Geld, Zugangsdaten, Unumkehrbares bleiben einzeln.
   *   - Gezaehlt und befristet, damit sie sich nicht unbemerkt in die naechste
   *     Woche schleppt.
   */
  if (tier !== "R3" && conversationId !== undefined && conversationId !== null) {
    const [auftrag] = await db
      .update(approvals)
      .set({ verbleibend: sql`${approvals.verbleibend} - 1` })
      .where(
        and(
          eq(approvals.tool, tool),
          eq(approvals.conversationId, conversationId),
          eq(approvals.geltung, "auftrag"),
          eq(approvals.status, "allowed"),
          gt(approvals.verbleibend, 0),
          gt(approvals.expiresAt, now),
        ),
      )
      .returning();

    if (auftrag) {
      logger.info(
        { tool, approvalId: auftrag.id, verbleibend: auftrag.verbleibend - 1 },
        "Auftragsfreigabe genutzt",
      );
      return { allow: true };
    }
  }

  /*
   * Gibt es eine gültige, noch nicht verbrauchte Freigabe für GENAU diese
   * Argumente?
   *
   * Das UPDATE ist die Prüfung. Vorher wurde erst gelesen und dann geschrieben:
   * zwei gleichzeitige identische Tool-Aufrufe konnten damit beide dieselbe
   * Freigabe sehen, bevor einer sie entwertet hat — die Einmal-Freigabe wäre
   * zweimal eingelöst worden. Hier entscheidet Postgres: nur der Aufruf, der
   * die Zeile tatsächlich von "allowed" auf "used" dreht, bekommt sie zurück.
   * Alle anderen gehen leer aus.
   */
  /*
   * AN DIE UNTERHALTUNG GEBUNDEN, in der sie erteilt wurde.
   *
   * Vorher wurde nur der Argument-Hash verglichen. Eine Freigabe, die Issa im
   * Chat erteilt hat, war damit ueberall einloesbar — auch im autonomen Lauf
   * um drei Uhr nachts oder in einem WhatsApp-Faden mit einem Fremden, sobald
   * dort dieselben Argumente entstanden. Der Hash sagt WAS getan wird, nicht
   * WOFUER jemand ja gesagt hat.
   *
   * Eine Freigabe ohne Unterhaltung (aus einem Hintergrundlauf) bleibt
   * ungebunden — dort gibt es keine, und sie einzufordern hiesse, dass solche
   * Anfragen nie einloesbar waeren.
   */
  const gebunden = (spalte: typeof approvals.conversationId) =>
    conversationId === undefined || conversationId === null
      ? isNull(spalte)
      : or(eq(spalte, conversationId), isNull(spalte));

  const [redeemed] = await db
    .update(approvals)
    .set({ status: "used", decidedAt: now })
    .where(
      and(
        eq(approvals.argumentsHash, hash),
        eq(approvals.status, "allowed"),
        gt(approvals.expiresAt, now),
        gebunden(approvals.conversationId),
      ),
    )
    .returning();

  if (redeemed) {
    logger.info({ tool, approvalId: redeemed.id }, "Freigabe eingelöst");
    return { allow: true };
  }

  // Gibt es eine offene Anfrage für genau diese Argumente?
  const [pending] = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.argumentsHash, hash),
        eq(approvals.status, "pending"),
        gt(approvals.expiresAt, now),
        gebunden(approvals.conversationId),
      ),
    )
    .limit(1);

  /*
   * Bestätigung im laufenden Zug — aber nur als Antwort auf eine bereits
   * gestellte Frage.
   *
   * Vorher genügte irgendein Wort wie "schick" in Issas Nachricht, und der
   * Versand lief los. Das hatte zwei Löcher: "Nein, schick das noch nicht"
   * enthält "schick", und die Zustimmung war an gar nichts gebunden — Lukas
   * konnte danach andere Argumente einsetzen.
   *
   * Jetzt muss eine offene Anfrage für EXAKT diese Argumente existieren. Lukas
   * legt sie beim ersten Versuch an und zeigt Issa, was er senden will; erst
   * Issas eindeutiges "ja, schick ab" im nächsten Zug löst genau diese Anfrage
   * ein. Ändert Lukas ein Zeichen am Text, passt der Hash nicht mehr und die
   * Zustimmung greift nicht.
   *
   * Der geprüfte Text ist Issas eigener, unveränderter Nachrichtentext. Eine
   * Prompt-Injection aus einer gelesenen Mail steht in Tool-Ausgaben, nicht
   * darin — sie kann hier also nichts auslösen.
   */
  if (
    pending &&
    tier === "R2" &&
    darfImChatZustimmen(tool) &&
    rawUserMessage &&
    isAffirmation(rawUserMessage, pending.id)
  ) {
    /*
     * Wie weit die Zustimmung im Chat reicht, haengt vom Werkzeug ab — und der
     * Unterschied ist keine Feinheit.
     *
     * BEI MCP wird daraus eine AUFTRAGSfreigabe. "Ja, mach" bezieht sich auf
     * die Aufgabe, ueber die gerade geredet wird, nicht auf genau diesen einen
     * Aufruf. Wer das anders auslegt, fragt beim zweiten Clip erneut, und Issa
     * hat den Eindruck, seine Antwort sei nicht angekommen.
     *
     * BEI E-MAIL NICHT. "Ja, schick ab" meint DIESEN Entwurf, den Issa gerade
     * gelesen hat — nicht jede Mail der naechsten halben Stunde. Eine Mail ist
     * weg, sobald sie weg ist, und sie landet bei einem Dritten; ein Clip
     * kostet Credits und liegt danach in seinem eigenen Konto.
     *
     * Genau das hat check-consent.mjs beim ersten Anlauf gefangen: die
     * Aenderung haette aus einer Bestaetigung fuer einen Entwurf eine
     * Sammelfreigabe fuer alle Mails gemacht.
     */
    const alsAuftrag = tool === "mcp_call" || tool.startsWith("mcp__");
    const [confirmed] = await db
      .update(approvals)
      .set(
        alsAuftrag
          ? {
              status: "allowed",
              decidedAt: now,
              geltung: "auftrag",
              verbleibend: AUFTRAG_AUFRUFE - 1,
              expiresAt: new Date(now.getTime() + AUFTRAG_MINUTEN * 60 * 1000),
            }
          : { status: "used", decidedAt: now },
      )
      .where(and(eq(approvals.id, pending.id), eq(approvals.status, "pending")))
      .returning();
    if (confirmed) {
      logger.info(
        { tool, approvalId: confirmed.id },
        "Freigabe durch Bestätigung im Chat — gilt für den Auftrag",
      );
      return { allow: true };
    }
  }

  const row =
    pending ??
    (
      await db
        .insert(approvals)
        .values({
          conversationId: conversationId ?? null,
          tool,
          riskTier: tier,
          argumentsHash: hash,
          argumentsPreview: preview(tool, input),
          status: "pending",
          expiresAt: new Date(now.getTime() + APPROVAL_TTL_MINUTES * 60 * 1000),
        })
        .returning()
    )[0];

  logger.info({ tool, tier, approvalId: row.id }, "Freigabe angefordert");

  return {
    allow: false,
    approvalId: row.id,
    message:
      `NICHT ausgeführt — "${tool}" ist als ${tier} eingestuft und braucht Issas ausdrückliche Freigabe. ` +
      `Eine Anfrage (#${row.id}) liegt jetzt im Dashboard unter "Freigaben". ` +
      `Sag Issa, was du vorhast und warum, und bitte ihn, es dort freizugeben. ` +
      `Versuche NICHT, das über ein anderes Tool zu umgehen.`,
  };
}
