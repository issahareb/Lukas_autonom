/** No model call and no prompt text is persisted by this classifier. Labels are descriptive, never a proof of equal difficulty. */
export const MESSVERSION = 2;
export function messRevision(): string | null {
  return process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.LUKAS_BUILD_REVISION ?? null;
}
export function aufgabenart(text: string, profil?: string): string {
  if (profil === 'code' || /\b(code|coding|repository|github|refactor|typescript|javascript|python|bug|build|deploy|skript|implementier\w*)\b/i.test(text)) return 'coding';
  if (/\b(seo|suchanfragen|impressionen|search console|sichtbarkeit|analytics|aufrufzahlen|kennzahlen)\b/i.test(text)) return 'analyse';
  if (/\b(text|entwurf|angebot|anschreiben|email|e-mail|schreib\w*)\b/i.test(text)) return 'entwurf';
  if (/\b(recherch\w*|vergleich\w*|quelle\w*|such\w*)\b/i.test(text)) return 'recherche';
  return 'allgemein';
}
export type Fallstudie = { serie: string; fall: string; abnahme: string };
export function pruefeFallstudie(value: unknown): Fallstudie | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RangeError('Ungültige Fallstudie.');
  const v = value as Record<string, unknown>;
  if (![v.serie, v.fall].every(x => typeof x === 'string' && /^[a-zA-Z0-9._-]{1,100}$/.test(x)) ||
      typeof v.abnahme !== 'string' || !v.abnahme.trim() || v.abnahme.length > 2000) throw new RangeError('Fallstudie benötigt serie, fall und ein Abnahmekriterium.');
  return { serie: v.serie as string, fall: v.fall as string, abnahme: v.abnahme.trim() };
}
/** Provider usage only: never persist arbitrary response text, keys or prompts. */
export function usageBeleg(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k,v] of Object.entries(value)) {
    if (!/^[a-zA-Z0-9_]{1,80}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = usageBeleg(v);
  }
  return out;
}
export const METHODIK = {
  version: MESSVERSION,
  einheit: 'Provider-gemeldete Tokens. Cache-Kategorien disjunkt. Reasoning ist Teil der Ausgabe, kein zusätzlicher Verbrauch.',
  aufteilung: 'Kanal, Aufgabenart, Auftrag, Modell, Phase, Unterauftrag. Kontextanteile in Zeichen, keine erfundenen Tokenanteile.',
  abnahme: 'Antwort erstellt ist kein Erfolg. Erfolg nur nach gesonderter Abnahme mit Beleg; Kosten fehlgeschlagener Versuche bleiben enthalten.',
  vergleich: 'Gleiche Serie/Fall-ID, Abnahmekriterium, Aufgabenart und Kanal. Vollständige geschlossene UTC-Tage; aktuelle Zeiträume gesondert. Keine kausale Aussage aus bloßen Wochensummen.',
  grenzen: ['Kein Rechnungsabgleich und keine Eurokosten ohne belegte Tarife.', 'Live-Sprache: gemeldete Sekunden separat. Audio-Transkription, Telnyx und ElevenLabs sind nicht vollständig in Texttokens enthalten.', 'Direkte VPS-Python-Aufrufe haben keinen zentralen Tokenbeleg. Deshalb keine Behauptung einer vollständigen Gesamt-Abdeckung.', 'SDK-interne Wiederholungen ohne Providerbeleg sind nicht einzeln auflösbar. Abgebrochene Streams können bezahlte Tokens ohne Nutzungsbeleg haben.'],
};
