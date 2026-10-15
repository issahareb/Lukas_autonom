import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
const dir = await mkdtemp(join(process.cwd(),'.enquiry-routes-'));
const queries=[];
let fail=false;
globalThis.__enquiryRouteQuery=async(sql,args)=>{
  queries.push({sql,args}); if(fail) throw Error('private database detail');
  if(sql.includes('count(*)')) return {rows:[{total:1}]};
  if(sql.includes('UPDATE')) return {rows:[],rowCount:args[0]===7?1:0};
  return {rows:[{id:7,nummer:'4915100000001',details:'{"name":"Muster"}'}]};
};
let server;
const previousToken=process.env.LUKAS_API_TOKEN;
try {
  process.env.LUKAS_API_TOKEN='test-enquiry-owner';
  const out=join(dir,'routes.mjs');
  await build({stdin:{contents:'export {default as router} from "./src/routes/telefon-anfragen.ts"; export {lukasAuth} from "./src/middlewares/auth.ts";',resolveDir:process.cwd(),loader:'ts'},outfile:out,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'db-only-stub',setup(b){
    b.onResolve({filter:/^(@workspace\/db|\.\.\/lib\/logger)$/},args=>({path:args.path,namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},args=>({loader:'js',contents:args.path==='@workspace/db'?'export const pool={query:(...a)=>globalThis.__enquiryRouteQuery(...a)};':'export const logger={warn(){},error(){}};'}));
  }}]});
  const {router,lukasAuth}=await import(pathToFileURL(out).href);
  const app=express();app.use(express.json());app.use('/api',lukasAuth,router);
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/telefon/anfragen`;
  const headers={Authorization:'Bearer test-enquiry-owner','Content-Type':'application/json'};
  assert.equal((await fetch(base)).status,401);assert.equal(queries.length,0);
  assert.equal((await fetch(base+'/7',{method:'PATCH',body:'{}',headers:{'Content-Type':'application/json'}})).status,401);
  const list=await fetch(base+'?q=%25&status=neu',{headers});assert.equal(list.status,200);assert.equal(list.headers.get('cache-control'),'no-store');
  assert.deepEqual((await list.json()).rows[0].details,{name:'Muster'});
  assert.equal(queries.at(-1).args[1],'%\\%%','literal wildcard remains a SQL parameter');
  for(const q of ['?status=invalid','?offset=-1','?offset=1.5']) assert.equal((await fetch(base+q,{headers})).status,400);
  for(const body of [{status:'invalid'},{email:'attacker@example.test'},{}, {notiz:'x'.repeat(5001)}]) assert.equal((await fetch(base+'/7',{method:'PATCH',headers,body:JSON.stringify(body)})).status,400);
  assert.equal((await fetch(base+'/7',{method:'PATCH',headers,body:JSON.stringify({status:'erledigt',notiz:'Rückruf erfolgt'})})).status,200);
  assert.equal((await fetch(base+'/99',{method:'PATCH',headers,body:'{"status":"neu"}'})).status,404);
  fail=true;const error=await fetch(base,{headers});assert.equal(error.status,500);assert.ok(!(await error.text()).includes('private database detail'));
  console.log('PASS enquiry HTTP: real auth, private caching, typed filters, parameterized SQL, exact patch fields, missing IDs and safe errors.');
} finally {server?.close();if(previousToken===undefined)delete process.env.LUKAS_API_TOKEN;else process.env.LUKAS_API_TOKEN=previousToken;await rm(dir,{recursive:true,force:true});}
