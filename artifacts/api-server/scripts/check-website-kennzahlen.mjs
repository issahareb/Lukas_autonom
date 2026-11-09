import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import pg from 'pg';
import { toolHarness } from '../bench/tool-harness.mjs';
const dir=mkdtempSync(resolve('.website-metrics-test-'));
const originalFetch=globalThis.fetch, oldToken=process.env.TAXIBB_ANALYTICS_READ_TOKEN;
let pool,harness,queries=0,reads=0,result={rows:[{views:'12',sessions:'7',active:'2',seconds:31,depth:52}]};
const taxi={rangeDays:7,summary:{pageviews:14,sessions:9,avgScrollDepth:50,avgActiveSecondsPerSession:40},clicks:[],forms:[],funnel:{formStartSessions:3,formSubmitSessions:2,bookings:5},privateRawPhone:'DO_NOT_EXPOSE'};
try {
  const stub=join(dir,'db.mjs');writeFileSync(stub,'export const pool={query:(...args)=>globalThis.__websiteMetricsQuery(...args)};');
  const out=join(dir,'metrics.mjs');
  await build({stdin:{contents:'export * from "./src/lib/website-kennzahlen.ts";',resolveDir:process.cwd(),loader:'ts'},outfile:out,bundle:true,format:'esm',platform:'node',packages:'external',alias:{'@workspace/db':stub},logLevel:'silent'});
  const api=await import(out);
  globalThis.__websiteMetricsQuery=async(sql,args)=>{queries++;assert.deepEqual(args,['hareb.digital',7]);return result;};
  process.env.TAXIBB_ANALYTICS_READ_TOKEN='metrics-test-token';
  globalThis.fetch=async(url,init)=>{reads++;assert.equal(String(url),'https://workspaceapi-server-production-8880.up.railway.app/api/analytics/overview?days=7');assert.equal(init.headers['x-analytics-token'],'metrics-test-token');assert.equal(init.redirect,'error');return Response.json(taxi);};
  for(const input of [{},{website:'https://attacker.invalid'},{website:'hareb.digital',tage:180},{website:'taxibbessen.de',tage:1},{website:'hareb.digital',tage:1.5},{website:'hareb.digital',sql:'SELECT secrets'}])await assert.rejects(()=>api.leseWebsiteKennzahlen(input));
  assert.equal(queries,0);assert.equal(reads,0);
  for(let n=0;n<2;n++){
    const data=JSON.parse(await api.leseWebsiteKennzahlen({website:'hareb.digital'}));
    assert.equal(data.summary.pageviews,12);assert.equal(data.summary.sessions,7);assert.equal(data.tage,7);assert.ok(data.fetchedAt);assert.match(data.hinweis,/rollendes Fenster/);
  }
  assert.equal(queries,2,'each call fetches fresh data');
  result={rows:[{views:'0',sessions:'0',active:'0',seconds:0,depth:0}]};
  assert.equal(JSON.parse(await api.leseWebsiteKennzahlen({website:'hareb.digital'})).summary.pageviews,0,'confirmed zero is allowed');
  for(const invalid of [{rows:[]},{rows:[{views:null,sessions:0,active:0,seconds:0,depth:0}]},{rows:[{views:'invalid'}]}]){result=invalid;await assert.rejects(()=>api.leseWebsiteKennzahlen({website:'hareb.digital'}),/Kein Nullstand bestätigt/);}
  globalThis.__websiteMetricsQuery=async()=>{throw Error('PRIVATE_DATABASE_DETAILS');};
  await assert.rejects(()=>api.leseWebsiteKennzahlen({website:'hareb.digital'}),e=>/Kein Nullstand bestätigt/.test(e.message)&&!e.message.includes('PRIVATE_DATABASE_DETAILS'));
  const data=JSON.parse(await api.leseWebsiteKennzahlen({website:'taxibbessen.de'}));
  assert.equal(data.summary.pageviews,14);assert.equal(data.funnel.bookings,5);assert.equal(data.funnel.formSubmitSessions,2);assert.ok(!JSON.stringify(data).includes('DO_NOT_EXPOSE'));assert.ok(!JSON.stringify(data).includes('metrics-test-token'));
  taxi.rangeDays=30;await assert.rejects(()=>api.leseWebsiteKennzahlen({website:'taxibbessen.de'}),/konnten nicht geladen/);taxi.rangeDays=7;
  globalThis.fetch=async()=>new Response('PRIVATE_UPSTREAM_DETAILS',{status:503});
  await assert.rejects(()=>api.leseWebsiteKennzahlen({website:'taxibbessen.de'}),e=>/konnten nicht geladen/.test(e.message)&&!e.message.includes('PRIVATE_UPSTREAM_DETAILS'));
  delete process.env.TAXIBB_ANALYTICS_READ_TOKEN;await assert.rejects(()=>api.leseWebsiteKennzahlen({website:'taxibbessen.de'}),/noch nicht verbunden/);
  harness=await toolHarness();
  for(const task of ['Nenne mir die aktuellen Aufrufzahlen von Taxi BB Essen.','Wie viele Seitenaufrufe hat Hareb Digital?','Zeig die Besucherzahlen vom Portfolio.','Wie viele Besucher hatte Hareb Digital?','Wie viele Aufrufe hat TaxiBB?']){
    const tools=await harness.api.allLukasTools(task),names=tools.map(t=>t.function.name);
    assert.ok(names.includes('lese_website_kennzahlen'),task);assert.ok(!names.includes('web_search'),task);
    assert.equal(harness.api.riskFor('lese_website_kennzahlen'),'R0');
  }
  assert.match(await harness.api.mcpFindTool('lese_website_kennzahlen'),/lese_website_kennzahlen/);
  console.log('PASS website metrics: fresh shared dashboard aggregates, site/range validation, confirmed zero vs failures, scoped token, safe errors, private read policy and discovery.');
  if(process.env.BENCH_DATABASE_URL){
    pool=new pg.Pool({connectionString:process.env.BENCH_DATABASE_URL});const client=await pool.connect();await client.query('BEGIN');globalThis.__websiteMetricsQuery=(...a)=>client.query(...a);
    try{
      const before=JSON.parse(await api.leseWebsiteKennzahlen({website:'hareb.digital'})),suffix='metrics_'+Date.now();
      const insert=(site,id,session,days=0)=>client.query(`INSERT INTO lukas_website_events(site,id,session,page,path,event,occurred_at,data,received_at) VALUES($1,$2,$3,$2,'/test','page_view',now(),'{}'::jsonb,now()-($4::int*interval '1 day'))`,[site,suffix+id,suffix+session,days]);
      await insert('hareb.digital','a','session-a');await insert('hareb.digital','b','session-a');await insert('hareb.digital','c','session-b');await insert('hareb.digital','old','old-session',10);await insert('issahareb.me','other','other-session');
      const after=JSON.parse(await api.leseWebsiteKennzahlen({website:'hareb.digital'}));
      assert.equal(after.summary.pageviews,before.summary.pageviews+3);assert.equal(after.summary.sessions,before.summary.sessions+2);
      const dashboard=(await client.query(api.WEBSITE_ANALYTICS_PREFIX+api.WEBSITE_SUMMARY_SELECT,['hareb.digital',7])).rows[0];assert.equal(after.summary.pageviews,Number(dashboard.views));assert.equal(after.summary.sessions,Number(dashboard.sessions));
      console.log('PASS actual PostgreSQL website metrics: dashboard SQL, site isolation, rolling period and pageviews vs sessions.');
    }finally{await client.query('ROLLBACK');client.release();}
  }else console.log('SKIP website metrics PostgreSQL: BENCH_DATABASE_URL is not set.');
}finally{globalThis.fetch=originalFetch;if(oldToken===undefined)delete process.env.TAXIBB_ANALYTICS_READ_TOKEN;else process.env.TAXIBB_ANALYTICS_READ_TOKEN=oldToken;delete globalThis.__websiteMetricsQuery;await pool?.end();if(harness)rmSync(harness.dir,{recursive:true,force:true});rmSync(dir,{recursive:true,force:true});}
