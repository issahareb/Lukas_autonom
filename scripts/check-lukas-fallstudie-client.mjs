import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp(join(tmpdir(),'usage-client-'));
const requests=[];
const payload={version:2,stand:'2026-11-14T00:00:00Z',aktuell:{zeitraum:{von:'2026-11-13',bis:'2026-11-13'}},vergleich:[]};
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const proof={sha256:createHash('sha256').update(canonical(payload)).digest('hex')};
const server=createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;requests.push({url:req.url,method:req.method,body:body?JSON.parse(body):null});
 res.setHeader('Content-Type','application/json');
 if(req.url.startsWith('/api/lukas/verbrauch/fallstudie'))res.end(JSON.stringify({nachweis:proof,...payload}));
 else if(req.url==='/api/anthropic/conversations'){res.statusCode=201;res.end('{"id":42}');}
 else if(req.url==='/api/anthropic/conversations/42/messages'){res.setHeader('X-Lukas-Auftrag','fixture-job');res.end('data: {"content":"usable fixture result"}\n\ndata: {"done":true}\n\n');}
 else if(req.url==='/api/lukas/verbrauch/auftraege/fixture-job/abnahme'){res.statusCode=201;res.end('{"id":"accept-fixture","rootId":"fixture-job","ergebnis":"erfolgreich"}');}
 else{res.statusCode=404;res.end('{}');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
async function run(args){const p=spawn(process.execPath,[join(root,'scripts/lukas-fallstudie.mjs'),...args],{cwd:root,env:{...process.env,LUKAS_BASE_URL:`http://127.0.0.1:${server.address().port}`,LUKAS_API_TOKEN:'fixture-only',LUKAS_USAGE_READ_TOKEN:'fixture-read-only'},stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',s=>output+=s);p.stderr.on('data',s=>output+=s);const code=await new Promise(r=>p.on('exit',r));return {code,output};}
try{
 assert.equal((await run(['test','--case','tracker-auswertung'])).code,0);assert.equal(requests.length,0,'dry run must not call API');
 assert.notEqual((await run(['test','--case','tracker-auswertung','--execute'])).code,0);assert.equal(requests.length,0,'unfunded run must not call API');
 const out=join(dir,'result.json');const result=await run(['test','--case','tracker-auswertung','--execute','--funding-confirmed','--supervised-budget','--out',out]);assert.equal(result.code,0,result.output);
 const saved=JSON.parse(await readFile(out,'utf8'));assert.equal(saved.auftragId,'fixture-job');assert.equal(saved.events[0].content,'usable fixture result');
 const plan=JSON.parse(await readFile(join(root,'docs/fallstudie/faelle.json'),'utf8'));assert.equal(requests[1].body.content,plan.faelle[0].prompt);assert.equal(requests[1].body.fallstudie.abnahme,plan.faelle[0].abnahme);
 assert.notEqual((await run(['test','--case','tracker-auswertung','--execute','--funding-confirmed','--supervised-budget','--out',out])).code,0);assert.equal(requests.length,2,'existing output must fail before another paid task');
 const report=await run(['report','--von','2026-11-13','--bis','2026-11-13','--vergleichVon','2026-11-07','--vergleichBis','2026-11-07','--out',join(dir,'report.json')]);assert.equal(report.code,0,report.output);assert.match(requests[2].url,/vergleichVon=2026-11-07/);
 const accept=await run(['accept','--auftrag','fixture-job','--result','erfolgreich','--evidence',out]);assert.equal(accept.code,0,accept.output);assert.match(requests[3].body.beleg,/SHA-256/);
 console.log('PASS test client against local HTTP fixture only: same chat API, unchanged prompt, funding gates, no duplicate execution, signed export and separate acceptance');
}finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
