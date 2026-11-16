import { belegHash, werteVerbrauchAus } from './verbrauch-auswertung';
import type { fallstudienBericht } from './verbrauch-fallstudie';
type Bericht = Awaited<ReturnType<typeof fallstudienBericht>>;
type Basis = { berichtId: string; sha256: string; stand: string; version: number };

function isoWoche(tag: string): string {
  const d = new Date(tag + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const jahr = d.getUTCFullYear();
  const n = Math.ceil(((d.getTime() - Date.UTC(jahr, 0, 1)) / 86400000 + 1) / 7);
  return `${jahr}-KW${String(n).padStart(2, '0')}`;
}

/** Derived log views retain the archive's proof and snapshot. Never combine
 * overlapping daily archives or publish prompts, criteria or review references. */
export function archivLogDaten(basis: Basis, b: Bericht): Record<string, unknown>[] {
  const { nachweis, ...payload } = b;
  if (basis.sha256 !== nachweis.sha256 || belegHash(payload) !== basis.sha256 || basis.stand !== b.stand) {
    throw new Error('Verbrauchsarchiv: SHA-256 oder Datenstand stimmt nicht.');
  }
  const rows: Record<string, unknown>[] = [];
  const add = (data: Record<string, unknown>) => rows.push({ ...basis, ...data });
  add({ art: 'gesamt', revision: b.revision, zeitraum: b.aktuell.zeitraum, vorher: b.vorher.zeitraum,
    abdeckung: b.aktuell.abdeckung, abgleich: b.abgleich, grenzen: b.methodik.grenzen });
  for (const bereich of b.aktuell.bereiche) add({ art: 'bereich', bereich });
  for (const v of b.vergleich) {
    const summary = (g: typeof v.aktuell) => g ? {
      auftraege: g.auftraege, bestaetigt: g.bestaetigt, geprueft: g.geprueft, tokens: g.tokens,
      tokensJeErfolg: g.tokensJeErfolg, vollstaendig: g.vollstaendig, modelle: g.modelle,
    } : null;
    add({ art: 'vergleich', kanal: v.kanal, aufgabenart: v.aufgabenart, serie: v.serie, fall: v.fall,
      fallSchluessel: belegHash(v.key), bewertung: v.bewertung, gruende: v.gruende,
      aktuell: summary(v.aktuell), vorher: summary(v.vorher), aenderungProzent: v.aenderungProzent });
  }
  // JSONB archives contain ISO strings even though live reports contain Dates.
  const jobs = b.quellen.auftraege.map(a => ({ ...a, gestartetAt: new Date(a.gestartetAt), beendetAt: a.beendetAt ? new Date(a.beendetAt) : null }));
  const calls = b.quellen.aufrufe.map(c => ({ ...c, gestartetAt: new Date(c.gestartetAt) }));
  const reviews = b.quellen.abnahmen.map(a => ({ ...a, erstelltAt: new Date(a.erstelltAt) }));
  const tage = [...b.summen.vorher.tageswerte, ...b.summen.aktuell.tageswerte];
  const weeks = new Map<string, string[]>();
  for (const t of tage) { const w = isoWoche(t.tag); weeks.set(w, [...(weeks.get(w) ?? []), t.tag]); }
  for (const [woche, days] of weeks) {
    const unique = [...new Set(days)].sort(), von = unique[0], bis = unique.at(-1)!;
    const covered = new Set(unique);
    const teil = werteVerbrauchAus(jobs.filter(a => a.parentId || covered.has(a.gestartetAt.toISOString().slice(0,10))),
      calls.filter(c => covered.has(c.gestartetAt.toISOString().slice(0,10))), reviews, von, bis, new Date(b.stand));
    add({ art: 'kalenderwoche', woche, zeitzone: 'UTC', von, bis, abgedeckteTage: unique,
      vollstaendig: unique.length === 7 && teil.zeitraum.vollstaendig,
      bereiche: teil.bereiche, abdeckung: teil.abdeckung,
      live: tage.filter(t => t.tag >= von && t.tag <= bis).map(t => ({ tag: t.tag, sekunden: t.liveSekunden,
        sitzungen: t.liveSitzungen, ohneMesswert: t.liveOhneMesswert, offen: t.liveOffen })),
      hinweis: 'Nur Archivfenster; fehlende Wochentage bleiben fehlend. Texttokens und Live-Sekunden getrennt. Keine Effizienzbewertung aus Wochensummen.' });
  }
  return rows;
}
