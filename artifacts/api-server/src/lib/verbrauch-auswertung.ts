import { createHash } from 'node:crypto';
import { METHODIK } from './verbrauch-methodik';
import { verbrauchsZeitraum } from './verbrauch-zeitraum';
type Messung = { version: number; revision: string | null; aufgabenart: string; promptHash?: string; fallstudie?: { serie: string; fall: string; abnahme: string } };
export type Auftrag = { id: string; rootId: string; parentId: string | null; quelle: string; status: string; gestartetAt: Date; beendetAt: Date | null; messung: Messung | null };
export type Aufruf = { id: string; rootId: string; auftragId: string; provider: string; model: string; quelle: string; phase: string; status: string; eingabe: number | null; ausgabe: number | null; cacheLesen: number | null; cacheSchreiben: number | null; dauerMs: number; gestartetAt: Date; nachweis: { version: number; profil?: string; nurBeleg?: boolean } | null; kontext?: unknown };
export type Abnahme = { id: string; rootId: string; ergebnis: string; beleg: string; pruefer: string; erstelltAt: Date };
export function belegSerialisierung(value: unknown): string {
  return JSON.stringify(value,(_key,v)=>v && typeof v==='object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
}
export function belegHash(value: unknown): string { return createHash('sha256').update(belegSerialisierung(value)).digest('hex'); }
export function aufrufGemessen(c: Aufruf): boolean {
  return [c.eingabe,c.ausgabe,c.cacheLesen].every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0) &&
    (c.provider === 'openai' || (typeof c.cacheSchreiben === 'number' && Number.isFinite(c.cacheSchreiben) && c.cacheSchreiben >= 0));
}
const gesamt = (c: Aufruf) => (c.eingabe ?? 0) + (c.ausgabe ?? 0) + (c.cacheLesen ?? 0) + (c.cacheSchreiben ?? 0);
const median = (xs: number[]) => { const a = [...xs].sort((a,b)=>a-b); return a.length ? (a[Math.floor((a.length-1)/2)] + a[Math.floor(a.length/2)]) / 2 : null; };
export function werteVerbrauchAus(auftraege: Auftrag[], aufrufe: Aufruf[], abnahmen: Abnahme[], von: string, bis: string, jetzt = new Date()) {
  const z = verbrauchsZeitraum({von,bis},jetzt);
  const calls = aufrufe.filter(c => c.gestartetAt >= z.seit && c.gestartetAt < z.bisExklusiv);
  const roots = auftraege.filter(a => !a.parentId && a.gestartetAt >= z.seit && a.gestartetAt < z.bisExklusiv);
  const jobsById = new Map(auftraege.map(a => [a.id,a]));
  const rows = new Map<string, { kanal: string; aufgabenart: string; model: string; provider: string; phase: string; aufrufe: number; gemessen: number; ohneMesswert: number; eingabe: number; ausgabe: number; cacheLesen: number; cacheSchreiben: number; gesamt: number; fehler: number; fallback: number; ms: number }>();
  for (const c of calls) {
    const kind = jobsById.get(c.auftragId)?.messung?.aufgabenart ?? 'unbekannt';
    const key = JSON.stringify([c.quelle,kind,c.provider,c.model,c.phase]);
    const r = rows.get(key) ?? { kanal: c.quelle, aufgabenart: kind, model: c.model, provider: c.provider, phase: c.phase, aufrufe: 0, gemessen: 0, ohneMesswert: 0, eingabe: 0, ausgabe: 0, cacheLesen: 0, cacheSchreiben: 0, gesamt: 0, fehler: 0, fallback: 0, ms: 0 };
    r.aufrufe++; r.fehler += Number(c.status !== 'ok'); r.fallback += Number(c.phase === 'fallback'); r.ms += c.dauerMs;
    if (aufrufGemessen(c)) { r.gemessen++; r.eingabe += c.eingabe!; r.ausgabe += c.ausgabe!; r.cacheLesen += c.cacheLesen!; r.cacheSchreiben += c.cacheSchreiben ?? 0; r.gesamt += gesamt(c); }
    else r.ohneMesswert++;
    rows.set(key,r);
  }
  const callsByRoot = new Map<string, Aufruf[]>(), childrenByRoot = new Map<string, Auftrag[]>(), reviewsByRoot = new Map<string, Abnahme>();
  for(const c of aufrufe) callsByRoot.set(c.rootId,[...(callsByRoot.get(c.rootId) ?? []),c]);
  for(const a of auftraege) childrenByRoot.set(a.rootId,[...(childrenByRoot.get(a.rootId) ?? []),a]);
  for(const r of abnahmen) {
    if(r.erstelltAt>jetzt) continue;
    const old=reviewsByRoot.get(r.rootId);
    if(!old || r.erstelltAt>old.erstelltAt || (r.erstelltAt.getTime()===old.erstelltAt.getTime() && r.id>old.id)) reviewsByRoot.set(r.rootId,r);
  }
  const details = roots.map(a => {
    const cs = callsByRoot.get(a.id) ?? [];
    // Acceptance known at this snapshot. Archived reports keep their original acceptance state.
    const abnahme = reviewsByRoot.get(a.id) ?? null;
    const children = childrenByRoot.get(a.id) ?? [];
    const abgeschlossen = Boolean(a.beendetAt && a.beendetAt <= z.bisExklusiv && children.every(c => c.beendetAt && c.beendetAt <= z.bisExklusiv));
    const vollGemessen = cs.length > 0 && cs.every(c => aufrufGemessen(c) && c.nachweis?.version === 2 && !c.nachweis.nurBeleg && c.gestartetAt >= z.seit && c.gestartetAt < z.bisExklusiv);
    return { ...a, aufrufIds: cs.map(c=>c.id).sort(), gesamt: cs.filter(aufrufGemessen).reduce((s,c)=>s+gesamt(c),0), ohneMesswert: cs.filter(c=>!aufrufGemessen(c)).length,
      abgeschlossen, vollGemessen, abnahme, modelle: [...new Set(cs.map(c=>`${c.provider}:${c.model}`))].sort(),
      dauerMs: a.beendetAt ? a.beendetAt.getTime()-a.gestartetAt.getTime() : null };
  });
  const groups = new Map<string, typeof details>();
  for (const a of details) {
    const f = a.messung?.fallstudie;
    const key = JSON.stringify([a.quelle,a.messung?.aufgabenart ?? 'unbekannt',f?.serie ?? null,f?.fall ?? null,f?.abnahme ?? null,a.messung?.promptHash ?? null]);
    groups.set(key,[...(groups.get(key) ?? []),a]);
  }
  const gruppen = [...groups].map(([key,as]) => {
    const a = as[0]; const f = a.messung?.fallstudie;
    const bestaetigt = as.filter(a=>a.abnahme?.ergebnis === 'erfolgreich').length;
    const geprueft = as.filter(a=>a.abnahme).length;
    const tokens = as.reduce((s,a)=>s+a.gesamt,0);
    const vollstaendig = as.every(a=>a.abgeschlossen && a.vollGemessen && a.abnahme);
    return { key, kanal: a.quelle, aufgabenart: a.messung?.aufgabenart ?? 'unbekannt', serie: f?.serie ?? null, fall: f?.fall ?? null,
      abnahme: f?.abnahme ?? null, auftraege: as.length, bestaetigt, geprueft, vollstaendig,
      kontrollierterFall: Boolean(f && a.messung?.promptHash), tokens, tokensJeErfolg: bestaetigt && vollstaendig ? tokens/bestaetigt : null,
      erfolgsquote: geprueft ? bestaetigt/geprueft : null, medianDauerMs: median(as.map(a=>a.dauerMs).filter((x): x is number=>x!==null)),
      modelle: [...new Set(as.flatMap(a=>a.modelle))].sort(), auftragIds: as.map(a=>a.id).sort() };
  });
  return { zeitraum: z, bereiche: [...rows.values()].sort((a,b)=>b.gesamt-a.gesamt), gruppen, auftraege: details,
    abdeckung: { aufrufe: calls.length, gemessen: calls.filter(aufrufGemessen).length, ohneMesswert: calls.filter(c=>!aufrufGemessen(c)).length,
      ohneAuftrag: calls.filter(c=>!jobsById.has(c.auftragId)).length, ohneNachweis: calls.filter(c=>c.nachweis?.version!==2).length,
      nurBeleg: calls.filter(c=>c.nachweis?.nurBeleg).length, auftraege: roots.length, abgenommen: details.filter(a=>a.abnahme).length,
      nichtAbgeschlossen: details.filter(a=>!a.abgeschlossen).length }, methodik: METHODIK };
}
export function vergleicheVerbrauch(aktuell: ReturnType<typeof werteVerbrauchAus>, vorher: ReturnType<typeof werteVerbrauchAus>) {
  const keys = [...new Set([...aktuell.gruppen,...vorher.gruppen].map(g=>g.key))];
  return keys.map(key => {
    const neu = aktuell.gruppen.find(g=>g.key===key) ?? null, alt = vorher.gruppen.find(g=>g.key===key) ?? null;
    const gruende: string[] = [];
    if (!neu || !alt) gruende.push('Gleicher Fall fehlt in einem Zeitraum.');
    if (!aktuell.zeitraum.vollstaendig || !vorher.zeitraum.vollstaendig) gruende.push('Laufender UTC-Tag im Vergleich.');
    if (!neu?.kontrollierterFall || !alt?.kontrollierterFall) gruende.push('Keine vorab definierte identische Aufgabe mit Abnahmekriterium.');
    if (!neu?.vollstaendig || !alt?.vollstaendig) gruende.push('Offene Aufträge, fehlende Providerwerte oder fehlende Abnahme.');
    if ((neu?.auftraege ?? 0)<3 || (alt?.auftraege ?? 0)<3) gruende.push('Weniger als drei Wiederholungen je Zeitraum.');
    if (!neu?.bestaetigt || !alt?.bestaetigt) gruende.push('Kein bestätigter Erfolg in mindestens einem Zeitraum.');
    const delta = neu?.tokensJeErfolg != null && alt?.tokensJeErfolg != null && alt.tokensJeErfolg>0 ? (neu.tokensJeErfolg/alt.tokensJeErfolg-1)*100 : null;
    let bewertung = 'nicht_belastbar';
    if (!gruende.length && delta !== null) {
      if (neu!.erfolgsquote! < alt!.erfolgsquote!) { bewertung='schlechter'; gruende.push('Niedrigere Erfolgsquote trotz gleicher Abnahme.'); }
      else bewertung = delta < -5 ? 'besser' : delta > 5 ? 'schlechter' : 'aehnlich';
    }
    return { key, kanal: (neu??alt)!.kanal, aufgabenart:(neu??alt)!.aufgabenart, serie:(neu??alt)!.serie, fall:(neu??alt)!.fall,
      bewertung, gruende, aenderungProzent: delta, aktuell:neu, vorher:alt,
      aussage: 'Beobachtung für diese geprüften Fälle, keine kausale oder allgemeine Kosteneinsparung. ±5 % ist eine deskriptive Toleranz, kein Signifikanztest.' };
  });
}
