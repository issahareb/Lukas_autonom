import { useCallback, useEffect, useState } from 'react';
const BASE = import.meta.env.BASE_URL.replace(/\/$/,'');
const headers = () => ({Authorization:`Bearer ${localStorage.getItem('lukas_token') ?? ''}`});
const zahl = (n:number|null) => n===null ? 'Nicht belegt' : n.toLocaleString('de-DE',{maximumFractionDigits:1});
type Bericht = {
  stand:string; nachweis:{sha256:string}; methodik:{grenzen:string[]};
  aktuell:{zeitraum:{von:string;bis:string};abdeckung:{aufrufe:number;gemessen:number;ohneMesswert:number;abgenommen:number;auftraege:number;nurBeleg:number};bereiche:{kanal:string;aufgabenart:string;model:string;phase:string;denkaufwand?:string;serviceTierAngefordert?:string;serviceTierGemeldet?:string;aufrufe:number;gesamt:number;ohneMesswert:number}[]};
  vorher:{zeitraum:{von:string;bis:string}};
  vergleich:{key:string;kanal:string;aufgabenart:string;fall:string|null;bewertung:string;aenderungProzent:number|null;gruende:string[];aktuell:{tokensJeErfolg:number|null}|null;vorher:{tokensJeErfolg:number|null}|null}[];
  abgleich:{aktuell:{passt:boolean;differenz:number};vorher:{passt:boolean;differenz:number}};
};
const urteil:Record<string,string>={besser:'Besser in diesen Testfällen',schlechter:'Schlechter in diesen Testfällen',aehnlich:'Ähnlich (±5 %)',nicht_belastbar:'Noch nicht belastbar'};
export default function VerbrauchFallstudie() {
  const [daten,setDaten]=useState<Bericht|null>(null),[fehler,setFehler]=useState('');
  const [von,setVon]=useState(''),[bis,setBis]=useState(''),[vergleichVon,setVergleichVon]=useState(''),[vergleichBis,setVergleichBis]=useState(''),[busy,setBusy]=useState(false);
  const laden=useCallback(async(von='',bis='',vergleichVon='',vergleichBis='')=>{
    setBusy(true);
    try {
      const params=new URLSearchParams(); if(von||bis){params.set('von',von);params.set('bis',bis);} if(vergleichVon||vergleichBis){params.set('vergleichVon',vergleichVon);params.set('vergleichBis',vergleichBis);}
      const r=await fetch(`${BASE}/api/lukas/verbrauch/fallstudie${params.size?'?'+params:''}`,{headers:headers()});
      if(!r.ok) throw new Error(r.status===400?'Bitte gültigen Zeitraum von 1 bis 90 UTC-Tagen angeben.':'Fallstudie konnte nicht geladen werden.');
      const b=await r.json(); if(!b.nachweis?.sha256||!Array.isArray(b.aktuell?.bereiche)) throw new Error('Unvollständige Antwort.');
      setDaten(b);setFehler('');
    } catch(e){setFehler(e instanceof Error?e.message:'Abruf fehlgeschlagen.');}
    finally{setBusy(false);}
  },[]);
  useEffect(()=>{void laden();},[laden]);
  const exportieren=async()=>{
    if(!daten)return;
    // Fetch the same selected range again, including raw receipts. Display identifies the snapshot actually exported.
    try {
      const params=new URLSearchParams({von:daten.aktuell.zeitraum.von,bis:daten.aktuell.zeitraum.bis,vergleichVon:daten.vorher.zeitraum.von,vergleichBis:daten.vorher.zeitraum.bis});
      const r=await fetch(`${BASE}/api/lukas/verbrauch/fallstudie?${params}`,{headers:headers()});if(!r.ok)throw new Error();
      const b=await r.json();setDaten(b);
      const url=URL.createObjectURL(new Blob([JSON.stringify(b,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=`LUKAS-Fallstudie-${b.aktuell.zeitraum.von}-${b.aktuell.zeitraum.bis}.json`;a.click();URL.revokeObjectURL(url);
    }catch{setFehler('Belegexport fehlgeschlagen.');}
  };
  return <div className="card-soft rounded-3xl p-5 space-y-4" aria-label="Token-Fallstudie">
    <h3 className="font-semibold">Wird Lukas effizienter?</h3>
    <p className="text-sm text-muted-foreground">Vergleich gleicher Aufgaben mit bestätigtem Ergebnis. Telefonie, Coding und Hintergrundarbeit bleiben getrennt. Standard: letzte sieben abgeschlossene UTC-Tage gegen die sieben davor.</p>
    <form className="flex flex-wrap gap-3 items-end" onSubmit={e=>{e.preventDefault();void laden(von,bis,vergleichVon,vergleichBis);}}>
      <label className="text-sm">Von (UTC)<input type="date" aria-label="Fallstudie von" value={von} onChange={e=>setVon(e.target.value)} className="mt-1 block rounded-xl border bg-background p-2"/></label>
      <label className="text-sm">Bis (UTC)<input type="date" aria-label="Fallstudie bis" value={bis} onChange={e=>setBis(e.target.value)} className="mt-1 block rounded-xl border bg-background p-2"/></label>
      <details className="w-full"><summary className="cursor-pointer text-xs">Eigenen Basiszeitraum wählen</summary><div className="mt-2 flex flex-wrap gap-3">
        <label className="text-sm">Basis von (UTC)<input type="date" aria-label="Basis von" value={vergleichVon} onChange={e=>setVergleichVon(e.target.value)} className="mt-1 block rounded-xl border bg-background p-2"/></label>
        <label className="text-sm">Basis bis (UTC)<input type="date" aria-label="Basis bis" value={vergleichBis} onChange={e=>setVergleichBis(e.target.value)} className="mt-1 block rounded-xl border bg-background p-2"/></label>
      </div></details>
      <button disabled={busy} className="rounded-full border px-4 py-2 text-sm">{busy?'Lädt …':'Vergleichen'}</button>
    </form>
    {fehler&&<p role="alert" className="text-sm text-amber-400">{fehler} {daten?'Die vorherigen Werte bleiben angezeigt.':''}</p>}
    {daten&&<>
      <p className="text-sm">{daten.aktuell.zeitraum.von} bis {daten.aktuell.zeitraum.bis} gegen {daten.vorher.zeitraum.von} bis {daten.vorher.zeitraum.bis}</p>
      <p className="text-sm">{zahl(daten.aktuell.abdeckung.gemessen)} von {zahl(daten.aktuell.abdeckung.aufrufe)} Aufrufen mit vollständigen Tokenwerten · {zahl(daten.aktuell.abdeckung.abgenommen)} von {zahl(daten.aktuell.abdeckung.auftraege)} Aufträgen abgenommen.</p>
      {daten.aktuell.abdeckung.ohneMesswert>0&&<p className="text-sm text-amber-400">{daten.aktuell.abdeckung.ohneMesswert} Aufrufe ohne vollständigen Nutzungsbeleg. Ihre Kosten sind unbekannt.</p>}
      {(!daten.abgleich.aktuell.passt||!daten.abgleich.vorher.passt)&&<p className="text-sm text-amber-400">Tagesaggregate und Einzelbelege stimmen nicht vollständig überein. Historische oder fehlende Belege sind im Export erkennbar.</p>}
      {daten.vergleich.length?daten.vergleich.map(v=><div key={v.key} className="border-t pt-3 text-sm space-y-1">
        <p className="font-medium">{v.kanal} · {v.aufgabenart}{v.fall?` · ${v.fall}`:''}: {urteil[v.bewertung]??v.bewertung}</p>
        <p>Tokens je bestätigtem Erfolg, inklusive Fehlversuchen: {zahl(v.vorher?.tokensJeErfolg??null)} → {zahl(v.aktuell?.tokensJeErfolg??null)}</p>
        {v.aenderungProzent!==null&&<p>Beobachtete Änderung: {zahl(v.aenderungProzent)} %</p>}
        {v.gruende.map(g=><p key={g} className="text-xs text-muted-foreground">{g}</p>)}
      </div>):<p className="text-sm">Noch keine vergleichbaren Aufträge vorhanden.</p>}
      <details><summary className="cursor-pointer text-sm">Verbrauch nach Aufgabenart und Phase</summary><div className="overflow-x-auto mt-3"><table className="text-left text-xs w-full"><thead><tr>{['Kanal / Aufgabe','Modell / Phase','Denken / Verarbeitung','Aufrufe','Gemessene Tokens','Ohne Beleg'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{daten.aktuell.bereiche.map((r,i)=><tr key={i} className="border-t"><td className="p-2">{r.kanal} · {r.aufgabenart}</td><td className="p-2">{r.model} · {r.phase}</td><td className="p-2">{r.denkaufwand??'unbekannt'} · {r.serviceTierAngefordert??'unbekannt'} → {r.serviceTierGemeldet??'unbekannt'}</td><td className="p-2">{zahl(r.aufrufe)}</td><td className="p-2">{zahl(r.gesamt)}</td><td className="p-2">{zahl(r.ohneMesswert)}</td></tr>)}</tbody></table></div></details>
      <details><summary className="cursor-pointer text-sm">Was die Messung belegt</summary><p className="mt-2 text-xs text-muted-foreground">Die Bewertung gilt für wiederholte identische Testfälle. Sie beweist keine kausale Einsparung im gesamten Betrieb. Kontextgrößen werden in Zeichen gemessen, nicht in erfundenen Tokenanteilen.</p>{daten.methodik.grenzen.map(g=><p key={g} className="mt-2 text-xs text-muted-foreground">{g}</p>)}</details>
      <button type="button" onClick={exportieren} className="rounded-full border px-4 py-2 text-sm">Rohbelege als JSON exportieren</button>
      <p className="text-xs text-muted-foreground break-all">Beleg SHA-256: {daten.nachweis.sha256} · Stand {new Date(daten.stand).toLocaleString('de-DE')}</p>
    </>}
  </div>;
}
