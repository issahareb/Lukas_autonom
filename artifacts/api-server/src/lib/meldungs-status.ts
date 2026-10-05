export const normalisiereBetreff = (s: string) => s.normalize("NFKC").toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export function meldungIstVeraltet(m: { createdAt: Date; geprueftAt?: Date | null }, jetzt = Date.now()): boolean {
  return jetzt - (m.geprueftAt ?? m.createdAt).getTime() > 7 * 86400000;
}
