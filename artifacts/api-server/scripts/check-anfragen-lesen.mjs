import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
const dir=mkdtempSync(resolve('.anfragen-read-test-'));let pool;
try {
  const stub=join(dir,'db.mjs');writeFileSync(stub,'export const pool={query:(...args)=>globalThis.__enquiryReadQuery(...args)};');
  const out=join(dir,'read.mjs');
  await build({stdin:{contents:'export * from "./src/lib/anfragen-lesen.ts"; export * from "./src/lib/werkzeug-auswahl.ts";',resolveDir:process.cwd(),loader:'ts'},outfile:out,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@workspace/db':stub},logLevel:'silent'});
  const {leseAnfragen,waehleWerkzeuge}=await import(out);let called=0;
  globalThis.__enquiryReadQuery=async()=>{called++;throw Error('database unavailable');};
  for(const input of [{tage:0},{tage:91},{status:'neu'},{limit:100},{offset:-1},{query:'SELECT secret'}]) await assert.rejects(()=>leseAnfragen(input));
  assert.equal(called,0);await assert.rejects(()=>leseAnfragen({}),/database unavailable/);
  const tool={type:'function',function:{name:'lese_anfragen'}};
  for(const phrase of ['Sind Anfragen eingegangen?','Gibt es neue Interessenten?','Zeig mir offene Kundenanliegen']) assert.equal(waehleWerkzeuge([tool],phrase).length,1);
  console.log('OK — Request questions select live reader; invalid filters and DB failures never become an empty inbox.');
  if(!process.env.BENCH_DATABASE_URL) console.log('SKIP — PostgreSQL request reader needs BENCH_DATABASE_URL.');
  else {
    pool=new pg.Pool({connectionString:process.env.BENCH_DATABASE_URL});
    globalThis.__enquiryReadQuery=(...a)=>pool.query(...a);
    const db=await pool.connect();await db.query('BEGIN');
    // Roll back all fixtures. The actual production SQL executes on PostgreSQL.
    globalThis.__enquiryReadQuery=(...a)=>db.query(...a);
    const suffix=Date.now().toString();
    try {
      const before=JSON.parse(await leseAnfragen({}));
      await db.query(`INSERT INTO lukas_telefon_anfragen(session_id,kategorie,weitergabe,auswertung,zusammenfassung)
        VALUES ($1,'anfrage','erlaubt','fertig','SYNTHETIC customer needs a website'),($2,'anfrage','abgelehnt','fertig','MUST NOT DISCLOSE'),($3,'unklar','offen','fehler','')`,[suffix+'a',suffix+'b',suffix+'c']);
      await db.query(`INSERT INTO lukas_meldungen(betreff,text) VALUES ('Anfrage: SYNTHETIC','Example website request'),('Internal diagnostic','MUST NOT INCLUDE')`);
      await db.query(`INSERT INTO lukas_telefon_anfragen(session_id,kategorie,weitergabe,auswertung,zusammenfassung,status,created_at)
        VALUES ($1,'anfrage','erlaubt','fertig','Old completed','erledigt',now()-interval '45 days')`,[suffix+'old']);
      const result=JSON.parse(await leseAnfragen({}));
      assert.equal(result.gesamt,before.gesamt+2);assert.equal(result.telefon,before.telefon+1);assert.equal(result.website,before.website+1);
      assert.equal(result.telefon_ungeklaert,before.telefon_ungeklaert+1);assert.equal(result.filter.tage,30);
      assert.doesNotMatch(JSON.stringify(result),/MUST NOT/);
      const long=JSON.parse(await leseAnfragen({tage:90}));assert.equal(long.gesamt,result.gesamt+1);
      const open=JSON.parse(await leseAnfragen({tage:90,status:'offen'}));assert.equal(open.gesamt,result.gesamt);
      const page=JSON.parse(await leseAnfragen({limit:1}));assert.equal(page.anfragen.length,1);assert.equal(page.gesamt,result.gesamt);
      const next=JSON.parse(await leseAnfragen({limit:1,offset:1}));assert.notEqual(page.anfragen[0].quelle+page.anfragen[0].id,next.anfragen[0].quelle+next.anfragen[0].id);
      console.log('OK — Actual PostgreSQL: phone + website, consent exclusion, pending/error counts, period/status filters, bounded pagination and total counts.');
    } finally {await db.query('ROLLBACK');db.release();}
  }
} finally {await pool?.end();delete globalThis.__enquiryReadQuery;rmSync(dir,{recursive:true,force:true});}
