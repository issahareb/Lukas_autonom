import { db, liveVerbrauchTable } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function speichereLiveVerbrauch(input: {
  id: string; model: string; quelle: string; sekunden: number | null;
  gestartetAt: Date; beendet: boolean;
}): Promise<void> {
  const sekunden = input.sekunden !== null && Number.isFinite(input.sekunden) && input.sekunden >= 0
    ? input.sekunden : null;
  await db.insert(liveVerbrauchTable).values({ ...input, sekunden }).onConflictDoUpdate({
    target: liveVerbrauchTable.id,
    set: {
      sekunden: sql`greatest(${liveVerbrauchTable.sekunden}, ${sekunden})`,
      beendet: sql`${liveVerbrauchTable.beendet} OR ${input.beendet}`,
      aktualisiertAt: new Date(),
    },
  });
}
