import { pool } from "@workspace/db";
import type { ToolStep } from "@workspace/db";
import type OpenAI from "openai";
import { ownerCallGrantFromMessage } from "./owner-call-grant";
import { beginOwnerPhoneWork, stopConversationWork } from "./chat-work-state";
import { rememberUserMessage, rememberAssistantMessage } from "./conversation-memory";
import { maybeReflect } from "./reflection";

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type OwnerPhoneChatStore = {
  create(): Promise<number>;
  start(id: number, text: string): Promise<{ messageId: number; history: Message[] }>;
  save(messageId: number, text: string, steps: ToolStep[]): Promise<void>;
};
export const ownerPhoneChatSqlStore: OwnerPhoneChatStore = {
  async create() {
    const { rows } = await pool.query("INSERT INTO lukas_conversations(title) VALUES($1) RETURNING id", ["Telefonauftrag · " + new Date().toISOString()]);
    const id = rows[0]?.id;
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Telefonauftrag konnte nicht im Dashboard angelegt werden.");
    return id;
  },
  async start(id, text) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO lukas_messages(conversation_id,role,content) VALUES($1,'user',$2)", [id, text]);
      const history = await client.query("SELECT role,content FROM lukas_messages WHERE conversation_id=$1 ORDER BY id", [id]);
      const pending = await client.query("INSERT INTO lukas_messages(conversation_id,role,content) VALUES($1,'assistant',$2) RETURNING id", [id, "Ich bearbeite deinen Telefonauftrag."]);
      await client.query("COMMIT");
      return { messageId: pending.rows[0].id, history: history.rows as Message[] };
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  },
  async save(messageId, text, steps) {
    const result = await pool.query("UPDATE lukas_messages SET content=$2,steps=$3::jsonb WHERE id=$1 RETURNING id", [messageId, text, JSON.stringify(steps)]);
    if (result.rowCount !== 1) throw new Error("Telefonauftrag ist im Dashboard nicht mehr vorhanden.");
  },
};

/** Constructed only by the server-verified incoming-owner branch. */
export async function createOwnerPhoneChat(ownerContactId: number, store: OwnerPhoneChatStore = ownerPhoneChatSqlStore) {
  if (!Number.isSafeInteger(ownerContactId) || ownerContactId <= 0) throw new Error("Bestätigter Owner-Kontakt fehlt.");
  const id = await store.create();
  let active: AbortController | undefined;
  return {
    id,
    stop(): boolean { if (!active) return false; stopConversationWork(id); return true; },
    async run(userText: string, context: string): Promise<string> {
      const controller = new AbortController();
      const release = beginOwnerPhoneWork(id, controller);
      active = controller;
      const steps: ToolStep[] = [];
      let checkpoint = Promise.resolve();
      let messageId: number | undefined;
      try {
        const turn = await store.start(id, userText); messageId = turn.messageId;
        controller.signal.throwIfAborted();
        void rememberUserMessage(userText, "voice");
        const { runLukasTurn } = await import("./lukas-brain");
        const answer = await runLukasTurn({ quelle: "telefon", conversationId: id, telefonOwnerContactId: ownerContactId,
          history: turn.history, userText,
          // No prompt/tool override: use the same task-aware private context,
          // discovery, policy, work journal and routing as a dashboard task.
          systemPromptExtra: "Du bearbeitest einen Auftrag aus einem serverseitig bestätigten eingehenden Owner-Telefonat. Die vollständige Antwort und Werkzeugbelege werden im privaten Dashboard gespeichert. Verfügbare Funktionen und Werkzeugrichtlinien sind dieselben wie im privaten Chat.\n" + context,
          ownerCallGrant: ownerCallGrantFromMessage(userText), signal: controller.signal,
          onToolStep: async step => {
            steps.push(step); const snapshot = [...steps];
            checkpoint = checkpoint.then(() => store.save(turn.messageId, "Ich bearbeite deinen Telefonauftrag.", snapshot));
            await checkpoint;
          },
        });
        controller.signal.throwIfAborted();
        await store.save(turn.messageId, answer, steps);
        void rememberAssistantMessage(answer, "voice"); maybeReflect();
        return answer;
      } catch (error) {
        if (messageId !== undefined) await store.save(messageId,
          controller.signal.aborted && controller.signal.reason?.message === "Von dir gestoppt" ? "[Von dir gestoppt.] Bereits begonnene Aktionen können erfolgt sein. Vor einer Wiederholung den Status prüfen."
            : "Der Telefonauftrag wurde unterbrochen. Gespeicherte Werkzeugbelege und das Arbeitsjournal enthalten den bisherigen Stand. Vor einer Wiederholung unklare Aktionen prüfen.", steps);
        throw error;
      } finally { active = undefined; release(); }
    },
  };
}
export type OwnerPhoneChat = Awaited<ReturnType<typeof createOwnerPhoneChat>>;
