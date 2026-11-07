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
  return JSON.stringify({ surface: 'lukas-rueckfrage', id: randomUUID(), conversationId,
    fragen: parsed.fragen, hinweis: 'Das Eingabefenster wird im Dashboard angezeigt. Warte auf die Antwort des Nutzers; keine Annahmen oder Aktionen für die offene Entscheidung.' });
}
