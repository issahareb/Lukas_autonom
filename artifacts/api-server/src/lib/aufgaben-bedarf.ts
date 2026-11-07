/**
 * A text deliverable is not an instruction to operate the systems mentioned
 * inside it. Keep this gate conservative: ambiguous or combined action requests
 * keep normal routing. Discovery and memory lookup remain available.
 */
export function istAntwortEntwurf(task: string): boolean {
  const text = task.trim();
  if (!text || text.length > 6000) return false;
  const ohneVerbote = text
    .replace(/\b(?:nicht|nichts)\s+(?:veröffentlichen|veroeffentlichen|versenden|speichern)(?:\s+oder\s+(?:veröffentlichen|veroeffentlichen|versenden|speichern))*/gi, '')
    .replace(/\bkeine\s+(?:Dateien oder Ziele anlegen|Ziele anlegen|externen Systeme ändern)/gi, '');
  // A real operation alongside the draft always wins. Do not hide tools for
  // "prepare a template and send it", repo changes or research with a draft.
  if (/\b(?:ruf(?:e)?|anrufen|sende\w*|versend\w*|schick\w*|veröffentlich(?:e|en|t|st)?|veroeffentlich(?:e|en|t|st)?|deploy\w*|merge\w*|commit\w*|push\w*|buch(?:e|en)|lösch\w*|loesch\w*|änder(?:e|n)|aender(?:e|n)|speicher\w*|recherchier\w*|installier\w*|führ(?:e|en)?|fuehr(?:e|en)?|ausführen|ausfuehren)\b/i.test(ohneVerbote)) return false;
  if (/https?:|\b(?:github|repo(?:s|sitory)?|dateisystem|postfach|posteingang)\b/i.test(ohneVerbote)) return false;
  const erstellen = /\b(?:erstell\w*|schreib\w*|formulier\w*|liefer\w*|analysier\w*|berechn\w*)\b/i.test(text);
  const vorlage = /\b(?:vorlagen?|textentw[uü]rf\w*|[uü]bergabevermerk)\b/i.test(text);
  const nurChat = /\b(?:nur|ausschließlich|ausschliesslich)\s+(?:hier\s+)?(?:im\s+chat\s+)?antworten\b/i.test(text);
  const begrenzt = /\b(?:keine externen Systeme ändern|nichts speichern oder versenden|keine Dateien oder Ziele anlegen)\b/i.test(text);
  const synthetisch = /\b(?:synthetisch\w*|fiktiv\w*)\b/i.test(text) && /\bdirekt hier im Chat\b/i.test(text);
  return erstellen && (vorlage || (nurChat && begrenzt) || synthetisch);
}

export const ANTWORT_ENTWURF_REGEL = 'Dieser Auftrag verlangt eine Antwort oder Vorlage im Chat. Erwähnte Systeme und Funktionen sind Inhalt des Entwurfs, kein Auftrag zu ihrer Bedienung. Lege für eine hier erledigte Antwort kein Ziel an. Benötigst du eine zusätzliche Quelle oder Fähigkeit, lade sie gezielt über query_memory oder mcp_find_tool nach. Freigaben und alle übrigen Regeln gelten weiterhin.';
