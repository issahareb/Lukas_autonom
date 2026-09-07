import { Router } from "express";
import type OpenAI from "openai";
import { db } from "@workspace/db";
import { conversations, messages, attachments as attachmentsTable } from "@workspace/db";
import { eq, desc, asc, and, isNull } from "drizzle-orm";
import { allLukasTools, executeLukasTool } from "../lib/lukas-tools";
import { nimmBilder, entwerteAlteBilder, BILD_MARKE } from "../lib/bildablage";
import { merkeErfahrung } from "../lib/lernen";
import { fuehleWerkzeug } from "../lib/emotion-engine";
import { maybeReflect } from "../lib/reflection";
import { buildSystemPrompt } from "../lib/system-prompt";
import { logger } from "../lib/logger";
import { recordDebugEvent } from "../lib/debug-log";
import { attachmentKind } from "./attachments";
import { extractVideoFrames } from "../lib/video-frames";
import { rememberAssistantMessage, rememberUserMessage } from "../lib/conversation-memory";
import { routeLukasModel } from "../lib/ai/model-router";
import { callLukasModel } from "../lib/ai/model-client";
import { renderLukasVoice } from "../lib/ai/voice-renderer";
import type { ToolStep } from "@workspace/db";
import type { Response } from "express";
import { Arbeitsschleife } from "../lib/arbeitsschleife";
import { imZug } from "../lib/zug";

const router = Router();

/*
 * Wer hat wirklich gestoppt?
 *
 * Ein geschlossener Socket sagt das NICHT. Der Stopp-Knopf schliesst ihn, ein
 * Mobilfunkloch aber auch, genauso ein zugegangener Bildschirm oder ein
 * Railway-Deploy mitten im Zug. Solange beides gleich behandelt wurde, hat
 * jedes Funkloch minutenlange Arbeit weggeworfen.
 *
 * Deshalb ein ausdrueckliches Signal: der Knopf ruft eine eigene Route auf.
 * Nur was hier drinsteht, ist ein Stopp.
 */
const stoppWuensche = new Set<number>();

/*
 * Welche Zuege gerade wirklich laufen.
 *
 * Der Client kann das von sich aus nicht wissen. Faellt seine Leitung weg —
 * Tab gewechselt, Bildschirm zu, Funkloch — sieht "der Server arbeitet noch"
 * genauso aus wie "der Server ist fertig und die Antwort ging verloren".
 * Bisher hat er deshalb geraten: zwei Minuten nachfragen, dann aufgeben. Ein
 * Zug, der ein Dutzend Dateien liest, braucht laenger als zwei Minuten — und
 * genau dann stand da "Lad die Seite neu", obwohl Lukas noch am Arbeiten war.
 *
 * Mit dieser Auskunft muss niemand mehr raten.
 *
 * Bewusst im Speicher und nicht in der Datenbank: die Frage lautet "arbeitet
 * DIESER Prozess gerade daran", und die beantwortet ein Neustart ohnehin mit
 * nein — dann laeuft der Zug naemlich wirklich nicht mehr.
 */
const laufendeZuege = new Map<number, number>();

router.post("/anthropic/conversations/:id/stop", (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isFinite(id)) return void res.status(400).json({ error: "id ungültig" });
  stoppWuensche.add(id);
  logger.info({ conversationId: id }, "Stopp von Issa");
  res.json({ ok: true });
});


/*
 * Ein Arbeitsschritt, wie ihn Issa sehen soll.
 *
 * Bisher lief im Chat nur "[⚙ execute_command]" durch — der Name des
 * Werkzeugs und sonst nichts. Welchen Befehl Lukas abgesetzt hat, was er einen
 * Subagenten gefragt hat und was zurueckkam, war nirgends sichtbar.
 *
 * Gekuerzt wird bewusst grosszuegig: ein Werkzeugergebnis kann eine ganze
 * Webseite sein, und die gehoert weder in die Leitung noch in die Datenbank.
 * 4000 Zeichen reichen, um zu verstehen, was passiert ist.
 */
const SCHRITT_MAX = 4000;

/** Erste Zeile eines Fehlers, kurz genug fuer eine Gefuehlsnotiz. */
function kuerzeGrund(text: string): string {
  return text.split("\n")[0].slice(0, 200);
}

function kuerze(text: string): string {
  return text.length > SCHRITT_MAX
    ? `${text.slice(0, SCHRITT_MAX)}\n\n[… ${text.length - SCHRITT_MAX} weitere Zeichen]`
    : text;
}

function zeigeSchritt(
  tool: string,
  input: Record<string, unknown>,
  result: string,
  ok: boolean,
  ms: number,
  sende: (nutzlast: unknown) => void,
): ToolStep {
  const schritt: ToolStep = {
    tool,
    input: kuerze(JSON.stringify(input, null, 2)),
    result: kuerze(result),
    ok,
    ms,
  };
  // Sofort raus, damit man beim Zuschauen schon sieht, was er gerade getan hat.
  sende({ step: schritt });
  return schritt;
}

router.get("/anthropic/conversations", async (_req, res) => {
  try {
    const rows = await db.select().from(conversations).orderBy(desc(conversations.createdAt));
    res.json(rows.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })));
  } catch {
    res.status(500).json({ error: "Failed to get conversations" });
  }
});

router.post("/anthropic/conversations", async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return void res.status(400).json({ error: "title required" });
    const [row] = await db.insert(conversations).values({ title }).returning();
    res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch {
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

router.get("/anthropic/conversations/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) return void res.status(404).json({ error: "Conversation not found" });
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));
    const seit = laufendeZuege.get(id);
    res.json({
      ...conv,
      createdAt: conv.createdAt.toISOString(),
      messages: msgs.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
      // Damit die Oberflaeche weiterfragen kann, statt nach zwei Minuten
      // aufzugeben, waehrend Lukas noch arbeitet.
      laeuft: seit !== undefined,
      laeuftSeit: seit !== undefined ? new Date(seit).toISOString() : null,
    });
  } catch {
    res.status(500).json({ error: "Failed to get conversation" });
  }
});

router.delete("/anthropic/conversations/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) return void res.status(404).json({ error: "Conversation not found" });
    await db.delete(conversations).where(eq(conversations.id, id));
    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

router.get("/anthropic/conversations/:id/messages", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));
    res.json(msgs.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })));
  } catch {
    res.status(500).json({ error: "Failed to get messages" });
  }
});

type AttachmentRow = typeof attachmentsTable.$inferSelect;

async function buildAttachmentParts(
  rows: AttachmentRow[],
  text: string,
): Promise<OpenAI.Chat.Completions.ChatCompletionContentPart[]> {
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  if (text.trim()) parts.push({ type: "text", text });

  for (const row of rows) {
    const kind = attachmentKind(row.mimeType, row.filename);
    if (kind === "image") {
      parts.push({ type: "image_url", image_url: { url: `data:${row.mimeType};base64,${row.data}` } });
    } else if (kind === "pdf") {
      parts.push({
        type: "file",
        file: { filename: row.filename, file_data: `data:${row.mimeType};base64,${row.data}` },
      });
    } else if (kind === "text") {
      const decoded = Buffer.from(row.data, "base64").toString("utf-8");
      const clipped = decoded.length > 30000 ? decoded.slice(0, 30000) + "\n\n[... gekürzt]" : decoded;
      parts.push({ type: "text", text: `Datei "${row.filename}":\n\n${clipped}` });
    } else if (kind === "video") {
      const extracted = await extractVideoFrames(row.data, row.filename);
      if (extracted.ok) {
        const duration = extracted.durationSeconds
          ? `${extracted.durationSeconds.toFixed(1)} Sekunden`
          : "unbekannter Länge";
        parts.push({
          type: "text",
          text:
            `[Video "${row.filename}" (${duration}): daraus ${extracted.frames.length} gleichmäßig ` +
            `verteilte Standbilder in zeitlicher Reihenfolge. Du siehst KEIN durchgehendes Video ` +
            `und hörst KEINEN Ton — zwischen zwei Bildern kann etwas passieren, das du nicht ` +
            `siehst. Beschreibe nur, was tatsächlich zu sehen ist.]`,
        });
        for (const frame of extracted.frames) {
          parts.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${frame}` } });
        }
      } else {
        // Der konkrete Grund gehoert hier hin, nicht nur ins Log: sonst steht
        // Lukas im Chat da und spekuliert ueber Dateipfade und Berechtigungen,
        // statt zu sagen, was wirklich kaputt ist.
        parts.push({
          type: "text",
          text:
            `[Video "${row.filename}" (${Math.round(row.sizeBytes / 1024)} KB) wurde angehängt, ` +
            `aber die Einzelbild-Extraktion ist fehlgeschlagen. Grund: ${extracted.reason} ` +
            `Du kannst das Video nicht auswerten — nenne Issa genau diesen Grund, erfinde ` +
            `keinen Inhalt und spekuliere nicht über Dateipfade oder Berechtigungen. ` +
            `Das ist ein Serverproblem, kein Problem mit seiner Datei.]`,
        });
      }
    } else {
      parts.push({
        type: "text",
        text:
          `[Datei "${row.filename}" (${row.mimeType}, ${Math.round(row.sizeBytes / 1024)} KB) ` +
          `wurde angehängt, dieses Format kannst du nicht lesen. Sag das ehrlich.]`,
      });
    }
  }
  return parts;
}

// Der alte /anthropic-Pfad bleibt aus Kompatibilitaetsgruenden bestehen. Intern
// ist er providerunabhaengig. Spezialmodell-Ausgaben werden NICHT direkt an die
// UI gestreamt; sichtbar ist nur die einheitliche Lukas-Ausgabeschicht.
/*
 * Der Chat laeuft unter der Herkunft "chat" und OHNE Deckel.
 *
 * Beides mit Absicht. Die Herkunft, damit in der Buchhaltung steht, was
 * wirklich Issas Fragen gekostet haben — an dem Tag mit 4,2 Millionen Tokens
 * war genau das die unbeantwortbare Frage. Kein Deckel, weil das hier Issa
 * ist: gedeckelt wird, was ohne Aufsicht laeuft, nicht das Gespraech.
 */
router.post("/anthropic/conversations/:id/messages", async (req, res) =>
  imZug({ herkunft: "chat", istIssa: true }, async () => {
  /*
   * Lebenszeichen auf der Leitung.
   *
   * Das war der Grund, warum Lukas sporadisch gar nicht geantwortet hat. Auf
   * dieser Route wird die Antwort NICHT tokenweise gestreamt — sie geht am Ende
   * in einem Stueck raus. Zwischen dem letzten Werkzeug und der fertigen Antwort
   * fliesst also minutenlang kein einziges Byte. Jeder Proxy davor (Cloudflare
   * kappt bei rund 100 Sekunden Stille) haelt die Verbindung fuer tot und
   * schliesst sie. Im Chat kam dann nichts an, und weil erst am Ende in die
   * Datenbank geschrieben wird, war die Antwort auch nach dem Neuladen weg.
   *
   * Kurze Antworten kamen durch, lange nicht — genau das "sporadisch".
   *
   * Ein SSE-Kommentar alle 10 Sekunden haelt die Leitung offen. Der Browser
   * ignoriert Zeilen, die mit ":" beginnen.
   */
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let laufendeId: number | null = null;
  try {
    const convId = parseInt(req.params.id);
    const { content } = req.body;
    if (!content) return void res.status(400).json({ error: "content required" });

    const [conv] = await db.select().from(conversations).where(eq(conversations.id, convId));
    if (!conv) return void res.status(404).json({ error: "Conversation not found" });

    // Ab hier arbeitet er — und zwar unabhaengig davon, ob die Leitung haelt.
    laufendeId = convId;
    laufendeZuege.set(convId, Date.now());

    /*
     * Ab hier ist die Leitung offen — und zwar SOFORT.
     *
     * Vorher standen zwischen der Anfrage und dieser Stelle fuenf await:
     * Nachricht speichern, Anhaenge zuordnen, Systemprompt bauen (das holt
     * Erinnerungen aus der Datenbank), Verlauf laden, und bei einem Video sogar
     * ffmpeg. Waehrend dieser ganzen Zeit ging kein einziges Byte raus — keine
     * Kopfzeilen, kein Lebenszeichen. Der Browser sass da und wartete, und wenn
     * das Netz in dem Moment wackelte, war die Verbindung weg, bevor sie
     * ueberhaupt richtig stand.
     *
     * Deshalb: Kopfzeilen raus und Heartbeat starten, BEVOR die Vorarbeit
     * beginnt.
     */
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    // Nginx und Verwandte puffern text/event-stream sonst und geben erst am
    // Ende alles auf einmal frei — dann nuetzt auch der Heartbeat nichts.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    /*
     * Node bringt einen eigenen Wecker mit: server.requestTimeout steht
     * standardmaessig auf 5 Minuten und kappt die Verbindung danach — egal wie
     * fleissig gerade gearbeitet wird. Fuer einen Agenten, der recherchiert und
     * baut, ist das keine Ausnahme, sondern der Normalfall. Fuer DIESE Route
     * also aus.
     */
    req.setTimeout(0);
    res.setTimeout(0);

    heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, 10000);

    const [userMessage] = await db
      .insert(messages)
      .values({ conversationId: convId, role: "user", content })
      .returning();
    rememberUserMessage(String(content), "dashboard");

    const pendingAttachments = await db
      .update(attachmentsTable)
      .set({ messageId: userMessage.id })
      .where(and(eq(attachmentsTable.conversationId, convId), isNull(attachmentsTable.messageId)))
      .returning();

    const systemPrompt = await buildSystemPrompt(String(content).slice(0, 1000));
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .orderBy(asc(messages.createdAt));

    const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ];

    if (pendingAttachments.length > 0) {
      const parts = await buildAttachmentParts(pendingAttachments, String(content));
      convo[convo.length - 1] = { role: "user", content: parts };
    }

    const internalDraftPieces: string[] = [];
    const usedTools: string[] = [];
    const schritte: ToolStep[] = [];
    const attachmentKinds = pendingAttachments.map((a) => attachmentKind(a.mimeType, a.filename));

    /*
     * Abbruch und Verbindungsverlust sind NICHT dasselbe.
     *
     *   gestoppt        Issa hat den Knopf gedrueckt (eigene Route oben).
     *                   -> Arbeit beenden.
     *   verbindungWeg   Die Leitung ist tot — Funkloch, Bildschirm zu, Deploy.
     *                   -> NICHT aufhoeren. Zu Ende arbeiten und die Antwort
     *                      speichern; Issa sieht sie beim naechsten Laden.
     *                      Nur das Schreiben in die tote Leitung entfaellt.
     */
    let verbindungWeg = false;
    res.on("close", () => {
      if (!res.writableEnded) {
        verbindungWeg = true;
        logger.info({ conversationId: convId }, "Verbindung weg — Lukas arbeitet weiter");
      }
    });

    stoppWuensche.delete(convId); // Reste eines frueheren Zuges
    const gestoppt = () => stoppWuensche.has(convId);
    const sende = (nutzlast: unknown) => {
      if (!verbindungWeg && !res.writableEnded) {
        res.write(`data: ${JSON.stringify(nutzlast)}\n\n`);
      }
    };

    /*
     * Keine feste Rundenzahl. Braucht er 15 Seiten oder 20 Befehle, macht er
     * 15 Seiten und 20 Befehle. Gegen Im-Kreis-Laufen hilft ihm ein Hinweis,
     * keine Bremse — siehe lib/arbeitsschleife.ts.
     */
    let nochAmArbeiten = true;
    // Wird wahr, sobald ein Werkzeug ein Bild geliefert hat — ab dann muss der
    // Router ein Modell mit Augen waehlen, auch wenn Issa selbst nichts
    // angehaengt hat.
    let bilderGesehen = false;
    const schleife = new Arbeitsschleife();
    while (schleife.darfWeiter() && !gestoppt()) {
      const iteration = schleife.naechsteRunde();
      const route = routeLukasModel({
        userText: String(content),
        hasAttachments: pendingAttachments.length > 0 || bilderGesehen,
        attachmentKinds,
        usedTools,
        iteration,
      });

      // Ohne festen Deckel: das Budget kommt aus dem Modell-Client, damit die
      // Denk-Tokens der Reasoning-Modelle die Antwort nicht auffressen.
      const result = await callLukasModel({
        cacheKey: `lukas-${convId}`,
        route,
        tools: await allLukasTools(),
        messages: convo,
      });

      if (result.content) internalDraftPieces.push(result.content);
      if (result.toolCalls.length === 0) {
        nochAmArbeiten = false;
        break;
      }

      convo.push({
        role: "assistant",
        content: result.content || null,
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      // Erst nach den Ergebnissen einfuegen: zwischen Aufruf und Ergebnis darf
      // nichts stehen, sonst weist die API den ganzen Aufruf zurueck.
      // Was dieser Aufruf gekostet hat, zaehlt aufs Budget dieses Zuges.
      schleife.verbucht(result.usage);

      const hinweise = schleife.hinweise(result.toolCalls);

      for (const toolCall of result.toolCalls) {
        if (gestoppt()) break;
        usedTools.push(toolCall.name);
        sende({ tool: toolCall.name });

        let input: Record<string, unknown> = {};
        try {
          input = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
        } catch {
          // Das Tool meldet fehlende/ungueltige Parameter selbst.
        }

        const begonnen = Date.now();
        try {
          const toolResult = await executeLukasTool(toolCall.name, input, {
            rawUserMessage: String(content),
            conversationId: convId,
          });
          convo.push({ role: "tool", tool_call_id: toolCall.id, content: toolResult });
          // Ausgang merken — siehe lib/lernen.ts. Kein Modellaufruf, keine
          // Deutung, nur was passiert ist.
          void merkeErfahrung({
            werkzeug: toolCall.name,
            eingabe: input,
            ergebnis: toolResult,
            conversationId: convId,
          });
          void fuehleWerkzeug({
            werkzeug: toolCall.name,
            eingabe: input,
            gelungen: true,
            runde: iteration,
          });
          schritte.push(
            zeigeSchritt(toolCall.name, input, toolResult, true, Date.now() - begonnen, sende),
          );
        } catch (err) {
          logger.warn({ err, tool: toolCall.name }, "Lukas tool failed");
          const grund = `Fehler: ${err instanceof Error ? err.message : String(err)}`;
          /*
           * Auch ins Fehlerprotokoll, nicht nur ins Log.
           *
           * Genau das hat gefehlt: gescheiterte Werkzeuge standen in Railways
           * Log, das niemand liest, und NICHT in der Diagnose, die Lukas
           * ansehen kann. Deshalb konnte er weder merken noch melden, dass
           * browse_page zwanzigmal am selben Container gescheitert ist.
           */
          recordDebugEvent(`tool:${toolCall.name}`, err);
          convo.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: grund,
          });
          void merkeErfahrung({
            werkzeug: toolCall.name,
            eingabe: input,
            ergebnis: kuerzeGrund(grund),
            gelungen: false,
            conversationId: convId,
          });
          schritte.push(
            zeigeSchritt(toolCall.name, input, grund, false, Date.now() - begonnen, sende),
          );
          if (toolCall.name !== "feel") {
            // Die Lage entscheidet, was daraus wird — siehe lib/bewertung.ts.
            void fuehleWerkzeug({
              werkzeug: toolCall.name,
              eingabe: input,
              gelungen: false,
              grund: kuerzeGrund(grund),
              runde: iteration,
            });
          }
        }
      }

      /*
       * Bildschirmfotos aus dieser Runde nachreichen — erst NACH allen
       * Werkzeugergebnissen, sonst weist die API den Aufruf zurueck. Ab jetzt
       * gilt dieser Zug als bildhaltig, damit der Router auf ein Modell mit
       * Augen umschaltet statt das Bild an ein Textmodell zu schicken.
       */
      const neueBilder = nimmBilder(convId);
      if (neueBilder.length) entwerteAlteBilder(convo);
      for (const bild of neueBilder) {
        bilderGesehen = true;
        convo.push({
          role: "user",
          content: [
            { type: "text", text: `${bild.quelle} — so sieht die Seite gerade aus.${BILD_MARKE}` },
            { type: "image_url", image_url: { url: bild.datenUrl } },
          ],
        } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
      }

      convo.push(...hinweise);

      if (
        internalDraftPieces.length > 0 &&
        !internalDraftPieces[internalDraftPieces.length - 1].endsWith("\n")
      ) {
        internalDraftPieces.push("\n\n");
      }
    }

    const draft = internalDraftPieces.join("").trim();

    /*
     * Gestoppt: kein weiterer Modellaufruf (renderLukasVoice waere genau das).
     * Was bis dahin entstanden ist, wird trotzdem gespeichert — sonst faengt
     * der naechste Turn ohne jede Spur an.
     */
    if (gestoppt()) {
      stoppWuensche.delete(convId);
      if (draft) {
        await db.insert(messages).values({
          conversationId: convId,
          role: "assistant",
          content: `${draft}\n\n[Von dir gestoppt.]`,
          steps: schritte.length ? schritte : null,
        });
      }
      logger.info({ conversationId: convId, usedTools }, "Chat von Issa gestoppt");
      if (!res.writableEnded) res.end();
      return;
    }

    /*
     * Wenn er beim Erreichen der Obergrenze noch mitten in der Arbeit war,
     * fehlt die Antwort — nicht weil etwas kaputt ist, sondern weil in einer
     * Werkzeugrunde kein Text entsteht.
     *
     * Deshalb hier eine letzte Runde OHNE Werkzeuge. Ohne Werkzeuge bleibt ihm
     * nichts als zu formulieren, was er herausgefunden hat. Genau das war der
     * Fall bei "fetch_url, web_search, execute_command × 6": acht Runden
     * Arbeit, und der Chat bekam nichts.
     */
    let abschluss = draft;
    if (nochAmArbeiten) {
      logger.info(
        { conversationId: convId, usedTools, runden: schleife.rundenZahl },
        "Zug endete mitten in der Arbeit — Abschluss ohne Werkzeuge",
      );
      try {
        const letzte = await callLukasModel({
        cacheKey: `lukas-${convId}`,
          route: routeLukasModel({
            userText: String(content),
            hasAttachments: pendingAttachments.length > 0 || bilderGesehen,
            attachmentKinds,
            usedTools,
            iteration: schleife.rundenZahl,
          }),
          messages: [
            ...convo,
            {
              role: "system",
              content:
                "Du hast dein Werkzeug-Budget für diesen Zug aufgebraucht. Antworte JETZT in Worten: " +
                "was hast du herausgefunden, was ist offen, was schlägst du als nächstes vor. " +
                "Keine weiteren Werkzeuge — die stehen dir in diesem Zug nicht mehr zur Verfügung.",
            },
          ],
        });
        if (letzte.content) abschluss = `${draft}\n\n${letzte.content}`.trim();
      } catch (err) {
        logger.warn({ err, conversationId: convId }, "Abschlussrunde fehlgeschlagen");
      }
    }

    /*
     * Die Politur darf die Antwort nicht kosten.
     *
     * renderLukasVoice formuliert den Entwurf zu Lukas' Stimme. Scheitert das,
     * geht der Entwurf unveraendert raus — er enthaelt bereits alles, nur
     * ungeschliffen. Dass ein Formulierungsschritt eine fertige Antwort
     * verschlucken kann, war der Konstruktionsfehler dahinter.
     */
    let fullResponse = "";
    if (abschluss) {
      try {
        fullResponse = await renderLukasVoice({
          systemPrompt,
          conversation: convo,
          draft: abschluss,
        });
      } catch (err) {
        logger.warn({ err, conversationId: convId }, "Ausgabeschicht fehlgeschlagen");
        recordDebugEvent("chat", err);
      }
      if (!fullResponse.trim()) fullResponse = abschluss;
    }

    /*
     * Eine leere Antwort ist kein Ergebnis.
     *
     * Vorher wurde in dem Fall nichts geschrieben und nichts gespeichert: im
     * Chat blieb es einfach still, und nach dem Neuladen stand dort die Frage
     * ohne Antwort — ohne jeden Hinweis, dass ueberhaupt etwas passiert ist.
     * Lieber ehrlich sagen, dass nichts herauskam.
     */
    const antwort =
      fullResponse ||
      "Ich habe für diese Nachricht keine Antwort zustande gebracht. Das ist ein Fehler auf " +
        "meiner Seite, nicht deiner — schick sie mir nochmal, und schau bei Diagnose nach, " +
        "was dort steht.";

    if (!fullResponse) {
      logger.warn({ conversationId: convId, usedTools }, "Chat ohne Antwort beendet");
      recordDebugEvent("chat", `Leere Antwort nach Werkzeugen: ${usedTools.join(", ") || "keine"}`);
    }

    sende({ content: antwort });
    await db.insert(messages).values({
      conversationId: convId,
      role: "assistant",
      content: antwort,
      // Die Arbeitsschritte gehoeren an die Antwort, nicht in den fluechtigen
      // Stream — sonst sind sie nach dem Neuladen weg.
      steps: schritte.length ? schritte : null,
    });
    if (fullResponse) rememberAssistantMessage(fullResponse, "dashboard");

    sende({ done: true });
    if (!res.writableEnded) res.end();
    maybeReflect();
  } catch (err: unknown) {
    logger.error({ err }, "Chat error");
    recordDebugEvent("chat", err);
    /*
     * Der Grund gehoert in den Chat, nicht nur ins Log.
     *
     * "Stream failed" war fuer die Oberflaeche wertlos: sie kennt nur content,
     * tool und done und hat das Feld stillschweigend weggeworfen. Ein Fehler sah
     * damit genauso aus wie Schweigen.
     */
    const grund = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to send message", detail: grund });
    } else {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: grund })}\n\n`);
        res.end();
      }
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    // Muss auch bei einem Absturz mitten im Zug passieren, sonst gilt die
    // Unterhaltung fuer immer als beschaeftigt und der Client fragt ewig nach.
    if (laufendeId !== null) laufendeZuege.delete(laufendeId);
  }
  }),
);

export default router;
