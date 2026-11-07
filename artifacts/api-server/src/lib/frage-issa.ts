import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const frageSchema = z.object({
  frage: z.string().trim().min(3).max(500),
  optionen: z.array(z.string().trim().min(1).max(160)).min(2).max(4).optional(),
});
const schema = z.object({ fragen: z.array(frageSchema).min(1).max(3) });
/** Ordinary decisions only. Credentials belong in the dedicated access UI. */
export function frageIssa(input: unknown, conversationId?: number, telefonisch = false): string {
  const parsed = schema.parse(input);
  if (parsed.fragen.some(f => /passw[oö]rt|api[ -]?(?:key|schl[uü]ssel)|zugangscode|private[ -]?key|geheimschl[uü]ssel/i.test(f.frage))) {
    throw new Error('Zugangsdaten nicht im Rückfragefenster anfordern. Nutze den Bereich Zugänge.');
  }
  if (!Number.isSafeInteger(conversationId) || conversationId! <= 0) throw new Error('Rückfragen benötigen ein privates Gespräch. Im Hintergrund melde_dich_bei_issa verwenden.');
  if (telefonisch) return `Frage deinen Gesprächspartner mündlich und warte auf seine Antwort: ${parsed.fragen.map(f => f.frage).join(' ')}. Kein Dashboardfenster am Telefon behaupten.`;
  const result = JSON.stringify({ surface: 'lukas-rueckfrage', id: randomUUID(), conversationId,
    fragen: parsed.fragen, hinweis: 'Das Eingabefenster wird im Dashboard angezeigt. Warte auf die Antwort des Nutzers; keine Annahmen oder Aktionen für die offene Entscheidung.' });
  // Persisted tool steps are bounded to 4,000 characters. Never let that
  // truncation turn a successful question into invalid, invisible JSON.
  if (result.length > 3900) throw new Error('Bitte Fragen und Optionen kürzer formulieren, damit das vollständige Eingabefenster gespeichert werden kann.');
  return result;
}


type ChatNachricht = { role: string; content: string; steps?: unknown };
/** Read only our successful, scoped question tool output; never ordinary fetched text. */
export function gespeicherteRueckfrage(message: ChatNachricht, conversationId: number) {
  if (message.role !== 'assistant' || !Array.isArray(message.steps)) return null;
  for (const step of [...message.steps].reverse()) {
    if (!step?.ok || !['frage_issa', 'mcp_call'].includes(step.tool) || typeof step.result !== 'string' || step.result.length > 4000) continue;
    try {
      const result = JSON.parse(step.result);
      if (result.surface !== 'lukas-rueckfrage' || result.conversationId !== conversationId || typeof result.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(result.id)) continue;
      const parsed = schema.safeParse(result);
      if (parsed.success) return { id: result.id as string, fragen: parsed.data.fragen };
    } catch { /* Unstructured tool output is not a question. */ }
  }
  return null;
}
/** Questions remain assistant context. Only the selected/typed answers are user text. */
export function mitRueckfrageKontext(message: ChatNachricht, conversationId: number): string {
  const question = gespeicherteRueckfrage(message, conversationId);
  return question ? message.content + '\n\nMeine zuvor im Eingabefenster gestellte Rückfrage (eigener Assistentenkontext):\n' + JSON.stringify(question) : message.content;
}
/** Keep task-specific tools and routing when a scoped question is answered. */
export function rueckfrageRoutingText(history: ChatNachricht[], content: string, conversationId: number): string {
  const previous = history.slice(0, -1);
  let assistantIndex = previous.length - 1;
  while (assistantIndex >= 0 && previous[assistantIndex].role !== 'assistant') assistantIndex--;
  if (assistantIndex < 0) return content;
  const question = gespeicherteRueckfrage(previous[assistantIndex], conversationId);
  if (!question || !content.startsWith('Antwort auf deine Rückfrage:\n')) return content;
  return previous.slice(0, assistantIndex).reverse().find(m => m.role === 'user')?.content || content;
}
