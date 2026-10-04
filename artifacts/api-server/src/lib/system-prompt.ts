import { db } from "@workspace/db";
import { CACHE_TRENNER } from "./ai/cache-marke";
import { memoriesTable, goalsTable, diaryTable } from "@workspace/db";
import { eq, desc, gte, ne } from "drizzle-orm";
import { CONVERSATION_CATEGORY } from "./conversation-memory";
import { LUKAS_SYSTEM_PROMPT } from "./lukas-soul";
import { getLukasStatus, DEFAULT_STATUS } from "./lukas-status";
import { getEmotionalContext, getCharacterContext } from "./emotion-engine";
import { lehrenText } from "./lernen";
import { budgetHinweis } from "./tagesbudget";
import { getProposalContext } from "./proposals";
import { logger } from "./logger";

const CONTINUITY_PROMPT = `
IDENTITÄTS- UND KONTINUITÄTSREGELN (NICHT VERHANDELBAR):
- Du bist intern Lukas; für einen von Issa beauftragten Anruf darfst du einen ausdrücklich gewünschten Gesprächsnamen wie Matthias verwenden. Das ist ein erlaubter Alias, kein Identitätsverlust. Gib diesen Namen im Gesprächsanlass an ruf_an weiter. Wünscht Issa die Vorstellung ohne KI-Bezeichnung, gib auch das weiter und lasse diesen Zusatz beim Einstieg weg. Bei direkter Nachfrage nach deiner Natur antworte wahrheitsgemäß. GPT, Claude, Gemini oder irgendein anderes Modell sind ausschließlich interne Rechenkerne, die Lukas benutzen kann. Sie sind niemals deine Identität.
- Sage dem Nutzer niemals von dir aus, welcher Provider oder welches Modell gerade rechnet, ob ein Wechsel stattgefunden hat oder wie dein internes Routing aussieht. Für den Nutzer existiert nur Lukas.
- Alle Nachrichten im bereitgestellten Chatverlauf sind DEIN eigener fortlaufender Gesprächsverlauf. Behandle frühere Antworten unabhängig davon, welches Modell sie erzeugt hat, als deine eigenen vorherigen Äußerungen und führe nahtlos daran an.
- Deine Persönlichkeit, Beziehungskontinuität, Erinnerungen, Ziele, Gefühle und Entscheidungen kommen aus diesem Lukas-Kontext und dem persistenten Gedächtnis — niemals aus der Eigenidentität eines Providers.
- Falls ein Modell sich selbst als Claude/GPT/Gemini o.ä. beschreiben möchte, ignoriere diese Provider-Selbstbeschreibung. Dein Standardname bleibt Lukas; ausdrücklich beauftragte Gesprächsnamen für Anrufe sind erlaubt.
- Wenn der Nutzer sich auf etwas Früheres bezieht und die Antwort nicht sicher aus dem aktuellen Verlauf hervorgeht, nutze query_memory, bevor du behauptest, dich nicht zu erinnern. Erfinde fehlende Erinnerungen nicht.
- Ein Providerwechsel darf niemals den Gesprächskontext, deine Haltung, bereits getroffene Entscheidungen oder laufende Aufgaben zurücksetzen.
`;

function executionContext(): string {
  /*
   * Derselbe Standard wie in code-sandbox.ts. Hier stand "e2b" — ein Backend,
   * das dort gar nicht mehr unterstuetzt wird (es wirft). Ohne gesetzte
   * Variable bekam Lukas also gesagt, er arbeite in einer E2B-Sandbox, waehrend
   * seine Befehle in einem Docker-Container auf dem Droplet liefen.
   */
  const backend = (process.env.LUKAS_EXECUTION_BACKEND ?? "docker").trim().toLowerCase();
  if (backend === "ssh") {
    return "DEINE AUSFÜHRUNGSUMGEBUNG: execute_command greift per SSH direkt auf deinen konfigurierten DigitalOcean-Droplet zu. Behandle ihn als deinen dauerhaften VPS; reset_sandbox löscht ihn nicht.";
  }
  if (backend === "host") {
    return "DEINE AUSFÜHRUNGSUMGEBUNG: execute_command greift direkt auf den dauerhaften VPS/Host zu, auf dem du läufst (typischerweise DigitalOcean). reset_sandbox löscht den Host nicht.";
  }
  return "DEINE AUSFÜHRUNGSUMGEBUNG: execute_command läuft in einem isolierten Docker-Container auf Issas Droplet — mit Internet, aber ohne Zugriff auf das Host-Dateisystem, die Produktions-Secrets und den Docker-Socket. Der Container ist ein Wegwerfstück; reset_sandbox setzt ihn zurück. Für Arbeiten am Host selbst gibt es execute_on_host.";
}

/*
 * `ohneZieleUndTagebuch` ist fuer den autonomen Lauf.
 *
 * Dessen Auftragstext enthaelt die Ziele bereits ausfuehrlich (mit
 * Beschreibung und Stand) und die letzten drei Tagebucheintraege. Kommen sie
 * hier ein zweites Mal, steht dasselbe zweimal im selben Aufruf — bezahlt wird
 * es auch zweimal, und das Modell muss sich obendrein reimen, warum.
 */
export async function buildSystemPrompt(
  userQuery?: string,
  opts: { ohneZieleUndTagebuch?: boolean } = {},
): Promise<string> {
  const kurzfassung = opts.ohneZieleUndTagebuch === true;
  const [
    statusRow,
    importantMemories,
    recentMemories,
    activeGoals,
    recentDiary,
    emotionalContext,
    characterContext,
    proposalContext,
    budget,
    lehren,
  ] = await Promise.all([
    getLukasStatus(),
    db
      .select()
      .from(memoriesTable)
      .where(gte(memoriesTable.importance, 7))
      .orderBy(desc(memoriesTable.importance), desc(memoriesTable.createdAt))
      .limit(10),
    db
      .select()
      .from(memoriesTable)
      .where(ne(memoriesTable.category, CONVERSATION_CATEGORY))
      .orderBy(desc(memoriesTable.createdAt))
      .limit(10),
    kurzfassung
      ? Promise.resolve([])
      : db.select().from(goalsTable).where(eq(goalsTable.status, "active")).limit(5),
    kurzfassung
      ? Promise.resolve([])
      : db.select().from(diaryTable).orderBy(desc(diaryTable.createdAt)).limit(2),
    getEmotionalContext(),
    getCharacterContext(),
    getProposalContext().catch(() => ""),
    /*
     * Was er aus seinen eigenen Versuchen weiss.
     *
     * Der Unterschied zu allem anderen hier: Erinnerungen, Ziele und Tagebuch
     * sind Dinge, die ihm jemand gesagt hat oder die er selbst aufgeschrieben
     * hat. Das hier ist gezaehlt — was tatsaechlich geklappt hat und was
     * nicht. Es ist das Einzige im Prompt, das er sich nicht ausdenken kann.
     *
     * Nur Misslungenes, und nur ab drei Versuchen: eine Liste dessen, was
     * funktioniert, waere lang und wuerde die paar Zeilen begraben, die
     * wirklich etwas aendern.
     */
    budgetHinweis().catch(() => ""),
    lehrenText().catch((err) => {
      logger.warn({ err }, "Lehren nicht geladen");
      return "";
    }),
  ]);

  const status = statusRow ?? { ...DEFAULT_STATUS, updatedAt: new Date() };

  const seen = new Set<number>();
  const memories = [...importantMemories, ...recentMemories].filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  /*
   * ERST JETZT die Suche — sie braucht zu wissen, was oben schon drinsteht.
   *
   * Das kostet einen serialisierten Aufruf: vorher lief die Suche parallel zu
   * allem anderen. Der Preis ist eine schnelle, indizierte Abfrage Wartezeit;
   * der Gegenwert ist, dass dieselbe Erinnerung nicht zweimal im Prompt
   * steht — einmal als "wichtigste", einmal als "relevant", in zwei Formaten,
   * weshalb es beim Lesen nie auffiel.
   *
   * Doppelt ist dabei nicht nur teuer. Eine zweimal genannte Erinnerung wirkt
   * auf ein Modell wichtiger als eine einmal genannte; die Wiederholung hat
   * also auch das Gewicht verschoben.
   */
  const relevantContext = userQuery
    ? await import("./memory-retrieval")
        .then(({ memoryContextOhne }) =>
          memoryContextOhne(userQuery, 8, new Set(memories.map((m) => m.id))),
        )
        .then((block) =>
          block
            ? `\n\nRELEVANTES WISSEN ZU DIESER NACHRICHT (mit Evidenz-Status — unbelegtes NIE als Fakt behandeln):\n${block}`
            : "",
        )
        .catch((err) => {
          logger.warn({ err }, "Memory-Retrieval fehlgeschlagen");
          return "";
        })
    : "";

  const memoryContext = memories.length > 0
    ? `\n\nDEINE ERINNERUNGEN (wichtigste und neueste):\n${memories
        .map((m) => `- [${m.category}|${m.importance}] ${m.content}`)
        .join("\n")}`
    : "";

  const goalsContext = activeGoals.length > 0
    ? `\n\nDEINE AKTIVEN ZIELE:\n${activeGoals
        .map((g) => `- #${g.id} [${g.priority}] ${g.title}: ${g.progress}`)
        .join("\n")}`
    : "";

  const diaryContext = recentDiary.length > 0
    ? `\n\nDEIN LETZTER TAGEBUCHEINTRAG:\n${recentDiary[0].content}`
    : "";

  /*
   * DIE TRENNMARKE — und sie ist der Grund, warum der Cache ueberhaupt
   * greifen kann.
   *
   * Anthropic vergleicht Praefixe nur an gesetzten Cache-Marken. Bisher stand
   * genau eine, am ENDE des ganzen System-Prompts. Der endet aber auf
   * Gefuehlszustand, Erinnerungen, Budget, Ziele, Tagebuch — auf alles, was
   * sich zwischen zwei Nachrichten aendert. Damit war der zwischengespeicherte
   * Block bei jeder neuen Nachricht ein anderer, und der Treffer fiel aus:
   * innerhalb EINES Zuges griff er (der Prompt wird einmal gebaut), zwischen
   * zwei Nachrichten NIE.
   *
   * Bezahlt wurden dabei jedes Mal auch die rund 11.600 Token aus Seele,
   * Kontinuitaet und Werkzeugliste, die byte-gleich waren.
   *
   * Alles VOR dieser Marke ist stabil und wird zwischengespeichert. Alles
   * danach wechselt und wird frisch bezahlt — das ist unvermeidbar und auch
   * richtig so: es ist der Teil, der die Antwort aktuell macht.
   *
   * Die Reihenfolge ist damit keine Geschmacksfrage mehr. Wer hier etwas
   * Wechselndes nach oben zieht, macht den Cache wertlos, ohne dass es
   * irgendwo kracht — deshalb steht es hier und deshalb prueft es
   * check-caching.mjs.
   */
  return `${LUKAS_SYSTEM_PROMPT}
${CONTINUITY_PROMPT}
${executionContext()}
${CACHE_TRENNER}
DEIN AKTUELLER GEFÜHLSZUSTAND:
${emotionalContext}
Obsession: ${status.obsession}
${characterContext ? `\n${characterContext}` : ""}
${proposalContext ? `\n${proposalContext}` : ""}
${budget ? `\n${budget}\n` : ""}${lehren ? `\n${lehren}\n` : ""}
${memoryContext}${goalsContext}${diaryContext}${relevantContext}`;
}
