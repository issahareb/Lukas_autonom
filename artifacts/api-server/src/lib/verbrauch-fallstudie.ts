import { randomUUID } from 'node:crypto';
import { db, tageskostenTable, liveVerbrauchTable, verbrauchAuftraege, verbrauchAufrufe, verbrauchAbnahmen } from '@workspace/db';
import { and, gte, lt, lte, inArray, isNull, or, eq } from 'drizzle-orm';
import { verbrauchLeeren } from './verbrauch-quelle';
import { verbrauchsZeitraum, type ZeitraumInput } from './verbrauch-zeitraum';
import { werteVerbrauchAus, vergleicheVerbrauch, belegHash } from './verbrauch-auswertung';
import { fasseVerbrauchZusammen } from './verbrauchsbericht';
import { METHODIK, messRevision } from './verbrauch-methodik';
const LIMIT = 20_000;
function nichtGekuerzt<T>(rows: T[]): T[] { if (rows.length>LIMIT) throw new RangeError('Zu viele Belege. Kleineren Zeitraum wählen; es wird nichts still gekürzt.'); return rows; }
export async function fallstudienBericht(input: ZeitraumInput = {}) {
  const jetzt = new Date(); const z = verbrauchsZeitraum(input,jetzt);
  const seit = new Date(z.vergleichVon+'T00:00:00Z');
  await verbrauchLeeren();
  // One repeatable-read snapshot: totals, individual receipts and acceptances share one database state.
  const quellen = await db.transaction(async tx => {
    const kosten = nichtGekuerzt(await tx.select().from(tageskostenTable).where(and(gte(tageskostenTable.tag,z.vergleichVon),lte(tageskostenTable.tag,z.bis))).orderBy(tageskostenTable.tag,tageskostenTable.provider,tageskostenTable.model,tageskostenTable.quelle).limit(LIMIT+1));
    const live = nichtGekuerzt(await tx.select().from(liveVerbrauchTable).where(and(gte(liveVerbrauchTable.gestartetAt,seit),lt(liveVerbrauchTable.gestartetAt,z.bisExklusiv))).orderBy(liveVerbrauchTable.id).limit(LIMIT+1));
    const imFenster = nichtGekuerzt(await tx.select().from(verbrauchAufrufe).where(and(gte(verbrauchAufrufe.gestartetAt,seit),lt(verbrauchAufrufe.gestartetAt,z.bisExklusiv))).orderBy(verbrauchAufrufe.id).limit(LIMIT+1));
    const rootIds = [...new Set(imFenster.map(c=>c.rootId))];
    const auftraege = nichtGekuerzt(await tx.select().from(verbrauchAuftraege).where(or(
      and(gte(verbrauchAuftraege.gestartetAt,seit),lt(verbrauchAuftraege.gestartetAt,z.bisExklusiv)),
      rootIds.length ? inArray(verbrauchAuftraege.rootId,rootIds) : undefined,
    )).orderBy(verbrauchAuftraege.id).limit(LIMIT+1));
    const alleRoots = [...new Set([...rootIds,...auftraege.map(a=>a.rootId)])];
    const aufrufe = alleRoots.length ? nichtGekuerzt(await tx.select().from(verbrauchAufrufe).where(inArray(verbrauchAufrufe.rootId,alleRoots)).orderBy(verbrauchAufrufe.id).limit(LIMIT+1)) : imFenster;
    const abnahmen = alleRoots.length ? nichtGekuerzt(await tx.select().from(verbrauchAbnahmen).where(and(inArray(verbrauchAbnahmen.rootId,alleRoots),lte(verbrauchAbnahmen.erstelltAt,jetzt))).orderBy(verbrauchAbnahmen.id).limit(LIMIT+1)) : [];
    return { kosten,live,auftraege,aufrufe,abnahmen };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  const aktuell = werteVerbrauchAus(quellen.auftraege,quellen.aufrufe,quellen.abnahmen,z.von,z.bis,jetzt);
  const vorher = werteVerbrauchAus(quellen.auftraege,quellen.aufrufe,quellen.abnahmen,z.vergleichVon,z.vergleichBis,jetzt);
  const tagessummen = (von:string,bis:string) => fasseVerbrauchZusammen(quellen.kosten,quellen.live,z.tage,new Date(bis+'T12:00:00Z'));
  const summen = { aktuell: tagessummen(z.von,z.bis), vorher: tagessummen(z.vergleichVon,z.vergleichBis) };
  const abgleich = (teil: typeof aktuell, summen: ReturnType<typeof tagessummen>) => {
    const providerTage = summen.modelle.reduce((s,r)=>s+r.gesamt,0);
    const einzelBelege = teil.bereiche.filter(r=>r.provider!=='local' || process.env.LUKAS_LOCAL_BILLABLE==='true').reduce((s,r)=>s+r.gesamt,0);
    return { tagessumme: providerTage, einzelBelege, differenz: einzelBelege-providerTage,
      passt: einzelBelege===providerTage, hinweis:'Interner Summenabgleich, kein Provider-Rechnungsabgleich. Tagesbuchung und Aufrufstart können bei Mitternacht auf verschiedene Tage fallen.' };
  };
  const vergleich = vergleicheVerbrauch(aktuell,vorher);
  const nutzdaten = { version:2, stand:jetzt.toISOString(), revision:messRevision(), methodik:METHODIK, aktuell, vorher, vergleich,
    summen, abgleich:{aktuell:abgleich(aktuell,summen.aktuell),vorher:abgleich(vorher,summen.vorher)}, quellen };
  return { ...nutzdaten, nachweis: { algorithmus:'sha256', serialisierung:'rekursiv-sortierte-json-schluessel-v1', sha256:belegHash(nutzdaten), umfang:'JSON ohne das Feld nachweis; Objektschlüssel rekursiv lexikographisch sortieren; Arrayreihenfolge bewahren; JSON.stringify ohne Einrückung. Belege enthalten keine Prompt- oder Antworttexte. Hash belegt Unverändertheit eines gesicherten Exports, keine externe Beglaubigung.' } };
}
export async function nehmeAuftragAb(rootId: string, input: unknown) {
  if (!input || typeof input!=='object') throw new RangeError('Abnahme mit Ergebnis, Prüfer und Beleg erforderlich.');
  const v = input as Record<string,unknown>;
  if (!['erfolgreich','fehlgeschlagen'].includes(String(v.ergebnis)) || typeof v.beleg!=='string' || !v.beleg.trim() || v.beleg.length>4000 ||
    typeof v.pruefer!=='string' || !v.pruefer.trim() || v.pruefer.length>120) throw new RangeError('Ergebnis erfolgreich/fehlgeschlagen, Prüfer und Beleg erforderlich.');
  await verbrauchLeeren();
  const [a] = await db.select().from(verbrauchAuftraege).where(and(eq(verbrauchAuftraege.id,rootId),isNull(verbrauchAuftraege.parentId))).limit(1);
  if (!a) throw new RangeError('Auftrag nicht gefunden.');
  if (!a.beendetAt) throw new RangeError('Auftrag ist noch nicht abgeschlossen.');
  const [row] = await db.insert(verbrauchAbnahmen).values({id:randomUUID(),rootId,ergebnis:String(v.ergebnis),beleg:v.beleg.trim(),pruefer:v.pruefer.trim()}).returning();
  return row;
}
export function formatiereFallstudie(b: Awaited<ReturnType<typeof fallstudienBericht>>) {
  return JSON.stringify({stand:b.stand,zeitzone:'UTC',methodik:b.methodik,nachweis:b.nachweis,
    aktuell:{zeitraum:b.aktuell.zeitraum,bereiche:b.aktuell.bereiche,abdeckung:b.aktuell.abdeckung},
    vorher:{zeitraum:b.vorher.zeitraum,bereiche:b.vorher.bereiche,abdeckung:b.vorher.abdeckung},vergleich:b.vergleich,abgleich:b.abgleich,
    hinweis:'Rohbelege über GET /api/lukas/verbrauch/fallstudie mit denselben Datumsgrenzen exportieren. Ohne gültige Fallabnahme keine belastbare Effizienzbehauptung.'});
}
