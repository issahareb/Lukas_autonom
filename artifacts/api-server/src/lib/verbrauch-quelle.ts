export type VerbrauchsQuelle = "chat" | "autonomie" | "reflexion" | "moltbook" | "studio" | "ausgabe" | "telefon" | "sprache" | "portfolio" | "sonstige" | "unzugeordnet";

// Keep pending writes alive until graceful shutdown, without putting the
// database latency on the voice/model response path.
const pending = new Set<Promise<unknown>>();
export function verbrauchSchreiben(job: Promise<unknown>): void {
  pending.add(job);
  void job.finally(() => pending.delete(job)).catch(() => {});
}
export async function verbrauchLeeren(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}
