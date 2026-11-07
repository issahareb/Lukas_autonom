import { db, verbrauchBerichte } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { fallstudienBericht } from './verbrauch-fallstudie';
import { logger } from './logger';
let timer: ReturnType<typeof setTimeout> | undefined;
let gestoppt = true;
// Keep summary and values in one line even when production uses pino-pretty.
// A filtered Railway log read must return the data, not only a message heading.
export function archivLogZeile(daten: Record<string, unknown>): string {
  return "LUKAS_EFFIZIENZ " + JSON.stringify(daten);
}
function logBeleg(daten: Record<string, unknown>) { logger.info(archivLogZeile(daten)); }

/** No paid API/model calls. A durable daily snapshot plus connector-readable summaries. */
export async function archiviereVerbrauch() {
  const id = `usage-v2-${new Date().toISOString().slice(0,10)}`;
  let [row] = await db.select().from(verbrauchBerichte).where(eq(verbrauchBerichte.id,id)).limit(1);
  if (!row) {
    const bericht = await fallstudienBericht();
    await db.insert(verbrauchBerichte).values({id,sha256:bericht.nachweis.sha256,daten:JSON.parse(JSON.stringify(bericht))}).onConflictDoNothing();
    [row] = await db.select().from(verbrauchBerichte).where(eq(verbrauchBerichte.id,id)).limit(1);
  }
  if (!row) throw new Error('Verbrauchsarchiv konnte nicht bestätigt werden.');
  const b = row.daten as Awaited<ReturnType<typeof fallstudienBericht>>;
  const basis = {berichtId:row.id,sha256:row.sha256,stand:b.stand,version:2};
  logBeleg({...basis,art:'gesamt',zeitraum:b.aktuell.zeitraum,vorher:b.vorher.zeitraum,abdeckung:b.aktuell.abdeckung,abgleich:b.abgleich,grenzen:b.methodik.grenzen});
  for (const bereich of b.aktuell.bereiche) logBeleg({...basis,art:'bereich',bereich});
  for (const v of b.vergleich) {
    // No criteria text or acceptance references in logs. Full receipts remain behind the authenticated export.
    logBeleg({...basis,art:'vergleich',kanal:v.kanal,aufgabenart:v.aufgabenart,bewertung:v.bewertung,gruende:v.gruende,
      aktuell:v.aktuell?{auftraege:v.aktuell.auftraege,bestaetigt:v.aktuell.bestaetigt,tokensJeErfolg:v.aktuell.tokensJeErfolg}:null,
      vorher:v.vorher?{auftraege:v.vorher.auftraege,bestaetigt:v.vorher.bestaetigt,tokensJeErfolg:v.vorher.tokensJeErfolg}:null,
      aenderungProzent:v.aenderungProzent});
  }
  return row;
}
export function startVerbrauchsArchiv() {
  if (!gestoppt) return;
  gestoppt = false;
  const run = async () => {
    try { await archiviereVerbrauch(); }
    catch(err) { logger.warn({err},'LUKAS_EFFIZIENZ_FEHLER'); }
    finally {
      // Retry failures hourly; the successful daily snapshot is immutable and reused on restart.
      if(!gestoppt){timer=setTimeout(run,60*60*1000);timer.unref();}
    }
  };
  timer=setTimeout(run,30_000);timer.unref();
}
export function stopVerbrauchsArchiv(){gestoppt=true;if(timer)clearTimeout(timer);timer=undefined;}
