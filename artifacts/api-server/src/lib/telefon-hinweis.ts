import { db, telefonAnrufe } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fluestereLiveTelefon } from "./ai/live-session";

const ended = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);
export async function hinweisAnruf(id: number, conversationId?: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Ungültige Anruf-ID.");
  const [call] = await db.select().from(telefonAnrufe).where(eq(telefonAnrufe.id, id)).limit(1);
  if (!call?.kontextId || call.richtung !== "ausgehend" || ended.has(call.zielStatus) || ended.has(call.sipStatus)) throw new Error("Dieser Anruf läuft nicht mehr.");
  if (conversationId !== undefined && call.conversationId !== conversationId) throw new Error("Der Anruf gehört nicht zu diesem Chat. Nutze das Hinweisfeld beim Anruf im Telefonbereich.");
  return call;
}
export async function telefonHinweis(id: number, text: string, conversationId?: number): Promise<string> {
  if (!text.trim() || text.length > 2000) throw new Error("Hinweis mit maximal 2000 Zeichen erforderlich.");
  const call = await hinweisAnruf(id, conversationId);
  const delivered = fluestereLiveTelefon(call.kontextId!, text, !call.liveBereit);
  if (delivered === "queued") return "Hinweis für diesen Anruf vorgemerkt; Lukas erhält ihn beim Verbindungsaufbau (bis zu zwei Minuten).";
  if (!delivered) throw new Error("Lukas ist noch nicht mit diesem Anruf verbunden. Bitte erneut senden, sobald das Gespräch läuft.");
  return "Hinweis an Lukas übermittelt. Der Gesprächspartner hört deine Stimme nicht.";
}
