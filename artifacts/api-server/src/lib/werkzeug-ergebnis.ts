/** Legacy text tools plus explicit machine-readable execution outcomes. */
export function istMisserfolg(ergebnis: string): boolean {
  const text = ergebnis.trim();
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data) &&
      ["blocked", "failed", "uncertain", "blockiert", "fehlgeschlagen", "unklar", "verpasst"].includes(data.status)) return true;
  } catch { /* Most legacy tools still return text. */ }
  return /^(Fehler:|Die Seite liess sich nicht bedienen|Abgebrochen —|Für die Sitzung)|nicht zugestellt|fehlgeschlagen|konnte nicht|Kein Anruf gestartet|nicht zum Anrufen freigegeben|Zum Anrufen fehlen|Anbieterantwort fehlt/i.test(text.slice(0, 500));
}
