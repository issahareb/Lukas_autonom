import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { toolHarness } from './tool-harness.mjs';

const baselineRef=process.env.LUKAS_BENCH_BASELINE??'0f7e3a0';
const cases=[
  {id:'greeting',task:'Hallo',required:[]},
  {id:'missing-context',task:undefined,required:['mcp_find_tool','mcp_call']},
  {id:'website-requests',task:'Wie viele Website-Anfragen kamen heute rein?',required:['lese_anfragen']},
  {id:'mail-read',task:'Lies mein E-Mail-Postfach',required:['email_search','email_read']},
  {id:'mail-send',task:'Schreibe eine E-Mail an einen Kunden',required:['email_send']},
  {id:'phone-start',task:'Rufe einen Kontakt an',required:['ruf_an','telefon_kontakte']},
  {id:'callback-status',task:'Prüfe den Status meiner geplanten Rückrufe',required:['rueckruf_status']},
  {id:'memory',task:'Erinnere dich an meine Vorlieben zu Tensa',required:['query_memory']},
  {id:'code-read',task:'Lies package.json im Repository',required:['github_read_path']},
  {id:'code-fix',task:'Implementiere einen Cache im TypeScript Repo',required:['execute_command','github_read_path']},
  {id:'public-research',task:'Was kostet die Jahreskarte im Grugapark? Quelle bitte',required:['web_search']},
  {id:'face',task:'Guck böse',required:['set_expression']},
];
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const before=await toolHarness({baselineRef});const after=await toolHarness();
try{
  assert.deepEqual(after.api.LUKAS_TOOLS,before.api.LUKAS_TOOLS,'paired comparison uses identical built-in schemas');
  globalThis.__toolBenchServers=[];
  const rows=[];
  for(const c of cases){
    const measures=[];
    for(const {api} of [before,after]){
      const tools=await api.allLukasTools(c.task);
      globalThis.__toolBenchRequests=[];
      await api.callLukasModel({route:{provider:'openai',model:'gpt-6-luna',profile:'fast',reason:'offline schema capture'},tools,messages:[{role:'user',content:c.task??'No task supplied'}]});
      const request=globalThis.__toolBenchRequests.at(-1);
      const schemas=request.tools??[];
      const timings=[];
      for(let i=0;i<500;i++){
        const start=performance.now();JSON.stringify(api.waehleWerkzeuge(api.LUKAS_TOOLS,c.task));timings.push(performance.now()-start);
      }
      measures.push({definitions:schemas.length,utf8Bytes:Buffer.byteLength(JSON.stringify(schemas)),selectionAndSerializationMedianMs:median(timings),names:schemas.map(t=>t.name)});
    }
    for(const required of c.required)assert.ok(measures[1].names.includes(required),c.id+' requires '+required);
    assert.ok(measures[1].definitions<measures[0].definitions,c.id+' must load fewer definitions');
    if(c.id==='greeting')assert.equal(measures[1].definitions,0);
    if(c.id==='missing-context')assert.equal(measures[1].definitions,2);
    if(c.id==='website-requests')assert.deepEqual([...measures[1].names].sort(),['lese_anfragen','mcp_call','mcp_find_tool']);
    if(c.id==='mail-read')assert.ok(!measures[1].names.includes('email_send'));
    if(c.id==='callback-status')assert.ok(!measures[1].names.includes('plane_rueckruf'));
    rows.push({id:c.id,task:c.task??null,requiredSchemasPresent:true,before:measures[0],after:measures[1]});
  }
  // Exercise real discovery and loading: full built-in and external schemas,
  // with an R3 server tier so schema loading cannot silently weaken policy.
  globalThis.__toolBenchServers=[{id:1,enabled:true,slug:'test',name:'Test',riskTier:'R3',selectedTools:[],tools:[{name:'special_read',description:'special_read test fixture',inputSchema:{type:'object',properties:{subject:{type:'string'}},required:['subject']}}]}];
  const discovered=await after.api.mcpFindTool('special_read');
  const loaded=await after.api.allLukasTools(undefined,['mcp__test__special_read','query_memory']);
  assert.match(discovered,/mcp__test__special_read/);assert.equal(loaded.length,2);assert.match(loaded.find(t=>t.function.name==='mcp__test__special_read').function.description,/Freigabe/);
  assert.deepEqual(loaded.find(t=>t.function.name==='mcp__test__special_read').function.parameters.required,['subject']);
  const total=key=>rows.reduce((sum,row)=>sum+row[key].utf8Bytes,0);
  const report={generatedAt:new Date().toISOString(),baselineRef,mode:'offline-real-request-schema-capture',cases:rows,
    summary:{cases:rows.length,beforeSchemaBytes:total('before'),afterSchemaBytes:total('after'),schemaByteReductionPercent:100*(1-total('after')/total('before')),requiredSchemaCoverage:'12/12',discoveryAndR3Policy:'passed'},
    tokenUsage:null,liveLatencyMs:null,realTaskSuccessRate:null,
    limitations:['Schema bytes are measured on the actual serialized OpenAI Responses tool definitions. They are not billed tokens.',
      'Timing is local selection/serialization time, not provider or end-to-end latency. Hardware and warm-up affect it.',
      'Required-schema coverage and the discovery contract are deterministic tests, not live model task success. No paid requests were made.']};
  const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);
  if(output)writeFileSync(resolve(output),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.summary,null,2));
  console.table(rows.map(r=>({task:r.id,toolsBefore:r.before.definitions,toolsAfter:r.after.definitions,bytesBefore:r.before.utf8Bytes,bytesAfter:r.after.utf8Bytes})));
}finally{rmSync(before.dir,{recursive:true,force:true});rmSync(after.dir,{recursive:true,force:true});delete globalThis.__toolBenchServers;delete globalThis.__toolBenchRequests;}
