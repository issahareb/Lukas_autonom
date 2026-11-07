/** Shared foreground work state for dashboard chat and verified owner calls. */
export const stoppWuensche = new Set<number>();
export const laufendeZuege = new Map<number, number>();
const phoneWork = new Map<number, AbortController>();

export function stopConversationWork(id: number): void {
  stoppWuensche.add(id);
  phoneWork.get(id)?.abort(new DOMException("Von dir gestoppt", "AbortError"));
}
export function shutdownOwnerPhoneWork(): void {
  for (const controller of phoneWork.values()) controller.abort(new DOMException("Server wird neu gestartet", "AbortError"));
}
export function beginOwnerPhoneWork(id: number, controller: AbortController): () => void {
  if (laufendeZuege.has(id)) throw new Error("Diese Unterhaltung wird bereits bearbeitet.");
  stoppWuensche.delete(id); laufendeZuege.set(id, Date.now()); phoneWork.set(id, controller);
  return () => {
    if (phoneWork.get(id) !== controller) return;
    phoneWork.delete(id); laufendeZuege.delete(id); stoppWuensche.delete(id);
  };
}
