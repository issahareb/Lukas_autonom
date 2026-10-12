import assert from 'node:assert/strict';
import express from 'express';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run the actual dashboard HTTP route and tool loop. Only external systems
// (DB, model, tools and side effects) are stubbed, not the access-error filter.
const directory = await mkdtemp(join(process.cwd(), '.chat-access-check-'));
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
    export const conversations={name:'conversations',id:'id'};
    export const messages={name:'messages',conversationId:'conversationId',createdAt:'createdAt'};
    export const attachments={name:'attachments',conversationId:'conversationId',messageId:'messageId'};
    const state=globalThis.__chatAccessCheck;
    function chain(result){const c={then:(a,b)=>Promise.resolve(result).then(a,b)};
      for(const name of ['where','orderBy','limit','returning']) c[name]=()=>c; return c;}
    export const db={select:()=>({from:table=>chain(table===conversations?[{id:1}]:state.rows)}),
      update:()=>({set:()=>chain([])}),insert:()=>({values:row=>{
        const saved={...row,id:state.rows.length+1,createdAt:new Date()};state.rows.push(saved);return chain([saved]);}})};`,
  'verbrauch-auftrag': `export const mitVerbrauchsAuftrag=(_q,_id,fn)=>fn();
    export const auftragsStatus=status=>globalThis.__chatAccessCheck.statuses.push(status);`,
  'lukas-tools': `export const allLukasTools=async()=>globalThis.__chatAccessCheck.tools;
    export async function executeLukasTool(name,input){globalThis.__chatAccessCheck.calls.push({name,input});
      throw new Error(name==='email_search'?'EMAIL_USER fehlt':'VPS_SSH_KEY: All configured authentication methods failed');}`,
  'owner-call-grant': 'export const ownerCallGrantFromMessage=()=>undefined;',
  'bildablage': 'export const nimmBilder=()=>[]; export const entwerteAlteBilder=()=>{}; export const BILD_MARKE="";',
  'lernen': 'export const merkeErfahrung=()=>{};',
  'emotion-engine': 'export const fuehleWerkzeug=()=>{};',
  'reflection': 'export const maybeReflect=()=>{};',
  'system-prompt': 'export const buildSystemPrompt=async()=>"Test";',
  'logger': 'export const logger={info(){},warn(){},error(){}};',
  'debug-log': 'export const recordDebugEvent=()=>{};',
  'attachments': 'export const attachmentKind=()=>"text";',
  'video-frames': 'export const extractVideoFrames=async()=>({ok:false});',
  'conversation-memory': 'export const rememberAssistantMessage=()=>{}; export const rememberUserMessage=()=>{};',
  'model-router': 'export const routeLukasModel=()=>({provider:"openai",model:"test"}); export const previousRoutingTask=()=>undefined;',
  'model-client': 'export const callLukasModel=input=>globalThis.__chatAccessCheck.model(input);',
  'voice-renderer': 'export const renderLukasVoice=async input=>input.draft;',
};
try {
  const output=join(directory,'route.mjs');
  await build({entryPoints:['src/routes/anthropic.ts'],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{
    name:'chat-access-external-systems',setup(b){
      b.onResolve({filter:/.*/},args=>{
        if(args.kind==='entry-point') return;
        const key=args.path==='@workspace/db'?args.path:args.path.split('/').at(-1);
        if(Object.hasOwn(modules,key)) return {path:key,namespace:'access-stub'};
      });
      b.onLoad({filter:/.*/,namespace:'access-stub'},args=>({contents:modules[args.path],loader:'js'}));
    }
  }]});
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
} finally {
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  delete globalThis.__chatAccessCheck;
  await rm(directory,{recursive:true,force:true});
}
