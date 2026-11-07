import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {toolHarness} from './tool-harness.mjs';
const baseline=JSON.parse(readFileSync('bench/baselines/bedarf-446b6faff.json','utf8'));
const dir=mkdtempSync(resolve('.bedarf-bench-'));
const harness=await toolHarness();
try {
  for(const [name,text] of Object.entries(baseline.files))writeFileSync(join(dir,name),text);
  await build({entryPoints:[join(dir,'werkzeug-auswahl.ts'),join(dir,'lukas-prompt-auswahl.ts')],outdir:join(dir,'out'),bundle:true,format:'esm',platform:'node',outExtension:{'.js':'.mjs'},plugins:[{name:'shared-soul',setup(b){b.onResolve({filter:/^\.\/lukas-soul$/},()=>({path:resolve('src/lib/lukas-soul.ts')}));}}],logLevel:'silent'});
  await build({entryPoints:['src/lib/lukas-prompt-auswahl.ts'],outfile:join(dir,'current.mjs'),bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  const oldTools=await import(pathToFileURL(join(dir,'out/werkzeug-auswahl.mjs')));
  const oldPrompt=await import(pathToFileURL(join(dir,'out/lukas-prompt-auswahl.mjs')));
  const newPrompt=await import(pathToFileURL(join(dir,'current.mjs')));
  const rows=[];
  for(const c of baseline.cases){
    const before=oldPrompt.waehleLukasPrompt(c.task),after=newPrompt.waehleLukasPrompt(c.task);
    assert.equal(after.stabil,before.stabil,'complete stable instruction core is unchanged');
    const measurements=[];
    for(const tools of [oldTools.waehleWerkzeuge(harness.api.LUKAS_TOOLS,c.task),harness.api.waehleWerkzeuge(harness.api.LUKAS_TOOLS,c.task)]){
      globalThis.__toolBenchRequests=[];
      await harness.api.callLukasModel({route:{provider:'openai',model:'gpt-6-luna',profile:'fast',reason:'offline selection replay'},tools,messages:[{role:'user',content:c.task}]});
      const schemas=globalThis.__toolBenchRequests.at(-1).tools??[];
      measurements.push({tools:schemas.length,schemaBytes:Buffer.byteLength(JSON.stringify(schemas)),names:schemas.map(t=>t.name)});
    }
    assert.ok(measurements[1].names.includes('query_memory'),'memory lookup stays available');
    assert.ok(measurements[1].names.includes('mcp_find_tool'),'lazy loading stays available');
    rows.push({id:c.id,promptCharsBefore:before.stabil.length+before.dynamisch.length,promptCharsAfter:after.stabil.length+after.dynamisch.length,modulesBefore:before.module,modulesAfter:after.module,before:measurements[0],after:measurements[1]});
  }
  const sum=f=>rows.reduce((s,r)=>s+f(r),0);
  const report={baselineRef:baseline.baselineRef,mode:'offline-original-prompt-replay',cases:rows,summary:{promptCharsBefore:sum(r=>r.promptCharsBefore),promptCharsAfter:sum(r=>r.promptCharsAfter),schemaBytesBefore:sum(r=>r.before.schemaBytes),schemaBytesAfter:sum(r=>r.after.schemaBytes)},tokenUsage:null,limitations:['Characters and serialized schema bytes are not billed tokens.','Only selected static prompt modules are measured, not the full dynamic system prompt.','No live model requests or task-quality claims. Memory, history and context-window settings are unchanged.']};
  assert.ok(report.summary.promptCharsAfter<report.summary.promptCharsBefore);
  assert.ok(report.summary.schemaBytesAfter<report.summary.schemaBytesBefore);
  const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9);
  if(output)writeFileSync(resolve(output),JSON.stringify(report,null,2)+'\n');
  console.table(rows.map(r=>({case:r.id,promptBefore:r.promptCharsBefore,promptAfter:r.promptCharsAfter,toolsBefore:r.before.tools,toolsAfter:r.after.tools,bytesBefore:r.before.schemaBytes,bytesAfter:r.after.schemaBytes})));
  console.log(JSON.stringify(report.summary));
}finally{rmSync(dir,{recursive:true,force:true});rmSync(harness.dir,{recursive:true,force:true});delete globalThis.__toolBenchRequests;}
