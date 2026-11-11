import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const directory = await mkdtemp(join(tmpdir(), 'phone-enquiries-'));
const rows = new Map(), mails = [], writes = [], acknowledgements = [];
let summary, modelFails = false, failSave = false, modelCalls = 0;
const base = { kategorie:'anfrage', weitergabe:'erlaubt', zusammenfassung:'Website mit Terminbuchung gewünscht.', name:'Muster', unternehmen:'Testfirma', leistungen:'Webdesign', wuensche:'Terminbuchung', website:'', zeitrahmen:'November', budget:'', rueckruf:'Auf der Anrufnummer', email:'', offeneFragen:'' };
globalThis.__enquiry = {
  async model(input) { modelCalls++; assert.deepEqual(input.tools, []); assert.equal(input.quelle, 'telefon'); if(modelFails) throw Error('unavailable'); return {content:JSON.stringify(summary)}; },
  async mail(...args) { mails.push(args); },
  async query(sql, args) {
    writes.push({sql,args});
    if(sql.includes('INSERT INTO')) { if(!rows.has(args[0])) rows.set(args[0], {id:rows.size+1,nummer:args[2],created_at:new Date(),email_status:'ausstehend'}); }
    const row = rows.get(args[0]);
    if(sql.includes('SET kategorie')) {
      if(failSave) { failSave=false; throw Error('temporary'); }
      Object.assign(row, {kategorie:args[1],weitergabe:args[2],zusammenfassung:args[3],details:args[4],revision:args[5],auswertung:args[6],complete:args[7]});
    }
    if(sql.includes("email_status='sendet'")) {
      if(row.email_status === 'ausstehend' && row.kategorie === 'anfrage' && row.weitergabe === 'erlaubt' && row.auswertung === 'fertig') {row.email_status='sendet';return {rows:[row],rowCount:1};}
      return {rows:[],rowCount:0};
    }
    if(sql.includes("email_status='akzeptiert'")) row.email_status='akzeptiert';
    if(sql.includes("auswertung='fehler'")) row.auswertung='fehler';
    return {rows:[],rowCount:1};
  }
};
try {
  const outfile=join(directory,'enquiry.mjs');
  await build({entryPoints:['src/lib/telefon-anfragen.ts'],outfile,bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'isolated-business-adapters',setup(b){
    b.onResolve({filter:/^(?:@workspace\/db|\.\/ai\/model-client|\.\/ai\/model-router|\.\/email|\.?\.\/logger)$/},args=>({path:args.path,namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},args=>({loader:'js',contents:args.path==='@workspace/db'?'export const pool={query:(...a)=>globalThis.__enquiry.query(...a)};':args.path.endsWith('model-client')?'export const callLukasModel=(...a)=>globalThis.__enquiry.model(...a);':args.path.endsWith('model-router')?'export const directRoute=()=>({model:"mock"});':args.path.endsWith('email')?'export const sendEmail=(...a)=>globalThis.__enquiry.mail(...a);':'export const logger={info(){},warn(){},error(){}};'}));
  }}]});
  const {preparePhoneEnquiry}=await import(pathToFileURL(outfile).href);
  summary={...base};
  const a=await preparePhoneEnquiry('call-a','4915100000001','context-a',x=>acknowledgements.push(x));
  const fragment={role:'user',text:'Ich möchte eine Website. Bitte weiterleiten.',startMs:0,endMs:1000};
  a.observe(fragment);a.observe(fragment);
  failSave=true; await a.flush(false);
  assert.equal(rows.get('call-a').revision,1,'replayed transcript fragments are deduplicated');
  assert.equal(acknowledgements.length,1,'only confirmed save gets acknowledgement');
  summary={...base,budget:'2000 Euro',wuensche:'Terminbuchung und Kontaktformular'};
  a.observe({...fragment,text:'Mein Budget ist 2000 Euro.',startMs:1001,endMs:2000});
  await Promise.all([a.close(),a.close()]);
  assert.equal(mails.length,1,'duplicate close cannot send twice');
  assert.equal(mails[0][0],'info@hareb.digital','fixed owner recipient');
  assert.equal(JSON.parse(rows.get('call-a').details).budget,'2000 Euro');
  assert.equal(rows.get('call-a').nummer,'4915100000001');
  assert.equal(rows.get('call-a').auswertung,'fertig');
  assert.ok(!JSON.stringify(writes).includes(fragment.text),'raw transcript never persisted');
  const b=await preparePhoneEnquiry('call-b','','context-b',()=>{});
  summary={...base,weitergabe:'abgelehnt',zusammenfassung:'DO_NOT_RETAIN',name:'DO_NOT_RETAIN'};
  b.observe(fragment); await b.close();
  assert.equal(rows.get('call-b').nummer,'','anonymous caller never gets a fabricated number');
  assert.equal(rows.get('call-b').details,'{}'); assert.equal(rows.get('call-b').zusammenfassung,'');
  assert.equal(mails.length,1,'no email without forwarding permission');
  const c=await preparePhoneEnquiry('call-c','4915100000003',undefined,()=>{});
  modelFails=true;c.observe(fragment);await c.close();
  assert.equal(rows.get('call-c').auswertung,'fehler','visible failure instead of dropped lead');
  assert.equal(mails.length,1);
  modelFails=false;
  for (const kategorie of ['anfrage','sonstiges','unklar']) {
    const id='internal-'+kategorie;
    const call=await preparePhoneEnquiry(id,'4915100000004',undefined,()=>{});
    summary={...base,kategorie,weitergabe:'offen',zusammenfassung:'Die Person fragt nach dem Firmeneintrag.',ergebnis:'Adresse abgeglichen.',naechsteSchritte:'Unterlagen anfordern.'};
    call.observe(fragment);await call.close();
    assert.equal(rows.get(id).zusammenfassung,summary.zusammenfassung,'every category retains its internal note with pending forwarding');
    assert.equal(JSON.parse(rows.get(id).details).naechsteSchritte,'Unterlagen anfordern.');
    assert.equal(JSON.parse(rows.get(id).details).ergebnis,'Adresse abgeglichen.');
    assert.equal(mails.length,1,'internal note never authorizes email');
  }
  const revoked=await preparePhoneEnquiry('revoked','4915100000005',undefined,()=>{});
  summary={...base};revoked.observe(fragment);await revoked.flush(false);
  assert.ok(rows.get('revoked').zusammenfassung);
  summary={...base,weitergabe:'abgelehnt',ergebnis:'DO_NOT_RETAIN',naechsteSchritte:'DO_NOT_RETAIN'};
  revoked.observe({...fragment,text:'Bitte nicht weitergeben.',startMs:1001,endMs:2000});await revoked.close();
  assert.equal(rows.get('revoked').zusammenfassung,'','refusal removes an earlier checkpoint');
  assert.equal(rows.get('revoked').details,'{}');assert.equal(mails.length,1);
  for(const assistantOnly of [false,true]) {
    const silent=await preparePhoneEnquiry('silent-'+assistantOnly,'',undefined,()=>{});
    if(assistantOnly) silent.observe({...fragment,role:'assistant',text:'Wie kann ich helfen?'});
    const before=modelCalls;await silent.close();
    assert.equal(modelCalls,before,'no model inference from silence or assistant-only speech');
    assert.match(rows.get('silent-'+assistantOnly).zusammenfassung,/Keine Äußerung/);
    assert.equal(rows.get('silent-'+assistantOnly).auswertung,'fertig');
  }
  console.log('PASS telephone enquiries: all categories, pending forwarding, results/next steps, silence, refusal and revocation, deduplication, bounded retry, no raw persistence, fixed recipient, failure visibility.');
} finally { await rm(directory,{recursive:true,force:true}); }
