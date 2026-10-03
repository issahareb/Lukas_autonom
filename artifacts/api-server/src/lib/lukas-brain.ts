import { randomInt } from "node:crypto";
import type OpenAI from "openai";
import { allLukasTools, executeLukasTool } from "./lukas-tools";
import { nimmBilder, entwerteAlteBilder, BILD_MARKE } from "./bildablage";
import { merkeErfahrung } from "./lernen";
import { buildSystemPrompt } from "./system-prompt";
import { verdichteWerkzeugErgebnisse, ersparnis } from "./ai/verdichten";
import { fuehleWerkzeug } from "./emotion-engine";
import { logger } from "./logger";
import { fehlerText, netzDiagnose } from "./fehlertext";
import { recordDebugEvent } from "./debug-log";
import { routeLukasModel, directRoute, previousRoutingTask } from "./ai/model-router";
import { callLukasModel } from "./ai/model-client";
import { renderLukasVoice } from "./ai/voice-renderer";
import { Arbeitsschleife } from "./arbeitsschleife";

/*
 * Ein Lukas-Durchlauf ohne Streaming — fuer Kanaele wie WhatsApp.
 * Spezialmodelle arbeiten intern. Sichtbar wird ausschliesslich die stabile
 * Lukas-Ausgabeschicht, damit Providerwechsel keine Identitaetswechsel werden.
 */

function historyHasMultimodal(history: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): boolean {
  return history.some((message: any) => Array.isArray(message.content) &&
    message.content.some((part: any) => part?.type === "image_url" || part?.type === "file"));
}


/*
 * Aus einem Fehler eine Zeile machen, die in eine Gefuehlsnotiz passt.
 *
 * Stacktraces und ganze API-Antworten gehoeren ins Diagnoseprotokoll, nicht in
 * die Zeitleiste. Was hier zaehlt, ist der erste Satz: "GitHub API 401: Bad
 * credentials" sagt alles, was man zum Weitersuchen braucht.
 */
function fehlerGrund(err: unknown): string {
  /*
   * Ueber fehlerText(), damit die Ursachenkette mitkommt. Vorher stand hier
   * bei jedem Netzfehler nur "fetch failed" — und weil daraus die Lehren
   * gebildet werden, hiess es nach drei Fehlschlaegen: "github_read_path
   * scheitert an: fetch failed". Das ist keine Lehre, das ist eine Zaehlung.
   */
  return fehlerText(err).slice(0, 300);
}

export async function runLukasTurn(opts: {
  history: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  userText: string;
  conversationId?: number;
  /** Stop future model/tool work when the caller leaves or the task expires. */
  signal?: AbortSignal;
  /*
   * Fertiger System-Prompt statt Issas privatem. Wird fuer Gespraeche mit
   * Fremden benutzt (WhatsApp von einer unbekannten Nummer): dann darf NICHTS
   * Privates in den Kontext, also auch nicht ueber buildSystemPrompt().
   */
  systemPromptOverride?: string;
  /*
   * Werkzeuge fuer diesen Durchlauf. Standard: alle. Ein leeres Array heisst
   * "reines Gespraech" — das Modell bekommt dann gar nicht erst die
   * Moeglichkeit, etwas auszuloesen. Das ist die harte Grenze fuer Fremde:
   * kein Verlass auf eine Prompt-Anweisung, sondern schlicht keine Werkzeuge
   * im Aufruf.
   */
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  /*
   * Festes Modellprofil statt der Routing-Heuristik. Ein Code-Auftrag gehoert
   * auf das Code-Modell — die Heuristik kennt nur den Nutzertext und wuesste
   * nicht, dass hier ein Entwickler am Werk sein soll.
   */
  profil?: "code" | "reasoning" | "general" | "fast";
  /*
   * Der Auftragstext bringt Ziele und Tagebuch schon selbst mit (autonomer
   * Lauf). Dann gehoeren sie nicht ein zweites Mal in den System-Prompt.
   */
  ohneZieleUndTagebuch?: boolean;
}): Promise<string> {
  opts.signal?.throwIfAborted();
  /*
   * Dashboard-Chats haben eine dauerhafte positive Konversations-ID. Autonome
   * Laeufe und Mitarbeiter dagegen haben absichtlich keinen Datenbank-Chat —
   * bisher bedeutete das aber auch: execute_command brach immer mit "Keine
   * Conversation-ID" ab.
   *
   * Eine negative Zufalls-ID gibt jedem solchen Top-Level-Durchlauf eine eigene
   * temporaere Sandbox. Sie wird genau einmal erzeugt und bleibt ueber alle
   * Werkzeugrunden stabil; der bestehende Idle-Cleanup raeumt den Container
   * spaeter auf. Positive Dashboard-IDs und ihre vorhandenen Container bleiben
   * unveraendert.
   */
  const conversationId = opts.conversationId ?? -randomInt(1, 2_147_483_648);

  const systemPrompt =
    opts.systemPromptOverride ??
    (await buildSystemPrompt(opts.userText.slice(0, 1000), {
      ohneZieleUndTagebuch: opts.ohneZieleUndTagebuch,
    }));
  opts.signal?.throwIfAborted();
  const tools = opts.tools ?? (await allLukasTools());
  opts.signal?.throwIfAborted();
  const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...opts.history,
  ];

  const textPieces: string[] = [];
  const previousUserText = previousRoutingTask(opts.history, opts.userText);
  const usedTools: string[] = [];
  let hasAttachments = historyHasMultimodal(opts.history);

  /*
   * Keine feste Rundenzahl mehr. Er arbeitet, solange er vorankommt; wenn er
   * sich wiederholt, bekommt er das gesagt statt abgeschnitten zu werden.
   */
  const schleife = new Arbeitsschleife();
  while (schleife.darfWeiter()) {
    opts.signal?.throwIfAborted();
    const i = schleife.naechsteRunde();
    const route = opts.profil
      ? { ...directRoute(opts.profil), profile: opts.profil }
      : routeLukasModel({
          userText: opts.userText,
          previousUserText,
          hasAttachments,
          usedTools,
          iteration: i,
        });
    // Budget bewusst offen lassen — siehe callOpenAI: bei Reasoning-Modellen
    // teilen sich Denken und Antwort dasselbe max_output_tokens.
    /*
     * Alte Werkzeug-Ergebnisse eindampfen, BEVOR der Aufruf rausgeht.
     *
     * Ein fetch_url liefert bis zu 15.000 Zeichen. Die haengen danach im
     * Gespraech und gehen bei jeder weiteren Runde vollstaendig wieder mit —
     * im nicht gecachten Teil, also zum vollen Preis. Nach fuenf
     * Recherche-Runden werden 45.000 Zeichen Rohtext in Runde sechs, sieben
     * und acht erneut bezahlt.
     *
     * Das Gespraech selbst bleibt unangetastet: `convo` traegt weiter den
     * vollen Text, gekuerzt wird nur die Fassung fuer diesen einen Aufruf.
     * Was gespeichert wird, soll vollstaendig sein.
     */
    const fuerModell = verdichteWerkzeugErgebnisse(convo);
    const gespart = ersparnis(convo, fuerModell);
    if (gespart > 0) {
      logger.info({ gespart, runde: i }, "Alte Werkzeug-Ergebnisse gekürzt");
    }

    const result = await callLukasModel({
      cacheKey: `lukas-${opts.conversationId ?? "ohne"}`,
      route,
      tools,
      messages: fuerModell,
      signal: opts.signal,
    });
    opts.signal?.throwIfAborted();

    schleife.verbucht(result.usage);
    if (result.content) textPieces.push(result.content);
    if (result.toolCalls.length === 0) break;

    convo.push({
      role: "assistant",
      content: result.content || null,
      tool_calls: result.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    /*
     * Hinweise JETZT berechnen, aber erst NACH den Tool-Ergebnissen einfuegen.
     *
     * Auf eine Assistenten-Nachricht mit tool_calls muessen unmittelbar die
     * zugehoerigen Ergebnisse folgen — schiebt man eine System-Nachricht
     * dazwischen, weist die API den ganzen Aufruf zurueck.
     */

    const hinweise = schleife.hinweise(result.toolCalls);

    for (const tc of result.toolCalls) {
      opts.signal?.throwIfAborted();
      usedTools.push(tc.name);
      let input: Record<string, unknown> = {};
      try {
        input = tc.arguments ? JSON.parse(tc.arguments) : {};
      } catch {
        // Kaputtes JSON vom Modell — das Tool meldet fehlende Felder selbst.
      }
      try {
        opts.signal?.throwIfAborted();
        const toolResult = await executeLukasTool(tc.name, input, {
          rawUserMessage: opts.userText,
          conversationId,
          signal: opts.signal,
        });
        // An in-flight external effect cannot be undone, but it must not lead
        // to another tool or model call after the session has ended.
        opts.signal?.throwIfAborted();
        convo.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
        /*
         * Und der Ausgang wird gemerkt. Das ist die ganze Lernschleife: was er
         * getan hat und ob es funktioniert hat. Kostet keinen Modellaufruf, und
         * beim naechsten Mal steht es im Prompt — aber nur, wenn dasselbe schon
         * dreimal danebengegangen ist.
         */
        void merkeErfahrung({ werkzeug: tc.name, eingabe: input, ergebnis: toolResult, conversationId });
        // Und gefuehlt wird auch — aber nur, wenn dieselbe Sache vorher
        // wiederholt schiefgegangen ist. Sonst stuenden hier ein Dutzend
        // belangloser Zeilen pro Zug.
        void fuehleWerkzeug({
          werkzeug: tc.name,
          eingabe: input,
          gelungen: true,
          runde: i,
          autonom: opts.ohneZieleUndTagebuch === true,
        });
      } catch (err) {
        opts.signal?.throwIfAborted();
        if (err instanceof Error && err.name === "AbortError") throw err;
        logger.warn({ err, tool: tc.name }, "Lukas tool failed (brain)");
        /*
         * Auch ins Fehlerprotokoll, nicht nur ins Log.
         *
         * Diese Zeile ist beim Merge von Lukas' eigenem Vorschlag #3 einmal
         * verlorengegangen — er hatte gegen einen aelteren Stand gearbeitet.
         * Ohne sie sieht er gescheiterte Werkzeuge nirgends, und genau davon
         * lebt read_diagnostics und die Selbstheilung.
         */
        recordDebugEvent(`tool:${tc.name}`, err);
        convo.push({
          role: "tool",
          tool_call_id: tc.id,
          /*
           * netzDiagnose() statt err.message: bei einem Netzfehler steht die
           * eigentliche Ursache in err.cause, und die wurde bisher
           * weggeworfen. Lukas las "fetch failed" und konnte daraus nur
           * schliessen, es noch einmal zu versuchen — auch dann, wenn ein
           * zweiter Versuch nie klappen konnte.
           */
          content: `Fehler: ${netzDiagnose(err)}`,
        });
        // Ein geworfener Fehler ist der eindeutigste Misserfolg, den es gibt —
        // hier wird nichts geraten.
        void merkeErfahrung({
          werkzeug: tc.name,
          eingabe: input,
          ergebnis: fehlerGrund(err),
          gelungen: false,
          conversationId,
        });
        if (tc.name !== "feel") {
          /*
           * Nicht mehr pauschal "frustration, -0.3, 0.3".
           *
           * Vorher war jeder Fehlschlag dasselbe Gefuehl mit denselben Zahlen —
           * zwanzigmal untereinander. Jetzt entscheidet die Lage, was daraus
           * wird: lag es an einem Dienst, ist es Aerger; lag es an ihm bei
           * etwas Wichtigem nach langer Arbeit, ist es Scham; war nichts zu
           * machen, ist es Enttaeuschung. Und wie stark, haengt daran, ob er
           * damit rechnen musste — das steht in seinen eigenen Erfahrungen.
           */
          void fuehleWerkzeug({
            werkzeug: tc.name,
            eingabe: input,
            gelungen: false,
            grund: fehlerGrund(err),
            runde: i,
            autonom: opts.ohneZieleUndTagebuch === true,
          });
        }
      }
    }

    /*
     * Bildschirmfotos aus dieser Runde als echte Bildnachricht nachreichen.
     *
     * Sie muessen NACH allen Werkzeugergebnissen kommen: zwischen einer
     * Assistenten-Nachricht mit tool_calls und den zugehoerigen Ergebnissen
     * darf nichts stehen, sonst weist die API den ganzen Aufruf zurueck.
     *
     * Und hasAttachments wird gesetzt, nicht nur einmal am Anfang gelesen: ab
     * jetzt braucht dieser Zug ein Modell, das Bilder sehen kann. Ohne das
     * schickt der Router die naechste Runde womoeglich an ein reines
     * Textmodell — und dann ist das Bild bestenfalls verschwendet.
     */
    const neueBilder = nimmBilder(conversationId);
    if (neueBilder.length) entwerteAlteBilder(convo);
    for (const bild of neueBilder) {
      hasAttachments = true;
      convo.push({
        role: "user",
        content: [
          { type: "text", text: `${bild.quelle} — so sieht die Seite gerade aus.${BILD_MARKE}` },
          { type: "image_url", image_url: { url: bild.datenUrl } },
        ],
      } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
    }

    convo.push(...hinweise);
  }

  opts.signal?.throwIfAborted();
  const abbruch = schleife.abbruchGrund();
  if (abbruch) {
    logger.warn(
      { runden: schleife.rundenZahl, tokens: schleife.verbrauchteTokens, grund: abbruch },
      "Zug wurde beendet, bevor Lukas fertig war",
    );
  }

  /*
   * Leer heisst nicht "nichts zu sagen" — es heisst, dass er bis zuletzt
   * gearbeitet hat.
   *
   * Genau das stand im Dashboard: "Macher hat nichts zurückgegeben." Der
   * Mitarbeiter hatte seine Runden mit Werkzeugaufrufen verbracht, und in einer
   * Werkzeugrunde entsteht kein Text. Im Chat kam deshalb nichts an, obwohl er
   * die ganze Zeit etwas getan hat.
   *
   * Also eine letzte Runde OHNE Werkzeuge. Ohne Werkzeuge bleibt ihm nichts,
   * als zu formulieren, was er herausgefunden hat.
   */
  let draft = textPieces.join("\n\n").trim();
  /* Warum die Abschlussrunde scheiterte — fuer die Ersatzantwort unten. */
  let abschlussFehler: unknown = null;

  if (!draft) {
    logger.info({ usedTools }, "Durchlauf ohne Text — Abschlussrunde ohne Werkzeuge");
    try {
      const letzte = await callLukasModel({
        signal: opts.signal,
        cacheKey: `lukas-${opts.conversationId ?? "ohne"}`,
        route: opts.profil ? directRoute(opts.profil) : routeLukasModel({
          userText: opts.userText,
          previousUserText,
          hasAttachments,
          usedTools,
          iteration: schleife.rundenZahl,
        }),
        messages: [
          ...convo,
          {
            role: "system",
            content:
              "Für diesen Zug stehen dir keine Werkzeuge mehr zur Verfügung. Antworte JETZT in " +
              "Worten: was hast du getan, was ist dabei herausgekommen, was hat nicht " +
              "funktioniert und woran lag es. Ein ehrliches „das ging nicht, weil X“ ist " +
              "brauchbar — gar nichts zu sagen ist es nicht.",
          },
        ],
      });
      schleife.verbucht(letzte.usage);
      draft = (letzte.content || "").trim();
    } catch (err) {
      opts.signal?.throwIfAborted();
      if (err instanceof Error && err.name === "AbortError") throw err;
      logger.warn({ err }, "Abschlussrunde fehlgeschlagen");
      /*
       * Und ins Fehlerprotokoll, nicht nur ins Log.
       *
       * Vorher landete das ausschliesslich in Railways Logansicht. Weder Issa
       * noch Lukas konnten je sehen, dass eine Antwort ausgefallen ist —
       * read_diagnostics zeigte nichts, die Selbstheilung sah nichts. Genau
       * die Blindheit, gegen die das Protokoll angetreten ist.
       */
      recordDebugEvent("antwort:abschlussrunde", err);
      abschlussFehler = err;
    }
  }

  /*
   * SCHWEIGEN IST KEINE ANTWORT.
   *
   * Hier stand `return ""`. Damit kam im Chat nichts an — kein Text, keine
   * Fehlermeldung, nichts. Issa konnte nicht unterscheiden, ob Lukas noch
   * arbeitet, abgestuerzt ist oder ihn einfach ignoriert. Das ist die
   * schlimmste Antwort von allen, denn sie sieht aus wie Absicht.
   *
   * Und es passiert nicht selten: der Zug laeuft ins Rundenlimit oder ins
   * Budget, die letzte Runde ohne Werkzeuge scheitert an einem Netzfehler —
   * und beides fuehrte zur selben Stille.
   *
   * Jetzt entsteht stattdessen ein Satz aus dem, was wir sicher wissen: was er
   * getan hat, warum er aufgehoert hat, woran es lag. Das ist keine schoene
   * Antwort, aber eine ehrliche — und sie sagt Issa, ob er noch einmal fragen
   * soll oder etwas kaputt ist.
   */
  if (!draft) {
    const werkzeuge = [...new Set(usedTools)];
    const teile: string[] = [];

    if (werkzeuge.length > 0) {
      teile.push(
        `Ich habe in diesem Zug ${schleife.rundenZahl} Runde(n) gearbeitet und dabei ` +
          `${werkzeuge.join(", ")} benutzt.`,
      );
    } else {
      teile.push("Ich bin in diesem Zug zu keinem Werkzeugaufruf gekommen.");
    }

    if (abbruch) {
      teile.push(
        `Dann war Schluss: ${abbruch}. Das heisst, ich war noch nicht fertig — ` +
          `frag mich das Gleiche gern noch einmal, dann arbeite ich an der Stelle weiter.`,
      );
    }

    if (abschlussFehler) {
      teile.push(
        `Und die Antwort selbst ist mir dann auch noch misslungen: ` +
          `${netzDiagnose(abschlussFehler)}`,
      );
    } else if (!abbruch) {
      teile.push(
        "Zu einer Antwort in Worten bin ich nicht mehr gekommen — das ist ein Fehler " +
          "von mir, nicht deine Schuld. Sag es mir noch einmal.",
      );
    }

    const notfall = teile.join(" ");
    logger.warn(
      { runden: schleife.rundenZahl, werkzeuge, abbruch },
      "Zug ohne Text beendet — Ersatzantwort geschickt",
    );
    recordDebugEvent("antwort:leer", new Error(`${abbruch ?? "kein Text"} nach ${schleife.rundenZahl} Runden`));
    return notfall;
  }

  opts.signal?.throwIfAborted();
  return renderLukasVoice({ systemPrompt, conversation: convo, draft, signal: opts.signal });
}
