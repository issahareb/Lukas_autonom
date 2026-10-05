import { db, tageskostenTable, liveVerbrauchTable, openaiGuthabenTable } from "@workspace/db";
import { gte } from "drizzle-orm";

type Kosten = {
  tag: string; provider: string; model: string; quelle?: string; aufrufe: number;
  rein: number; raus: number; ausCache: number; inCache: number;
};
type Live = { model: string; quelle: string; sekunden: number | null; beendet: boolean; gestartetAt: Date };
const TAG = 86400000;
export function fasseVerbrauchZusammen(kosten: Kosten[], live: Live[], tage = 14, jetzt = new Date()) {
  const tageswerte = Array.from({ length: tage }, (_, i) => ({
    tag: new Date(jetzt.getTime() - (tage - 1 - i) * TAG).toISOString().slice(0, 10),
    erfasst: false, aufrufe: 0, eingabe: 0, ausgabe: 0, cacheLesen: 0, cacheSchreiben: 0, gesamt: 0,
    liveSekunden: 0, liveSitzungen: 0, liveOhneMesswert: 0, liveOffen: 0,
  }));
  const modelle = new Map<string, { provider: string; model: string; quelle: string; aufrufe: number;
    eingabe: number; ausgabe: number; cacheLesen: number; cacheSchreiben: number; gesamt: number }>();
  const liveModelle = new Map<string, { model: string; quelle: string; sekunden: number; sitzungen: number; ohneMesswert: number; offen: number }>();
  for (const k of kosten) {
    const tag = tageswerte.find(t => t.tag === k.tag); if (!tag) continue;
    const quelle = k.quelle ?? "unzugeordnet";
    const key = JSON.stringify([k.provider, k.model, quelle]);
    const m = modelle.get(key) ?? { provider: k.provider, model: k.model, quelle,
      aufrufe: 0, eingabe: 0, ausgabe: 0, cacheLesen: 0, cacheSchreiben: 0, gesamt: 0 };
    for (const z of [tag, m]) {
      z.aufrufe += k.aufrufe; z.eingabe += k.rein; z.ausgabe += k.raus;
      z.cacheLesen += k.ausCache; z.cacheSchreiben += k.inCache;
      z.gesamt += k.rein + k.raus + k.ausCache + k.inCache;
    }
    tag.erfasst = true; modelle.set(key, m);
  }
  for (const l of live) {
    const tag = tageswerte.find(t => t.tag === l.gestartetAt.toISOString().slice(0, 10)); if (!tag) continue;
    const key = JSON.stringify([l.model, l.quelle]);
    const m = liveModelle.get(key) ?? { model: l.model, quelle: l.quelle, sekunden: 0, sitzungen: 0, ohneMesswert: 0, offen: 0 };
    tag.liveSitzungen++; m.sitzungen++;
    if (!l.beendet) { tag.liveOffen++; m.offen++; }
    if (l.sekunden === null) { tag.liveOhneMesswert++; m.ohneMesswert++; }
    else { tag.liveSekunden += l.sekunden; m.sekunden += l.sekunden; }
    liveModelle.set(key, m);
  }
  return { stand: jetzt.toISOString(), zeitzone: "UTC", tageswerte,
    modelle: [...modelle.values()].sort((a,b) => b.gesamt-a.gesamt), liveModelle: [...liveModelle.values()] };
}

export async function verbrauchsbericht(tage = 14) {
  const jetzt = new Date();
  const seitTag = new Date(jetzt.getTime() - (tage - 1) * TAG).toISOString().slice(0, 10);
  const [kosten, live, guthaben] = await Promise.all([
    db.select().from(tageskostenTable).where(gte(tageskostenTable.tag, seitTag)),
    db.select().from(liveVerbrauchTable).where(gte(liveVerbrauchTable.gestartetAt, new Date(seitTag + "T00:00:00Z"))),
    db.select().from(openaiGuthabenTable).limit(1),
  ]);
  return { ...fasseVerbrauchZusammen(kosten, live, tage, jetzt), guthaben: guthaben[0] ?? null };
}

export async function bestaetigeGuthaben(usd: number, organisation: string) {
  const wert = { id: 1, usd, organisation, bestaetigtAt: new Date() };
  const [row] = await db.insert(openaiGuthabenTable).values(wert)
    .onConflictDoUpdate({ target: openaiGuthabenTable.id, set: wert }).returning();
  return row;
}
