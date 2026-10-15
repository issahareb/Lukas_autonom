import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
const dir=await mkdtemp(join(process.cwd(),'.taxi-analytics-test-'));
const originalFetch=globalThis.fetch;
const oldOwner=process.env.LUKAS_API_TOKEN,oldRead=process.env.TAXIBB_ANALYTICS_READ_TOKEN;
let server,calls=0,fail=false;
const fixture={rangeDays:30,summary:{pageviews:14,sessions:9,avgScrollDepth:50,avgActiveSecondsPerSession:40},clicks:[{target:'phone_hero',clicks:5,sessions:3}],funnel:{formStartSessions:2,formSubmitSessions:1,bookings:1},customerPhone:'must-not-leak'};
try {
  process.env.LUKAS_API_TOKEN='test-owner';process.env.TAXIBB_ANALYTICS_READ_TOKEN='test-read-token';
  globalThis.fetch=async(url,init)=>{
    calls++;
    assert.equal(new URL(url).hostname,'workspaceapi-server-production-8880.up.railway.app');
    assert.equal(init.headers['x-analytics-token'],'test-read-token');assert.equal(init.redirect,'error');
    if(fail)return new Response('private service error',{status:500});
    return new Response(JSON.stringify(fixture),{headers:{'Content-Type':'application/json'}});
  };
  const out=join(dir,'routes.mjs');
  await build({stdin:{contents:'export {default as router} from "./src/routes/taxibb-analytics.ts"; export {lukasAuth} from "./src/middlewares/auth.ts";',resolveDir:process.cwd(),loader:'ts'},outfile:out,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'logger',setup(b){b.onResolve({filter:/\.\.\/lib\/logger$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const logger={warn(){},error(){}};',loader:'js'}));}}]});
  const {router,lukasAuth}=await import(pathToFileURL(out).href);
  const app=express();app.use('/api',lukasAuth,router);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}/api/lukas/taxibb/analytics`;
  const headers={Authorization:'Bearer test-owner'};
  assert.equal((await originalFetch(base)).status,401);assert.equal(calls,0);
  for(const query of ['?days=999','?days=abc','?days=7&days=30'])assert.equal((await originalFetch(base+query,{headers})).status,400);
  assert.equal(calls,0);
  const response=await originalFetch(base+'?days=30',{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const data=await response.json();assert.equal(data.clicks[0].clicks,5);assert.equal(data.customerPhone,undefined);assert.ok(data.fetchedAt);
  fail=true;const failed=await originalFetch(base,{headers});assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes('private service error'));
  delete process.env.TAXIBB_ANALYTICS_READ_TOKEN;assert.equal((await originalFetch(base,{headers})).status,503);
  console.log('PASS TaxiBB proxy: owner-only access, fixed destination, scoped token, period validation, aggregate-only output, safe errors and no-store.');
}finally{server?.close();globalThis.fetch=originalFetch;for(const [key,value]of [['LUKAS_API_TOKEN',oldOwner],['TAXIBB_ANALYTICS_READ_TOKEN',oldRead]])if(value===undefined)delete process.env[key];else process.env[key]=value;await rm(dir,{recursive:true,force:true});}
