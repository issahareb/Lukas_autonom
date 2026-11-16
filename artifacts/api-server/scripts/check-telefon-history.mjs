import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import pg from 'pg';

const dir = mkdtempSync(resolve('.telefon-history-check-'));
let pool, client;
try {
  const stub = join(dir, 'db.mjs');
  writeFileSync(stub, `
    export {telefonAnrufe,telefonNummern} from ${JSON.stringify(resolve('../../lib/db/src/schema/telefon.ts'))};
    export const messages={}, conversations={};
    export const db={select:()=>({from:()=>({where:condition=>({orderBy:()=>({limit:limit=>({offset:offset=>globalThis.__historyQuery(condition,limit,offset),then:(resolve,reject)=>globalThis.__historyQuery(condition,limit,0).then(resolve,reject)})})})})})};
  `);
  const out = join(dir, 'history.mjs');
  await build({stdin:{contents:'export * from "./src/lib/telefon-status.ts"; export * from "./src/lib/telefon-kontakte.ts"; export * from "./src/lib/werkzeug-auswahl.ts"; export * from "./src/lib/lukas-prompt-auswahl.ts";',resolveDir:process.cwd(),loader:'ts'},outfile:out,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@workspace/db':stub},logLevel:'silent'});
  const {telefonStatus,telefonKontakte,waehleWerkzeuge,waehleLukasPrompt} = await import(out);
  const tool={type:'function',function:{name:'telefon_status'}};
  for(const phrase of ['Hat die 8800 angerufen?','Hat die 11880 angerufen?','Wer hat mich heute angerufen?','Wer rief gestern an?','Hat jemand geklingelt?','Zeig mir verpasste Anrufe','Wurde ich zurückgerufen?','Wurde die Verbindung durchgestellt?','Prüf die Rufnummer']) {
    assert.equal(waehleWerkzeuge([tool],phrase).length,1,phrase);
    assert.ok(waehleLukasPrompt(phrase).module.includes('telefon'),phrase);
  }
  let calls=0, captured;
  const dialect=new PgDialect();
  globalThis.__historyQuery=async(condition,limit,offset)=>{calls++;captured={query:condition?dialect.sqlToQuery(condition):null,limit,offset};return [];};
  for(const input of [{suche:'x'.repeat(121)},{richtung:'privat'},{limit:0},{limit:51},{offset:-1},{offset:10001},{von:'heute'},{von:'2026-11-11T00:00:00Z',bis:'2026-11-10T00:00:00Z'},{query:'SELECT secret'}]) await assert.rejects(()=>telefonStatus(input));
  assert.equal(calls,0,'Invalid input never queries the DB');
  const empty=JSON.parse(await telefonStatus({suche:'11880',richtung:'eingehend',limit:2,offset:4}));
  assert.equal(captured.limit,3);assert.equal(captured.offset,4);
  assert.match(captured.query.sql,/exists/);assert.ok(captured.query.params.includes('%11880%'));
  assert.ok(captured.query.params.includes('eingehend'));assert.equal(empty.weitereTreffer,false);
  await telefonStatus({suche:'100%_\\'});
  assert.ok(captured.query.params.includes('%100\\%\\_\\\\%'),'LIKE wildcards stay literal');
  await telefonStatus({suche:'+49 (201) 12-34'});
  assert.ok(captured.query.params.includes('%492011234%'),'Formatted phone searches use digits');
  for(const suche of ['0049 (201) 12-34','0201 12-34']) {
    await telefonStatus({suche});
    assert.ok(captured.query.params.includes('%492011234%'),'History normalizes international/domestic prefix: '+suche);
    await telefonKontakte(suche);
    assert.ok(captured.query.params.includes('%492011234%'),'Contact lookup normalizes phone formatting: '+suche);
  }
  const stamp=new Date('2026-11-10T11:50:00Z');
  globalThis.__historyQuery=async()=>Array.from({length:3},(_,id)=>({id,nummer:id?'491234':'',richtung:'eingehend',ergebnis:'beendet',createdAt:stamp,updatedAt:stamp}));
  const page=JSON.parse(await telefonStatus({limit:2}));
  assert.equal(page.anrufe.length,2);assert.equal(page.naechsterOffset,2);assert.equal(page.weitereTreffer,true);
  assert.equal(page.anrufe[0].nummer,'nicht übermittelt');assert.equal(page.anrufe[0].richtung,'eingehend');
  assert.match(page.anrufe[0].zeitDeutschland,/12:50/);assert.equal(page.anrufe[0].begonnen,stamp.toISOString());
  const boundary=JSON.parse(await telefonStatus({limit:2,offset:10000}));
  assert.equal(boundary.naechsterOffset,null);assert.equal(boundary.suchgrenzeErreicht,true,'Never return a continuation that validation rejects');
  globalThis.__historyQuery=async()=>{throw Error('history DB unavailable');};
  await assert.rejects(()=>telefonStatus(),/history DB unavailable/);
  console.log('OK — Caller question routing, strict filters, bound literal search, pagination, German timestamps and DB errors.');

  if(!process.env.BENCH_DATABASE_URL) console.log('SKIP — PostgreSQL history query needs BENCH_DATABASE_URL.');
  else {
    pool=new pg.Pool({connectionString:process.env.BENCH_DATABASE_URL});client=await pool.connect();
    await client.query('BEGIN');
    const schema='history_'+process.pid;
    await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET LOCAL search_path TO ${schema}`);
    await client.query('CREATE TABLE lukas_telefon_anrufe (id serial PRIMARY KEY,nummer text,richtung text,anlass text,detail text,created_at timestamptz)');
    await client.query('CREATE TABLE lukas_telefon_nummern (nummer text,name text)');
    await client.query(`INSERT INTO lukas_telefon_anrufe(nummer,richtung,anlass,detail,created_at) VALUES
      ('4920111880','eingehend','','','2026-11-09T11:00:00Z'),
      ('4920111880','ausgehend','','','2026-11-10T11:00:00Z'),
      ('49123','eingehend','100% Rabatt','','2026-11-10T11:00:00Z'),
      ('49124','eingehend','1000 Rabatt','','2026-11-10T11:00:00Z')`);
    await client.query("INSERT INTO lukas_telefon_nummern VALUES ('4920111880','Verzeichnisdienst')");
    globalThis.__historyQuery=async(condition,limit,offset)=>{
      const q=condition?dialect.sqlToQuery(condition):{sql:'true',params:[]};
      const p=q.params.length;
      const result=await client.query(`SELECT * FROM lukas_telefon_anrufe WHERE ${q.sql} ORDER BY created_at DESC,id DESC LIMIT $${p+1} OFFSET $${p+2}`,[...q.params,limit,offset]);
      return result.rows.map(r=>({...r,createdAt:r.created_at,updatedAt:r.created_at,ergebnis:'beendet'}));
    };
    const name=JSON.parse(await telefonStatus({suche:'Verzeichnisdienst',richtung:'eingehend'}));
    assert.equal(name.anrufe.length,1);assert.equal(name.anrufe[0].nummer,'+4920111880');
    assert.equal(JSON.parse(await telefonStatus({suche:'100%'})).anrufe.length,1);
    assert.equal(JSON.parse(await telefonStatus({suche:"' OR true --"})).anrufe.length,0);
    assert.equal(JSON.parse(await telefonStatus({richtung:'eingehend',von:'2026-11-09T11:00:00Z',bis:'2026-11-10T11:00:00Z'})).anrufe.length,1);
    const first=JSON.parse(await telefonStatus({limit:1})),second=JSON.parse(await telefonStatus({limit:1,offset:1}));
    assert.notEqual(first.anrufe[0].anruf_id,second.anrufe[0].anruf_id);
    console.log('OK — PostgreSQL: name/number, direction, literal wildcards, injection, half-open dates and stable pagination.');
  }
} finally {
  if(client){await client.query('ROLLBACK');client.release();}await pool?.end();
  delete globalThis.__historyQuery;rmSync(dir,{recursive:true,force:true});
}
