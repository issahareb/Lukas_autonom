import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve,join } from 'node:path';
import pg from 'pg';
const dir=mkdtempSync(resolve('.owner-phone-chat-'));
const state={calls:[],model:async()=> 'Ergebnis mit Link /api/files/example',remembered:[],nextId:701};
globalThis.__ownerPhoneChatTest=state;
let pool;
try {
  const stub=join(dir,'external.mjs');writeFileSync(stub,`
    const s=globalThis.__ownerPhoneChatTest;
    export const pool={query:(...a)=>s.sql.query(...a),connect:()=>s.sql.connect()};
    export const rememberUserMessage=(text,source)=>s.remembered.push({role:'user',text,source});
    export const rememberAssistantMessage=(text,source)=>s.remembered.push({role:'assistant',text,source});
    export const maybeReflect=()=>{};
    export async function runLukasTurn(options){s.calls.push(options);return s.model(options);}
  `);
  const out=join(dir,'chat.mjs');
  await build({stdin:{contents:'export * from "./src/lib/owner-phone-chat.ts"; export * from "./src/lib/chat-work-state.ts";',resolveDir:process.cwd(),loader:'ts'},outfile:out,bundle:true,format:'esm',platform:'node',packages:'external',alias:{'@workspace/db':stub},logLevel:'silent',plugins:[{name:'phone-chat-isolation',setup(b){b.onResolve({filter:/(^|\/)(lukas-brain|conversation-memory|reflection)$/},()=>({path:stub}));}}]});
  const api=await import(out);
  const rows=[],saved=[];
  const store={create:async()=>state.nextId++,start:async(id,text)=>{
    rows.push({role:'user',content:text});const history=[...rows];const messageId=rows.length;rows.push({role:'assistant',content:'pending'});return {messageId,history};},
    save:async(messageId,text,steps)=>{rows[messageId]={role:'assistant',content:text};saved.push({messageId,text,steps:structuredClone(steps)});}};
  await assert.rejects(()=>api.createOwnerPhoneChat(0,store));assert.equal(state.nextId,701);
  const chat=await api.createOwnerPhoneChat(7,store);assert.equal(chat.id,701);
  state.model=async options=>{
    assert.equal(api.laufendeZuege.has(chat.id),true);
    assert.equal(options.conversationId,chat.id);assert.equal(options.telefonOwnerContactId,7);
    assert.equal(options.systemPromptOverride,undefined);assert.equal(options.tools,undefined);
    assert.match(options.systemPromptExtra,/dieselben|dieselbe/);
    assert.ok(options.ownerCallGrant('+4915112345678'));assert.ok(!options.ownerCallGrant('+4915112345678'),'one-use call grant');
    await options.onToolStep({tool:'ruf_an',input:'{}',result:'Anruf gestartet, Annahme noch offen',ok:true,ms:1});
    return 'Anruf gestartet. Annahme noch offen.';
  };
  await chat.run('Ruf +4915112345678 wegen der Anfrage an.','Archivbeleg');
  assert.equal(saved.at(-1).steps.length,1);assert.equal(api.laufendeZuege.has(chat.id),false);
  assert.equal(state.remembered[0].source,'voice');
  state.model=async options=>{assert.equal(options.ownerCallGrant,undefined);assert.ok(options.history.some(m=>m.content==='Anruf gestartet. Annahme noch offen.'));return 'Vollständiges Ergebnis '+ 'x'.repeat(18000)+' /api/files/example';};
  const full=await chat.run('Prüfe jetzt das Repository und erstelle eine Datei.','');assert.equal(saved.at(-1).text,full);assert.ok(full.length>18000);
  let entered;const begun=new Promise(r=>entered=r);
  state.model=async options=>{await options.onToolStep({tool:'github_read_path',input:'{}',result:'bereits gelesen',ok:true,ms:1});entered();await new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));};
  const running=chat.run('Recherchiere weiter.','');await begun;
  assert.equal(api.laufendeZuege.has(chat.id),true);api.stopConversationWork(chat.id);await assert.rejects(()=>running,/gestoppt/);
  assert.match(saved.at(-1).text,/Von dir gestoppt/);assert.equal(saved.at(-1).steps[0].result,'bereits gelesen');assert.equal(api.laufendeZuege.has(chat.id),false);
  const previous=state.calls.length;
  const unavailable=await api.createOwnerPhoneChat(7,{...store,start:async()=>{throw Error('database unavailable');}});
  await assert.rejects(()=>unavailable.run('Sende die Mail.',''),/database unavailable/);assert.equal(state.calls.length,previous,'no tool/model dispatch without durable user turn');
  console.log('PASS owner phone chat: positive persistent context, no tool/prompt override, current-word one-use grants, follow-up history, full files/links, evidence checkpoints, shared dashboard stop and persistence-before-dispatch.');
  if(process.env.BENCH_DATABASE_URL){
    pool=new pg.Pool({connectionString:process.env.BENCH_DATABASE_URL});state.sql=pool;
    let sqlChat;
    try{
      sqlChat=await api.createOwnerPhoneChat(7);
      state.model=async options=>{assert.ok(options.conversationId>0);await options.onToolStep({tool:'email_send',input:'{}',result:'Freigabe steht aus',ok:false,ms:1});return 'Die Mail wartet auf deine Freigabe.';};
      await sqlChat.run('Bereite eine Mail vor.','');
      const result=await pool.query('SELECT * FROM lukas_messages WHERE conversation_id=$1 ORDER BY id',[sqlChat.id]);
      assert.equal(result.rows.length,2);assert.equal(result.rows[0].role,'user');assert.equal(result.rows[1].steps[0].tool,'email_send');
      const approval=await pool.query("INSERT INTO lukas_approvals(conversation_id,tool,arguments_hash,arguments_preview,reason,risk_tier,status,expires_at) VALUES($1,'email_send','fixture','fixture','fixture','R2','pending',now()+interval '1 minute') RETURNING id",[sqlChat.id]);
      assert.ok(approval.rows[0].id);
      console.log('PASS PostgreSQL owner phone chat: dashboard conversation/messages, tool evidence and conversation-scoped approval.');
    }finally{if(sqlChat){await pool.query("DELETE FROM lukas_approvals WHERE conversation_id=$1 AND arguments_hash='fixture'",[sqlChat.id]);await pool.query('DELETE FROM lukas_conversations WHERE id=$1',[sqlChat.id]);}}
  }else console.log('SKIP owner phone chat PostgreSQL: BENCH_DATABASE_URL is not set.');
}finally{await pool?.end();delete globalThis.__ownerPhoneChatTest;rmSync(dir,{recursive:true,force:true});}
