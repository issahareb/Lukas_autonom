import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import express from 'express';
const dir=mkdtempSync(resolve('.rueckruf-test-'));
let pool;
try {
  const stub=join(dir,'adapters.mjs');
  writeFileSync(stub,`export const pool=globalThis.__callbackPool;
export const logger={error(){},info(){}};
export const normalisiere=n=>n.replace(/[^0-9]/g,'').replace(/^00/,'');
export async function findeTelefonKontakte(n){return (await pool.query('SELECT * FROM lukas_telefon_nummern WHERE name=$1',[n])).rows;}
export async function starteAnrufMitStatus(){throw new Error('Real calls forbidden in tests');}`);
  const out=join(dir,'queue.mjs');
  await build({entryPoints:['src/lib/rueckrufe.ts'],outfile:out,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'test-adapters',setup(b){b.onResolve({filter:/^(?:@workspace\/db|\.\/logger|\.\/telefon-kontakte|\.\/telefon)$/},()=>({path:stub}));}}]});
  const pure=join(dir,'pure.mjs');
  await build({stdin:{contents:'export * from "./src/lib/werkzeug-auswahl.ts"; export * from "./src/lib/werkzeug-ergebnis.ts"; export * from "./src/lib/lukas-prompt-auswahl.ts";',resolveDir:process.cwd(),loader:'ts'},outfile:pure,bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  const {waehleWerkzeuge,istMisserfolg,waehleLukasPrompt}=await import(pure);
  const tools=['plane_rueckruf','ruf_an','storniere_rueckruf','rueckruf_status'].map(name=>({type:'function',function:{name}}));
  for(const text of ['Ruf mich in fünf Minuten zurück','Rückruf absagen','Bitte in 5 min zurückrufen']) assert.equal(waehleWerkzeuge(tools,text).length,4);
  for(const text of ['Diese Nummer ist nicht zum Anrufen freigegeben.','Zum Anrufen fehlen noch Zugangsdaten.','{"status":"uncertain"}','{"status":"blockiert"}']) assert.equal(istMisserfolg(text),true);
  assert.equal(istMisserfolg('{"status":"geplant","id":"abc"}'),false);
  assert.equal(istMisserfolg('Datei erfolgreich gespeichert.'),false);
  const routeOut=join(dir,'routes.mjs');
  await build({stdin:{contents:'export {default as router} from "./src/routes/rueckrufe.ts"; export {lukasAuth} from "./src/middlewares/auth.ts";',resolveDir:process.cwd(),loader:'ts'},outfile:routeOut,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'route-adapters',setup(b){
    b.onResolve({filter:/^\.\.\/lib\/(rueckrufe|logger)$/},args=>({path:args.path,namespace:'route-test'}));
    b.onLoad({filter:/.*/,namespace:'route-test'},args=>({loader:'js',contents:args.path.endsWith('/logger')?'export const logger={error(){}}':'export const rueckrufStatus=async()=>[]; export async function storniereRueckruf(id){if(id!=="planned")throw Error("already started");return {status:"storniert"};}'}));
  }}]});
  const oldToken=process.env.LUKAS_API_TOKEN;process.env.LUKAS_API_TOKEN='callback-test-owner';
  const {router,lukasAuth}=await import(routeOut);const app=express();app.use('/api',lukasAuth,router);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try {
    const base='http://127.0.0.1:'+server.address().port+'/api/lukas/telefon/rueckrufe';
    assert.equal((await fetch(base)).status,401);
    assert.equal((await fetch(base+'/planned/stornieren',{method:'POST'})).status,401);
    const headers={Authorization:'Bearer callback-test-owner'};
    assert.equal((await fetch(base,{headers})).status,200);
    assert.equal((await fetch(base+'/planned/stornieren',{method:'POST',headers})).status,200);
    assert.equal((await fetch(base+'/started/stornieren',{method:'POST',headers})).status,409);
    console.log('OK — Private HTTP status/cancellation require owner authentication; started jobs cannot be falsely cancelled.');
  } finally {await new Promise(r=>server.close(r));if(oldToken===undefined)delete process.env.LUKAS_API_TOKEN;else process.env.LUKAS_API_TOKEN=oldToken;}
  if(process.env.BENCH_DATABASE_URL) pool=new pg.Pool({connectionString:process.env.BENCH_DATABASE_URL});
  globalThis.__callbackPool=pool;
  const q=await import(out);
  assert.ok(waehleLukasPrompt('Ruf mich in fünf Minuten zurück').module.includes('telefon'));
  assert.match(waehleLukasPrompt('Ruf mich in fünf Minuten zurück').dynamisch,/plane_rueckruf/);
  const now=Date.now();assert.equal(q.rueckrufZeit({in_minuten:5},now).getTime(),now+300000);
  for(const input of [{},{in_minuten:NaN},{in_minuten:-1},{in_minuten:50000},{zeitpunkt:'2027-01-01T10:00:00'},{in_minuten:5,zeitpunkt:'2027-01-01T10:00:00Z'}]) assert.throws(()=>q.rueckrufZeit(input,now));
  console.log('OK — Auswahl für Rückrufsprache, echte Fälligkeit, Zeitzonen/Validierung und Fehlerrückgaben.');
  if(!pool) { console.log('SKIP — PostgreSQL-Integration benötigt BENCH_DATABASE_URL.'); }
  else {
    const suffix=Date.now().toString();
    const {rows:[contact]}=await pool.query("INSERT INTO lukas_telefon_nummern (nummer,name,stufe,darf_angerufen_werden) VALUES ($1,$2,'privat',true) RETURNING id",['490000'+suffix.slice(-7),'synthetic-'+suffix]);
    const ctx={telefonOwnerContactId:contact.id};
    const plan=async()=>JSON.parse(await q.planeRueckruf({in_minuten:5},ctx));
    const due=async()=>pool.query("UPDATE lukas_rueckrufe SET faellig_am=now()-interval '1 second' WHERE kontakt_id=$1 AND status='geplant'",[contact.id]);
    const state=async id=>(await pool.query('SELECT * FROM lukas_rueckrufe WHERE id=$1',[id])).rows[0];
    try {
      await assert.rejects(()=>q.planeRueckruf({in_minuten:5},{}),/Rückrufziel/);
      const abort=new AbortController();abort.abort();await assert.rejects(()=>q.planeRueckruf({in_minuten:5},{...ctx,signal:abort.signal}));
      const [a,b]=await Promise.all([plan(),plan()]); assert.equal(a.id,b.id);
      let calls=0;const dial=async()=>{calls++;return {status:'started',message:'Provider accepted; not answered',callId:'test-call'};};
      await q.fuehreRueckrufeAus(dial);assert.equal(calls,0);
      await due(); await Promise.all([q.fuehreRueckrufeAus(dial),q.fuehreRueckrufeAus(dial)]);
      assert.equal(calls,1);assert.equal((await state(a.id)).status,'gestartet');
      await q.fuehreRueckrufeAus(dial);assert.equal(calls,1);
      await assert.rejects(()=>q.storniereRueckruf(a.id));
      const c=await plan();await q.storniereRueckruf(c.id);await due();await q.fuehreRueckrufeAus(dial);assert.equal(calls,1);
      const d=await plan();await due();await pool.query('UPDATE lukas_telefon_nummern SET darf_angerufen_werden=false WHERE id=$1',[contact.id]);
      await q.fuehreRueckrufeAus(dial);assert.equal((await state(d.id)).status,'blockiert');assert.equal(calls,1);
      await assert.rejects(plan,/freigegeben/);await pool.query('UPDATE lukas_telefon_nummern SET darf_angerufen_werden=true WHERE id=$1',[contact.id]);
      const e=await plan();await due();await q.fuehreRueckrufeAus(async()=>{calls++;throw new TypeError('lost response');});
      await q.fuehreRueckrufeAus(dial);assert.equal((await state(e.id)).status,'unklar');assert.equal(calls,2);
      const f=await plan();await pool.query("UPDATE lukas_rueckrufe SET faellig_am=now()-interval '20 minutes' WHERE id=$1",[f.id]);
      await q.fuehreRueckrufeAus(dial);assert.equal((await state(f.id)).status,'verpasst');assert.equal(calls,2);
      const g=await plan();await pool.query("UPDATE lukas_rueckrufe SET status='startet',updated_at=now()-interval '3 minutes' WHERE id=$1",[g.id]);
      await q.fuehreRueckrufeAus(dial);assert.equal((await state(g.id)).status,'unklar');assert.equal(calls,2);
      const h=await plan();await due();
      const child=join(dir,'restart.mjs');writeFileSync(child,`import pg from 'pg';
import express from 'express';globalThis.__callbackPool=new pg.Pool({connectionString:process.env.BENCH_DATABASE_URL});const q=await import(${JSON.stringify(out)});await q.fuehreRueckrufeAus(async()=>({status:'started',message:'Restart worker accepted',callId:'restart'}));await globalThis.__callbackPool.end();`);
      execFileSync(process.execPath,[child],{env:process.env,timeout:15000});assert.equal((await state(h.id)).anruf_id,'restart');
      const {rows:[notifications]}=await pool.query("SELECT count(*)::int AS n FROM lukas_meldungen WHERE betreff LIKE 'Rückrufauftrag %'");assert.ok(notifications.n>=6);
      console.log('OK — PostgreSQL: persistent plan, parallel deduplication/claim, not early, cancellation, revocation, unknown/no retry, expiry, crashed dispatch, separate-process recovery, visible outcomes. No real telephone call.');
    } finally {
      await pool.query("DELETE FROM lukas_meldungen WHERE betreff IN (SELECT 'Rückrufauftrag '||id FROM lukas_rueckrufe WHERE kontakt_id=$1)",[contact.id]);
      await pool.query('DELETE FROM lukas_rueckrufe WHERE kontakt_id=$1',[contact.id]);
      await pool.query('DELETE FROM lukas_telefon_nummern WHERE id=$1',[contact.id]);
    }
  }
} finally {await pool?.end();delete globalThis.__callbackPool;rmSync(dir,{recursive:true,force:true});}
