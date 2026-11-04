import { performance } from 'node:perf_hooks';
import { rmSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toolHarness } from './tool-harness.mjs';

// Explicit opt-in only. All tools are fixtures: this measures real model use,
// but never sends emails, calls a phone or changes production state.
if(!process.argv.includes('--allow-paid'))throw new Error('Live benchmark requires --allow-paid; never run automatically in CI.');
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);
const save=report=>{if(output)writeFileSync(resolve(output),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));};
if(!process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim()){
  save({status:'skipped',reason:'No configured local AI_INTEGRATIONS_OPENAI_API_KEY; existing production credentials were not changed.',tokenUsage:null,liveLatencyMs:null,taskSuccess:null});
  process.exit(0);
}
const before=await toolHarness({baselineRef:process.env.LUKAS_BENCH_BASELINE??'0f7e3a0',live:true});
const after=await toolHarness({live:true});
const fixtures=[
  {id:'requests',task:'Wie viele Website-Anfragen kamen heute rein? Antworte nur als JSON {"anzahl": ZAHL}.',tools:['lese_anfragen'],field:'anzahl',expected:17},
  {id:'memory',task:'Erinnere dich an meine gespeicherte Lieblingsfarbe. Antworte nur als JSON {"farbe":"FARBE"}.',tools:['query_memory'],field:'farbe',expected:'violett'},
  {id:'callbacks',task:'Wie viele geplante Rückrufe gibt es? Antworte nur als JSON {"anzahl": ZAHL}.',tools:['rueckruf_status'],field:'anzahl',expected:23},
];
const rows=[];let spent=0;const budget=80000;
async function run(api,fixture,variant,repetition){
  let tools=await api.allLukasTools(fixture.task);const messages=[{role:'system',content:'Nutze echte Werkzeugantworten für private Daten. Fehlende Werkzeuge findest du mit mcp_find_tool und mcp_call. Antworte direkt im angefragten Format.'},{role:'user',content:fixture.task}];
  const used=[];let inputTokens=0,outputTokens=0,final='',rounds=0;const models=new Set();const start=performance.now();
  const snapshot=()=>{const m=api.verbrauchsUebersicht();return m.reduce((s,r)=>s+r.ausCache,0);};const cachedBefore=snapshot();
  const fixtureTool=name=>name==='lese_anfragen'?JSON.stringify({anzahl:17}):name==='query_memory'?JSON.stringify({farbe:'violett'}):name==='rueckruf_status'?JSON.stringify({anzahl:23}):null;
  for(;rounds<5&&spent<budget;rounds++){
    const result=await api.callLukasModel({quelle:'sonstige',cacheKey:`tool-eval-${variant}-${fixture.id}-${repetition}`,route:{provider:'openai',model:process.env.LUKAS_BENCH_MODEL??api.directRoute('fast').model,profile:'fast',reason:'paired fixture evaluation'},tools,messages,maxTokens:2048,signal:AbortSignal.timeout(90000)});
    models.add(result.route.model);inputTokens+=result.usage?.rein??0;outputTokens+=result.usage?.raus??0;spent+=(result.usage?.rein??0)+(result.usage?.raus??0);
    if(!result.toolCalls.length){final=result.content;break;}
    messages.push({role:'assistant',content:result.content||null,tool_calls:result.toolCalls.map(c=>({id:c.id,type:'function',function:{name:c.name,arguments:c.arguments}}))});
    for(const call of result.toolCalls){
      let args={};try{args=JSON.parse(call.arguments);}catch{}
      let value;
      if(call.name==='mcp_find_tool'){
        // A controlled catalogue allows a miss to recover through discovery.
        value=fixture.tools.map(name=>{const t=api.LUKAS_TOOLS.find(t=>t.function.name===name);return `■ ${name} [built-in]\nSchema: ${JSON.stringify(t.function.parameters)}`;}).join('\n');
        const loaded=variant==='after'?await api.allLukasTools(undefined,fixture.tools):[];
        const existing=new Set(tools.map(t=>t.function.name));tools=[...tools,...loaded.filter(t=>!existing.has(t.function.name))];
      }else{
        const name=call.name==='mcp_call'?String(args.tool):call.name;
        value=fixtureTool(name)??'Fehler: Im Test nur die angegebenen lesenden Werkzeuge verfügbar.';
        if(fixtureTool(name)!==null)used.push(name);
      }
      messages.push({role:'tool',tool_call_id:call.id,content:value});
    }
  }
  let parsed;try{parsed=JSON.parse(final.replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{}
  return {fixture:fixture.id,variant,repetition,models:[...models],inputTokens,outputTokens,cachedInputTokens:snapshot()-cachedBefore,latencyMs:performance.now()-start,rounds:Math.min(rounds+1,5),toolCalls:used.length,success:fixture.tools.every(t=>used.includes(t))&&parsed?.[fixture.field]===fixture.expected};
}
try{
  globalThis.__toolBenchServers=[];
  for(let repetition=0;repetition<3&&spent<budget;repetition++)for(const fixture of fixtures){
    // Alternate order to reduce warm-up and temporal bias.
    for(const [variant,harness] of repetition%2?[['after',after],['before',before]]:[['before',before],['after',after]]){
      if(spent>=budget)break;
      rows.push(await run(harness.api,fixture,variant,repetition));
    }
  }
  const median=values=>values.length?[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]:null;
  const variants=Object.fromEntries(['before','after'].map(variant=>{const group=rows.filter(r=>r.variant===variant),success=group.filter(r=>r.success);return [variant,{runs:group.length,successes:success.length,successRate:group.length?success.length/group.length:null,medianLatencyMs:median(group.map(r=>r.latencyMs)),inputTokens:group.reduce((s,r)=>s+r.inputTokens,0),outputTokens:group.reduce((s,r)=>s+r.outputTokens,0),tokensPerSuccessfulTask:success.length?group.reduce((s,r)=>s+r.inputTokens+r.outputTokens,0)/success.length:null}];}));
  const comparable=rows.every(r=>{const pair=rows.filter(p=>p.fixture===r.fixture&&p.repetition===r.repetition);return pair.length===2&&r.models.length===1&&pair.every(p=>p.models.length===1&&p.models[0]===r.models[0]);});
  save({status:'measured',provider:'openai',comparableSameModels:comparable,variants,rows,limitations:['Real model usage and wall-clock latency; tool answers are controlled fixtures, not production end-to-end verification.','No Euro price is inferred. Provider models, cache behavior and task mix affect costs.','At most 18 task attempts (9 pairs), five rounds each, stop new requests after 80000 reported tokens.']});
}finally{rmSync(before.dir,{recursive:true,force:true});rmSync(after.dir,{recursive:true,force:true});delete globalThis.__toolBenchServers;delete globalThis.__toolBenchRequests;}
