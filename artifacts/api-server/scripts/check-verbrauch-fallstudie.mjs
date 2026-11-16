import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'lukas-fallstudie-'));
try {
 const file=join(dir,'test.mjs');
 await build({stdin:{contents:`export * from './src/lib/verbrauch-auswertung';export * from './src/lib/verbrauch-methodik';export * from './src/lib/verbrauch-zeitraum';export * from './src/lib/verbrauch-log';`,resolveDir:process.cwd()},outfile:file,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
 const m=await import(file), now=new Date('2026-11-14T13:00:00Z');
 const z=m.verbrauchsZeitraum({},now);assert.equal(z.von,'2026-11-07');assert.equal(z.bis,'2026-11-13');assert.equal(z.vergleichVon,'2026-10-31');assert.equal(z.vergleichBis,'2026-11-06');
 for(const v of [{von:'2026-02-30',bis:'2026-03-01'},{von:'2026-11-15',bis:'2026-11-16'},{von:'2026-11-01'},{von:['2026-11-01'],bis:'2026-11-07'},{von:'2026-01-01',bis:'2026-11-07'}]) assert.throws(()=>m.verbrauchsZeitraum(v,now),RangeError);
 assert.equal(m.verbrauchsZeitraum({von:'2026-10-24',bis:'2026-11-06'},now).tage,14);
 assert.equal(m.verbrauchsZeitraum({von:'2026-10-24',bis:'2026-11-06'},now).vergleichVon,'2026-10-10');
 assert.equal(m.verbrauchsZeitraum({von:'2026-11-14',bis:'2026-11-14'},now).vollstaendig,false);
 const custom=m.verbrauchsZeitraum({von:'2026-11-13',bis:'2026-11-13',vergleichVon:'2026-11-07',vergleichBis:'2026-11-07'},now);assert.equal(custom.vergleichVon,'2026-11-07');
 assert.throws(()=>m.verbrauchsZeitraum({von:'2026-11-13',bis:'2026-11-13',vergleichVon:'2026-11-13',vergleichBis:'2026-11-13'},now));
 assert.throws(()=>m.verbrauchsZeitraum({von:'2026-11-12',bis:'2026-11-13',vergleichVon:'2026-11-07',vergleichBis:'2026-11-07'},now));
 assert.equal(m.aufgabenart('Prüfe das Repository und Code'),'coding');assert.equal(m.aufgabenart('SEO für Hareb'),'analyse');
 assert.throws(()=>m.pruefeFallstudie({serie:'x',fall:'y'}));
 assert.deepEqual(m.usageBeleg({input_tokens:100,output_tokens:4,output_tokens_details:{reasoning_tokens:2},secret:'no',prompt:'no'}),{input_tokens:100,output_tokens:4,output_tokens_details:{reasoning_tokens:2}});
 let jobs=[],calls=[],accept=[];
 function sample(id,date,tokens,quelle='chat',kind='coding') {
  jobs.push({id,rootId:id,parentId:null,quelle,status:'antwort',gestartetAt:new Date(date+'T10:00:00Z'),beendetAt:new Date(date+'T10:01:00Z'),messung:{version:2,revision:'a',aufgabenart:kind,promptHash:'same-user-prompt',fallstudie:{serie:'case-v1',fall:'fix-1',abnahme:'same acceptance'}}});
  calls.push({id:'c-'+id,rootId:id,auftragId:id,quelle,phase:'start',status:'ok',provider:'openai',model:'test',eingabe:tokens-20,ausgabe:10,cacheLesen:10,cacheSchreiben:null,dauerMs:100,gestartetAt:new Date(date+'T10:00:01Z'),nachweis:{version:2}});
  accept.push({id:'a-'+id,rootId:id,ergebnis:'erfolgreich',beleg:'test log sha256:example',pruefer:'independent-runner',erstelltAt:new Date(date+'T11:00:00Z')});
 }
 for(let i=0;i<3;i++){sample('old'+i,'2026-11-05',100);sample('new'+i,'2026-11-12',70);}
 const report=(from,to)=>m.werteVerbrauchAus(jobs,calls,accept,from,to,now);
 const compare=()=>m.vergleicheVerbrauch(report('2026-11-07','2026-11-13'),report('2026-10-31','2026-11-06'));
 let r=compare();assert.equal(r.length,1);assert.equal(r[0].bewertung,'besser');assert.equal(Math.round(r[0].aenderungProzent),-30);
 sample('phone','2026-11-12',10000,'telefon');r=compare();assert.equal(r.length,2);assert.equal(r.find(r=>r.kanal==='telefon').bewertung,'nicht_belastbar');assert.equal(r.find(r=>r.kanal==='chat').bewertung,'besser');
 jobs.push({...jobs.find(j=>j.id==='new0'),id:'child',parentId:'new0',rootId:'new0'});
 calls.push({...calls.find(c=>c.rootId==='new0'),id:'child-call',auftragId:'child',eingabe:400,ausgabe:0,cacheLesen:0,status:'fehler',phase:'fallback'});
 assert.equal(compare().find(r=>r.kanal==='chat').bewertung,'schlechter');
 const newGroup=report('2026-11-07','2026-11-13').gruppen.find(g=>g.kanal==='chat');assert.equal(newGroup.tokens,610);assert.equal(newGroup.auftraege,3);
 const childCall=calls.at(-1);childCall.eingabe=null;assert.equal(compare().find(r=>r.kanal==='chat').bewertung,'nicht_belastbar');childCall.eingabe=400;
 accept=accept.filter(a=>a.rootId!=='new0');assert.equal(compare().find(r=>r.kanal==='chat').bewertung,'nicht_belastbar');
 accept.push({id:'latest',rootId:'new0',ergebnis:'fehlgeschlagen',beleg:'assertion failed',pruefer:'tester',erstelltAt:now});assert.equal(compare().find(r=>r.kanal==='chat').bewertung,'schlechter');
 jobs.find(j=>j.id==='new0').beendetAt=new Date('2026-11-14T10:00:00Z');assert.equal(compare().find(r=>r.kanal==='chat').bewertung,'nicht_belastbar');
 assert.equal(m.aufrufGemessen({...calls[0],provider:'anthropic',cacheSchreiben:null}),false);assert.equal(m.aufrufGemessen(calls[0]),true);
 assert.equal(m.belegHash({a:1,b:{c:2,d:3}}),m.belegHash({b:{d:3,c:2},a:1}));
 assert.notEqual(m.belegHash({rows:calls}),m.belegHash({rows:calls.slice(1)}));
 // The connector-readable view must survive JSONB date serialization, identify
 // matched cases, count failed child attempts and retain exactly one proof.
 const current=report('2026-11-07','2026-11-13'),previous=report('2026-10-31','2026-11-06');
 const dates=Array.from({length:14},(_,i)=>new Date(Date.UTC(2026,9,31+i)).toISOString().slice(0,10));
 const daily=dates.map(tag=>({tag,liveSekunden:tag==='2026-11-12'?90:0,liveSitzungen:tag==='2026-11-12'?1:0,liveOhneMesswert:0,liveOffen:0}));
 const payload={version:2,stand:now.toISOString(),revision:'synthetic-revision',methodik:m.METHODIK,aktuell:current,vorher:previous,vergleich:m.vergleicheVerbrauch(current,previous),summen:{aktuell:{tageswerte:daily.slice(7)},vorher:{tageswerte:daily.slice(0,7)}},abgleich:{},quellen:{auftraege:jobs,aufrufe:calls,abnahmen:accept}};
 const proof=m.belegHash(payload),archived=JSON.parse(JSON.stringify({...payload,nachweis:{sha256:proof}}));
 const basis={berichtId:'synthetic-only',sha256:proof,stand:payload.stand,version:2};
 const logs=m.archivLogDaten(basis,archived);
 assert.ok(logs.every(l=>l.sha256===proof&&l.berichtId===basis.berichtId&&l.stand===basis.stand));
 assert.equal(logs.find(l=>l.art==='gesamt').revision,'synthetic-revision');
 const comparison=logs.find(l=>l.art==='vergleich'&&l.kanal==='chat');
 assert.equal(comparison.serie,'case-v1');assert.equal(comparison.fall,'fix-1');assert.match(comparison.fallSchluessel,/^[a-f0-9]{64}$/);
 assert.equal(comparison.aktuell.tokens,610);assert.equal(comparison.aktuell.tokensJeErfolg,null);
 assert.ok(!JSON.stringify(logs).includes('same acceptance')&&!JSON.stringify(logs).includes('assertion failed'),'criteria and review references stay private');
 const week=logs.find(l=>l.art==='kalenderwoche'&&l.woche==='2026-KW46');
 assert.equal(week.vollstaendig,false);assert.equal(week.bis,'2026-11-13');
 assert.equal(week.bereiche.filter(b=>b.kanal==='chat').reduce((s,b)=>s+b.gesamt,0),610);
 assert.equal(week.bereiche.filter(b=>b.kanal==='telefon').reduce((s,b)=>s+b.gesamt,0),10000);
 assert.equal(week.bereiche.reduce((s,b)=>s+b.fehler,0),1);assert.equal(week.bereiche.reduce((s,b)=>s+b.fallback,0),1);
 assert.equal(week.live.reduce((s,l)=>s+l.sekunden,0),90,'live seconds never become tokens');
 assert.throws(()=>m.archivLogDaten({...basis,sha256:'wrong'},archived),/SHA-256/);
 archived.revision='tampered';assert.throws(()=>m.archivLogDaten(basis,archived),/SHA-256/);
 const stub=join(dir,'logger.mjs');await writeFile(stub,'export const logger={error(){}}');
 const authFile=join(dir,'auth.mjs');await build({entryPoints:['src/middlewares/auth.ts'],outfile:authFile,bundle:true,platform:'node',format:'esm',plugins:[{name:'logger-stub',setup(b){b.onResolve({filter:/lib\/logger$/},()=>({path:stub}));}}],logLevel:'silent'});
 const {lukasAuth}=await import(authFile);process.env.LUKAS_API_TOKEN='owner-test';process.env.LUKAS_USAGE_READ_TOKEN='reader-test';
 const authorize=(method,path,token)=>{let allowed=false,status=0;lukasAuth({method,path,headers:{authorization:`Bearer ${token}`}},{status(n){status=n;return this},json(){}},()=>allowed=true);return {allowed,status};};
 assert.equal(authorize('GET','/lukas/verbrauch/fallstudie','reader-test').allowed,true);
 assert.equal(authorize('GET','/lukas/verbrauch/archiv/usage-v2-2026-11-15','reader-test').allowed,true);
 for(const path of ['/lukas/verbrauch/archiv/other','/lukas/verbrauch/archiv/usage-v2-2026-11-15/extra'])assert.equal(authorize('GET',path,'reader-test').allowed,false);
 for(const [method,path] of [['POST','/anthropic/conversations'],['POST','/lukas/verbrauch/auftraege/id/abnahme'],['GET','/lukas/verbrauch/fallstudie/extra'],['PUT','/lukas/verbrauch']]) assert.equal(authorize(method,path,'reader-test').allowed,false);
 assert.equal(authorize('POST','/anthropic/conversations','owner-test').allowed,true);
 console.log('PASS fallstudie: ranges, matched cases, channel separation, failed work, child accounting, missing receipts, quality and scoped auth');
}finally{await rm(dir,{recursive:true,force:true});}
