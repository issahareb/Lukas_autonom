import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir=mkdtempSync(resolve('.tool-batch-check-'));
try{
  const outfile=join(dir,'batch.mjs');
  await build({entryPoints:['src/lib/tool-batch.ts'],outfile,bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  const {runToolBatch,isParallelRead}=await import(pathToFileURL(outfile));
  const calls=['web_search','github_read_path','email_send','query_memory','fetch_url','browser_do','execute_command','email_read','mcp_call','mcp__third__read'].map((name,id)=>({name,id}));
  let running=0,peak=0; const events=[];
  const result=await runToolBatch(calls,async call=>{
    const read=isParallelRead(call.name);if(!read) assert.equal(running,0,'writes/provenance/browser/unknown tools are barriers');
    events.push('start:'+call.id);running++;peak=Math.max(peak,running);
    await new Promise(resolve=>setImmediate(resolve));
    running--;events.push('end:'+call.id);return call.id;
  });
  assert.deepEqual(result,calls.map(c=>c.id),'model result correlation follows call order');assert.equal(peak,2);
  assert.ok(events.indexOf('end:1')<events.indexOf('start:2'));assert.ok(events.indexOf('end:2')<events.indexOf('start:3'));
  let active=0;peak=0;
  await runToolBatch(Array.from({length:13},(_,id)=>({name:'fetch_url',id})),async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;},{concurrency:3});
  assert.equal(peak,3,'read concurrency bounded');
  let completed=false;
  await assert.rejects(runToolBatch([{name:'web_search'},{name:'fetch_url'}],async c=>{if(c.name==='web_search')throw new Error('test failure');await new Promise(resolve=>setImmediate(resolve));completed=true;}),/test failure/);
  assert.equal(completed,true,'siblings drained before error propagation');
  let stopped=false;const started=[];
  await runToolBatch([{name:'email_send'},{name:'web_search'}],async c=>{started.push(c.name);stopped=true;},{stopped:()=>stopped});
  assert.deepEqual(started,['email_send']);
  const controller=new AbortController();controller.abort();
  await assert.rejects(runToolBatch(calls,async()=>assert.fail('must not start'),{signal:controller.signal}),{name:'AbortError'});
  console.log('PASS tool batches: concurrent reads, ordered results, write/provenance/unknown barriers, bounded fan-out, sibling drain, stop and abort.');
}finally{rmSync(dir,{recursive:true,force:true});}
