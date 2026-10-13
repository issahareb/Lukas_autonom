/** Current SIP sessions, separate from the last status persisted by a webhook. */
const sessions = new Map<string, string>();
export function merkeTelefonSitzung(sessionId: string, kontextId: string) {
  sessions.set(sessionId, kontextId);
}
export function entferneTelefonSitzung(sessionId: string) {
  sessions.delete(sessionId);
}

export function aktuellerAnruf<T extends {
  ergebnis: string; kontextId: string | null; createdAt: Date;
}>(anruf: T, jetzt = Date.now()): T {
  if (!["gewaehlt", "klingelt", "angenommen", "verbunden"].includes(anruf.ergebnis)) return anruf;
  if (anruf.kontextId && [...sessions.values()].includes(anruf.kontextId)) return anruf;
  // Dialling can precede the SIP session. Missing callbacks must not keep an
  // old attempt running forever. Absence of a session does not prove hangup.
  const alter = jetzt - anruf.createdAt.getTime();
  if (["gewaehlt", "klingelt"].includes(anruf.ergebnis) && alter >= 0 && alter < 120_000) return anruf;
  return { ...anruf, ergebnis: "unbekannt" };
}
