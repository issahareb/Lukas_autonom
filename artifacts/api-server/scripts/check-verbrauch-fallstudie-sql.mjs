import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import pg from 'pg';
const adminUrl=process.env.ADMIN_DATABASE_URL;
if(!adminUrl)throw new Error('ADMIN_DATABASE_URL for disposable PostgreSQL required');
const name='usage_case_'+process.pid;
const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
const dir=await mkdtemp(join(tmpdir(),'usage-sql-'));let client;
try{
 await admin.query(`CREATE DATABASE "${name}"`);
 const url=new URL(adminUrl);url.pathname='/'+name;process.env.DATABASE_URL=url.toString();process.env.NODE_ENV='production';
 const deploy=spawnSync('npm',['run','db:deploy'],{cwd:process.cwd(),env:process.env,encoding:'utf8'});assert.equal(deploy.status,0,deploy.stdout+deploy.stderr);
 client=new pg.Client({connectionString:url.toString()});await client.connect();
 const out=join(dir,'audit.mjs');await build({stdin:{contents:`export * from './artifacts/api-server/src/lib/verbrauch-fallstudie';export * from './artifacts/api-server/src/lib/verbrauch-archiv';export * from './artifacts/api-server/src/lib/verbrauch-auswertung';export * from './artifacts/api-server/src/lib/verbrauch-auftrag';export * from './artifacts/api-server/src/lib/verbrauch-quelle';export {pool} from '@workspace/db';`,resolveDir:process.cwd()},outfile:out,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'workspace',setup(b){b.onResolve({filter:/^@workspace\/db$/},()=>({path:join(process.cwd(),'lib/db/src/index.ts')}));}}]});
 // External runtime modules resolve from the repository, not /tmp.
 const output=join(process.cwd(),'node_modules','.usage-case-sql-'+process.pid+'.mjs');
 const fs=await import('node:fs/promises');await fs.copyFile(out,output);
 let m;try{m=await import(output)}finally{await fs.rm(output,{force:true})}
 await m.mitVerbrauchsAuftrag('chat',42,async()=>{
  m.markiereAuftrag('Schreibe Code',{serie:'sql-v1',fall:'sample',abnahme:'assertions pass'});
  await m.messeModellAufruf({route:{model:'test',provider:'openai',profile:'code'},messages:[{role:'user',content:'private prompt must not persist'}]},'start',async()=>{
   m.merkeAufrufUsage({eingabe:100,ausgabe:20,cacheLesen:30,cacheSchreiben:null});m.merkeProviderBeleg({responseId:'resp_test',usage:{input_tokens:130,output_tokens:20}});
  });
 });await m.verbrauchLeeren();
 const rows=await client.query('SELECT * FROM lukas_verbrauch_auftraege');assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].status,'antwort');assert.equal(rows.rows[0].messung.aufgabenart,'coding');
 const id=rows.rows[0].id;
 await assert.rejects(m.nehmeAuftragAb(id,{ergebnis:'erfolgreich',pruefer:'tester',beleg:''}),/Beleg/);
 await m.nehmeAuftragAb(id,{ergebnis:'erfolgreich',pruefer:'assertions',beleg:'SQL test passed'});
 const day=new Date().toISOString().slice(0,10);
 await client.query("INSERT INTO lukas_tageskosten(tag,provider,model,quelle,aufrufe,rein,raus,aus_cache,in_cache) VALUES($1,'openai','test','chat',1,100,20,30,0)",[day]);
 const b=await m.fallstudienBericht({von:day,bis:day});assert.equal(b.aktuell.auftraege.length,1);assert.equal(b.aktuell.auftraege[0].gesamt,150);assert.equal(b.abgleich.aktuell.passt,true);assert.equal(b.aktuell.abdeckung.abgenommen,1);assert.equal(b.vergleich[0].bewertung,'nicht_belastbar');
 assert.equal(JSON.stringify(b).includes('private prompt must not persist'),false);
 const {nachweis,...payload}=JSON.parse(JSON.stringify(b));const crypto=await import('node:crypto');assert.equal(m.belegHash(payload),nachweis.sha256);
 const a=await m.archiviereVerbrauch();const a2=await m.archiviereVerbrauch();assert.equal(a.sha256,a2.sha256);const {nachweis:archiveProof,...archivePayload}=a2.daten;assert.equal(m.belegHash(archivePayload),archiveProof.sha256,'JSONB field reordering must preserve the canonical evidence hash');assert.equal((await client.query('SELECT count(*)::int AS n FROM lukas_verbrauch_berichte')).rows[0].n,1);
 await m.pool.end();console.log('PASS PostgreSQL usage: migrations, async receipts, review persistence, historical API, reconciliation, export hash, immutable daily archive');
}finally{
 if(client)await client.end();await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end();await rm(dir,{recursive:true,force:true});
}
