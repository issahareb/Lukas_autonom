import assert from 'node:assert/strict';
import express from 'express';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run the actual dashboard HTTP route and tool loop. Only external systems
// (DB, model, tool execution and side effects) are stubbed. Routing, tool
// selection, prompt modules and the access-error filter remain real.
const directory = await mkdtemp(join(process.cwd(), '.chat-access-check-'));
const deploymentEnvironment = { DATABASE_URL: process.env.DATABASE_URL, LUKAS_WORK_PROGRESS: process.env.LUKAS_WORK_PROGRESS };
// Exercise production's journal-enabled path with the isolated pg adapter.
// Never inherit a real deployment database URL or an ambient disable flag.
process.env.DATABASE_URL = 'postgresql://fixture.invalid/chat-access';
delete process.env.LUKAS_WORK_PROGRESS;
let server;
const state = { calls: [], modelCalls: 0, rows: [], statuses: [] };
globalThis.__chatAccessCheck = state;
const names = ['email_search', 'email_read', 'email_send', 'execute_on_host', 'query_memory'];
state.tools = names.map(name => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } }));
state.model = async ({ tools, messages }) => {
  const n = state.modelCalls++;
  const available = (tools ?? []).map(t => t.function.name);
  if (n === 0) {
    assert.ok(available.includes('email_search'));
    return { content: '', toolCalls: [{ id: 'mail', name: 'email_search', arguments: '{"limit":1}' }] };
  }
  if (n === 1) {
    assert.ok(available.includes('execute_on_host'), 'mail error must not disable the independent VPS check');
    assert.ok(!available.some(name => name.startsWith('email_')), 'mail siblings share the missing credential');
    assert.ok(messages.some(m => m.role === 'tool' && m.content.includes('EMAIL_USER')));
    return { content: '', toolCalls: [{ id: 'host', name: 'execute_on_host', arguments: '{"command":"hostname"}' }] };
  }
  assert.equal(n, 2, 'only one attempt per unavailable access');
  assert.ok(!available.includes('execute_on_host'));
  assert.ok(available.includes('query_memory'), 'unrelated capabilities remain available');
  assert.ok(messages.some(m => m.role === 'tool' && m.content.includes('VPS_SSH_KEY')));
  return { content: 'E-Mail: EMAIL_USER fehlt. VPS: VPS_SSH_KEY wurde abgelehnt.', toolCalls: [] };
};
const modules = {
  '@workspace/db': `
    export const pool={};
    export const conversations={name:'conversations',id:'id'};
    export const messages={name:'messages',conversationId:'conversationId',createdAt:'createdAt'};
    export const attachments={name:'attachments',conversationId:'conversationId',messageId:'messageId'};
    const state=globalThis.__chatAccessCheck;
    function chain(result){const c={then:(a,b)=>Promise.resolve(result).then(a,b)};
      for(const name of ['where','orderBy','limit','returning']) c[name]=()=>c; return c;}
    export const db={select:()=>({from:table=>chain(table===conversations?[{id:1}]:state.rows)}),
      update:()=>({set:()=>chain([])}),insert:()=>({values:row=>{
        const saved={...row,id:state.rows.length+1,createdAt:new Date()};state.rows.push(saved);return chain([saved]);}})};`,
  'verbrauch-auftrag': `export const markiereAuftrag=()=>{}; export const aktuellerAuftragId=()=> 'test-root';
export const mitVerbrauchsAuftrag=(_q,_id,fn)=>fn();
    export const auftragsStatus=status=>globalThis.__chatAccessCheck.statuses.push(status);`,
  'lukas-tools': `import {waehleWerkzeuge} from ${JSON.stringify(resolve('src/lib/werkzeug-auswahl.ts'))};
    export const allLukasTools=async(task,discovered)=>discovered
      ?globalThis.__chatAccessCheck.tools.filter(t=>discovered.includes(t.function.name))
      :globalThis.__chatAccessCheck.filterTools?waehleWerkzeuge(globalThis.__chatAccessCheck.tools,task):globalThis.__chatAccessCheck.tools;
    export async function executeLukasTool(name,input){globalThis.__chatAccessCheck.calls.push({name,input});
      if(globalThis.__chatAccessCheck.execute)return globalThis.__chatAccessCheck.execute(name,input);
      throw new Error(name==='email_search'?'EMAIL_USER fehlt':'VPS_SSH_KEY: All configured authentication methods failed');}`,
  'pg': `export default {Client:class {
    on(){} async connect(){} async end(){}
    async query(sql,args){
      const state=globalThis.__chatAccessCheck;
      if(sql.includes('pg_try_advisory_lock'))return {rows:[{ok:true}]};
      if(sql.startsWith('SELECT auftrag'))return {rows:state.progressJournal?[structuredClone(state.progressJournal)]:[]};
      return {rows:[]};
    }
  }};`,
  'owner-call-grant': 'export const ownerCallGrantFromMessage=()=>undefined;',
  'bildablage': 'export const nimmBilder=()=>[]; export const entwerteAlteBilder=()=>{}; export const BILD_MARKE="";',
  'lernen': 'export const merkeErfahrung=()=>{};',
  'emotion-engine': 'export const fuehleWerkzeug=()=>{};',
  'reflection': 'export const maybeReflect=()=>{};',
  'system-prompt': `import {waehleLukasPrompt} from ${JSON.stringify(resolve('src/lib/lukas-prompt-auswahl.ts'))};
    export const buildSystemPrompt=async(user,opts)=>{
      const prompt=waehleLukasPrompt([user,opts.routingTask].join(' '));
      globalThis.__chatAccessCheck.promptModules=prompt.module;
      return prompt.stabil+prompt.dynamisch;};`,
  'logger': 'export const logger={info(){},warn(){},error(){}};',
  'debug-log': 'export const recordDebugEvent=()=>{};',
  'attachments': 'export const attachmentKind=()=>"text";',
  'video-frames': 'export const extractVideoFrames=async()=>({ok:false});',
  'conversation-memory': 'export const rememberAssistantMessage=()=>{}; export const rememberUserMessage=()=>{};',
  'model-client': 'export const callLukasModel=input=>globalThis.__chatAccessCheck.model(input);',
  'voice-renderer': 'export const renderLukasVoice=async input=>input.draft;',
};
try {
  const output=join(directory,'route.mjs');
  const plugins=[{
    name:'chat-access-external-systems',setup(b){
      b.onResolve({filter:/.*/},args=>{
        if(args.kind==='entry-point') return;
        const key=args.path==='@workspace/db'?args.path:args.path.split('/').at(-1);
        if(Object.hasOwn(modules,key)) return {path:key,namespace:'access-stub'};
        if(args.namespace==='access-stub'&&args.path.startsWith('/')) return {path:args.path,namespace:'file'};
      });
      b.onLoad({filter:/.*/,namespace:'access-stub'},args=>({contents:modules[args.path],loader:'js'}));
    }
  }];
  await build({entryPoints:['src/routes/anthropic.ts'],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins});
  const {default:router}=await import(pathToFileURL(resolve(output)).href);
  const app=express();app.use(express.json());app.use(router);
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});
  const response=await fetch(`http://127.0.0.1:${server.address().port}/anthropic/conversations/1/messages`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:'Prüfe Mail und VPS jeweils einmal.'}),signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,200);
  const body=await response.text();
  assert.deepEqual(state.calls,[{name:'email_search',input:{limit:1}},{name:'execute_on_host',input:{command:'hostname'}}]);
  assert.equal(state.modelCalls,3);
  assert.ok(state.statuses.includes('blockiert'));
  assert.match(body,/EMAIL_USER fehlt/);assert.match(body,/VPS_SSH_KEY wurde abgelehnt/);
  assert.match(body,/"done":true/);
  const answer=state.rows.find(row=>row.role==='assistant');
  assert.equal(answer.steps.length,2);assert.ok(answer.steps.every(step=>step.ok===false));
  console.log('OK — Dashboard HTTP route: mailbox failure preserves independent SSH check, exact errors reach the model and response, both failed steps persist.');

  // Exercise both real entry points. A fresh topic must drop stale prompt
  // modules AND schemas; repeated continuations must retain the original task.
  const brainOutput=join(directory,'brain.mjs');
  await build({entryPoints:['src/lib/lukas-brain.ts'],outfile:brainOutput,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins});
  const {runLukasTurn}=await import(pathToFileURL(resolve(brainOutput)).href);
  const phoneOutput=join(directory,'phone-chat.mjs');
  await build({entryPoints:['src/lib/owner-phone-chat.ts'],outfile:phoneOutput,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins});
  const {createOwnerPhoneChat}=await import(pathToFileURL(resolve(phoneOutput)).href);
  const phoneChat=await createOwnerPhoneChat(7,{create:async()=>1,
    start:async(_id,text)=>{state.rows.push({role:'user',content:text});const history=[...state.rows];const messageId=state.rows.length;state.rows.push({role:'assistant',content:'pending'});return {messageId,history};},
    save:async(id,text,steps)=>{state.rows[id]={role:'assistant',content:text,steps};}});

  const fixtureNames=['github_read_path','github_search_code','execute_command','email_search','email_send',
    'telefon_kontakte','ruf_an','lese_anfragen','mcp_find_tool','mcp_call','query_memory'];
  state.tools=fixtureNames.map(name=>({type:'function',function:{name,parameters:{type:'object',properties:{}}}}));
  state.filterTools=true;
  let offered;
  state.model=async input=>{offered=input;return {content:'Antwort.',toolCalls:[]};};
  const cases=[
    {before:['Implementiere einen Cache im TypeScript Repo'],current:'Wie viele Website-Anfragen kamen heute rein?',modules:[],has:['lese_anfragen'],missing:['github_read_path','email_search','ruf_an']},
    {before:['Implementiere einen Cache im TypeScript Repo'],current:'Rufe einen Kontakt an',modules:['telefon'],has:['ruf_an'],missing:['github_read_path','email_search']},
    {before:['Implementiere einen Cache im TypeScript Repo'],current:'Hallo',modules:[],has:[],missing:['github_read_path','email_search','ruf_an']},
    {before:['Implementiere einen Cache im TypeScript Repo'],current:'Prüfe mein E-Mail-Postfach',modules:['email'],has:['email_search'],missing:['github_read_path','ruf_an']},
    {before:['Implementiere einen Cache im TypeScript Repo','weiter','weiter'],current:'Ja, mach das',modules:['code','diagnose'],has:['github_read_path','execute_command'],missing:['email_search','ruf_an']},
    {before:['Prüfe mein E-Mail-Postfach'],current:'Prüfe das TypeScript Repository und rufe einen Kontakt an',modules:['code','telefon','diagnose'],has:['github_read_path','ruf_an'],missing:['email_search']},
  ];
  for(const channel of ['dashboard','brain','owner-phone']) for(const scenario of cases){
    const history=scenario.before.flatMap(content=>[{role:'user',content},{role:'assistant',content:'Bisherige Antwort.'}]);
    offered=undefined;state.promptModules=undefined;
    if(channel==='dashboard'){
      state.rows=history;
      const reply=await fetch(`http://127.0.0.1:${server.address().port}/anthropic/conversations/1/messages`,{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:scenario.current}),signal:AbortSignal.timeout(10000)});
      assert.equal(reply.status,200);assert.match(await reply.text(),/"done":true/);
    }else if(channel==='owner-phone'){
      state.rows=history;assert.equal(await phoneChat.run(scenario.current,''),'Antwort.');
    }else{
      assert.equal(await runLukasTurn({userText:scenario.current,history:[...history,{role:'user',content:scenario.current}],conversationId:1}),'Antwort.');
    }
    const label=channel+': '+scenario.current;
    const available=offered.tools.map(tool=>tool.function.name);
    for(const name of scenario.has) assert.ok(available.includes(name),label+' requires '+name);
    for(const name of scenario.missing) assert.ok(!available.includes(name),label+' must drop '+name);
    const domainModules=state.promptModules.filter(name=>['code','diagnose','telefon','email'].includes(name));
    assert.deepEqual(domainModules,scenario.modules,label+' prompt modules');
    if(scenario.current==='Hallo') assert.deepEqual(available,[],label+' requires no tools');
    else assert.ok(available.includes('mcp_find_tool')&&available.includes('mcp_call'),label+' keeps discovery');
  }
  await runLukasTurn({userText:'Implementiere TypeScript Code',history:[],tools:[],systemPromptOverride:'Public only',conversationId:1});
  assert.deepEqual(offered.tools,[],'explicitly tool-free turns stay tool-free');
  assert.equal(offered.messages[0].content,'Public only','explicit prompt override remains authoritative');
  console.log('OK — 18 real dashboard/brain/owner-phone scenarios: topic changes drop stale tools and prompt modules, repeated continuations and compound tasks retain needed capabilities; overrides remain intact.');

  const turn=async(channel,text)=>{
    state.rows=[];state.modelCalls=0;
    if(channel==='owner-phone')return phoneChat.run(text,'');
    if(channel==='brain')return runLukasTurn({userText:text,history:[{role:'user',content:text}],conversationId:1});
    const response=await fetch(`http://127.0.0.1:${server.address().port}/anthropic/conversations/1/messages`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:text}),signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,200);assert.match(await response.text(),/"done":true/);
  };
  state.tools.push({type:'function',function:{name:'save_memory',parameters:{type:'object',properties:{content:{type:'string'}},required:['content']}}});
  state.tools.push({type:'function',function:{name:'web_search',parameters:{type:'object',properties:{}}}});
  for(const channel of ['dashboard','brain','owner-phone']){
    state.execute=async name=>name==='mcp_find_tool'?'■ save_memory [Eigenes Werkzeug]\nSchema: content required':'Erinnerung gespeichert.';
    state.model=async({tools,messages})=>{
      const names=tools.map(t=>t.function.name);const n=state.modelCalls++;
      if(n===0){assert.ok(!names.includes('save_memory'));return {content:'',toolCalls:[{id:'discover',name:'mcp_find_tool',arguments:'{"query":"save_memory"}'}]};}
      assert.ok(names.includes('save_memory'),'discovery promotes the full definition on '+channel);
      assert.deepEqual(tools.find(t=>t.function.name==='save_memory').function.parameters.required,['content']);
      assert.ok(messages.some(m=>m.role==='tool'&&m.tool_call_id==='discover'));
      return {content:'Antwort.',toolCalls:[]};
    };
    await turn(channel,'Erfasse diese Information für später');
    let active=0,peak=0;
    state.execute=async name=>{active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));if(name==='github_read_path')await new Promise(r=>setImmediate(r));active--;return name+' result';};
    state.model=async({messages})=>{
      if(state.modelCalls++===0)return {content:'',toolCalls:[{id:'first',name:'github_read_path',arguments:'{}'},{id:'second',name:'web_search',arguments:'{}'}]};
      assert.deepEqual(messages.filter(m=>m.role==='tool').map(m=>m.tool_call_id),['first','second'],'reverse finishes preserve model correlation');
      return {content:'Antwort.',toolCalls:[]};
    };
    await turn(channel,'Prüfe das TypeScript Repository und suche aktuelle Quellen');assert.equal(peak,2,'real '+channel+' loop overlaps independent reads');
  }
  console.log('PASS real dashboard/brain loops: discovery loads full definitions; independent reads overlap while tool results retain call order.');
  const {toolHarness}=await import('../bench/tool-harness.mjs');const catalog=await toolHarness();
  try {
    state.tools=catalog.api.LUKAS_TOOLS;
    const tasks=['Lies mein E-Mail-Postfach','Sende eine E-Mail','Lies package.json im Repository','Implementiere einen Cache im TypeScript Repo',
      'Bediene den Browser und klicke auf das Formular','Suche aktuelle Quellen im Internet','Speichere meine Vorliebe im Gedächtnis',
      'Erstelle ein Ziel und aktualisiere seinen Fortschritt','Prüfe den Tokenverbrauch','Lies die Diagnose zum Fehler',
      'Plane einen Rückruf in fünf Minuten','Rufe einen Kontakt an','Schicke eine SMS','Delegiere die Recherche an einen Subagenten',
      'Erstelle ein Video über Higgsfield','Nenne die Aufrufzahlen von Hareb Digital'];
    for(const text of tasks){
      const offers=[];
      state.model=async request=>{offers.push(request.tools.map(t=>t.function.name).sort());return {content:'Antwort.',toolCalls:[]};};
      await turn('dashboard',text);await turn('owner-phone',text);
      assert.deepEqual(offers[1],offers[0],text+' must offer identical canonical tools over owner phone and dashboard');
    }
    console.log('PASS full catalogue parity: 16 task families offer identical canonical tools in actual dashboard and owner-phone loops.');
  }finally{await rm(catalog.dir,{recursive:true,force:true});}


  // PR #39 regression matrix: external DB/model/dispatch are stubs; journal,
  // dashboard/brain/owner-phone loops, tool selection and routing stay real.
  const failures=[];
  const verify=(label,check)=>{try{check();console.log('PASS PR39 '+label);}catch(error){failures.push(label+': '+error.message);console.log('FAIL PR39 '+label+': '+error.message);}};
  state.tools=fixtureNames.map(name=>({type:'function',function:{name,parameters:{type:'object',properties:{}}}}));
  for(const channel of ['dashboard','brain','owner-phone']){
    const offers=[];
    state.execute=async name=>{if(name==='email_search')throw new Error('EMAIL_USER fehlt');return '■ email_send [Eigenes Werkzeug]\nSchema: to required';};
    state.model=async({tools})=>{
      offers.push(tools.map(t=>t.function.name));const n=state.modelCalls++;
      if(n===0)return {content:'',toolCalls:[{id:'mail',name:'email_search',arguments:'{}'}]};
      if(n===1)return {content:'',toolCalls:[{id:'discover',name:'mcp_find_tool',arguments:'{"query":"email_send"}'}]};
      return {content:'Antwort.',toolCalls:[]};
    };
    await turn(channel,'Lies mein E-Mail-Postfach');
    verify(channel+' credential discovery',()=>{
      assert.equal(offers.length,3);assert.ok(!offers[0].includes('email_send'));
      assert.ok(!offers[2].includes('email_send'),'email_send must remain blocked after discovery');
    });
  }
  const savedDatabaseUrl=process.env.DATABASE_URL,savedProgressFlag=process.env.LUKAS_WORK_PROGRESS;
  process.env.DATABASE_URL='postgresql://fixture.invalid/test';delete process.env.LUKAS_WORK_PROGRESS;
  state.progressJournal={auftrag:'Implementiere einen Cache im TypeScript Repo',status:'interrupted',schritte:[]};
  for(const finalCall of [false,true])for(const channel of ['dashboard','brain','owner-phone']){
    const routes=[];state.execute=async()=> 'Memory result';
    state.model=async input=>{
      routes.push(input.route.profile);state.modelCalls++;
      if(finalCall&&state.modelCalls===1)return {content:'',toolCalls:[{id:'memory',name:'query_memory',arguments:'{}'}],usage:{rein:500000,raus:0}};
      return {content:'Antwort.',toolCalls:[]};
    };
    await turn(channel,'weiter');
    verify(channel+' journal continuation'+(finalCall?' with final call':''),()=>{
      assert.deepEqual(routes,finalCall?['code','code']:['code']);
    });
  }
  if(savedDatabaseUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=savedDatabaseUrl;
  if(savedProgressFlag===undefined)delete process.env.LUKAS_WORK_PROGRESS;else process.env.LUKAS_WORK_PROGRESS=savedProgressFlag;
  delete state.progressJournal;
  if(failures.length){console.log('PR39 FAILURES '+JSON.stringify(failures));process.exitCode=1;}

} finally {
  for (const [key, value] of Object.entries(deploymentEnvironment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  delete globalThis.__chatAccessCheck;
  await rm(directory,{recursive:true,force:true});
}
