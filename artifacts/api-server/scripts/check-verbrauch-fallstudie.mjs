import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'lukas-fallstudie-'));
try {
 const file=join(dir,'test.mjs');
 await build({stdin:{contents:`export * from './src/lib/verbrauch-auswertung';export * from './src/lib/verbrauch-methodik';export * from './src/lib/verbrauch-zeitraum';`,resolveDir:process.cwd()},outfile:file,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
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
 const stub=join(dir,'logger.mjs');await writeFile(stub,'export const logger={error(){}}');
 const authFile=join(dir,'auth.mjs');await build({entryPoints:['src/middlewares/auth.ts'],outfile:authFile,bundle:true,platform:'node',format:'esm',plugins:[{name:'logger-stub',setup(b){b.onResolve({filter:/lib\/logger$/},()=>({path:stub}));}}],logLevel:'silent'});
 const {lukasAuth}=await import(authFile);process.env.LUKAS_API_TOKEN='owner-test';process.env.LUKAS_USAGE_READ_TOKEN='reader-test';
 const authorize=(method,path,token)=>{let allowed=false,status=0;lukasAuth({method,path,headers:{authorization:`Bearer ${token}`}},{status(n){status=n;return this},json(){}},()=>allowed=true);return {allowed,status};};
 assert.equal(authorize('GET','/lukas/verbrauch/fallstudie','reader-test').allowed,true);
 for(const [method,path] of [['POST','/anthropic/conversations'],['POST','/lukas/verbrauch/auftraege/id/abnahme'],['GET','/lukas/verbrauch/fallstudie/extra'],['PUT','/lukas/verbrauch']]) assert.equal(authorize(method,path,'reader-test').allowed,false);
 assert.equal(authorize('POST','/anthropic/conversations','owner-test').allowed,true);
 console.log('PASS fallstudie: ranges, matched cases, channel separation, failed work, child accounting, missing receipts, quality and scoped auth');
}finally{await rm(dir,{recursive:true,force:true});}
