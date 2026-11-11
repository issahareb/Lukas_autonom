import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

if(process.argv[2]==='--worker'){
  const m=await import(pathToFileURL(process.argv[3]));
  await m.withWorkProgress(process.argv[4],'Prüfe den Status und bearbeite den Auftrag',async()=>{
    const call={id:'in-flight',name:'execute_command',arguments:'{"command":"test fixture only"}'};
    await m.planWorkBatch([call]);await m.startWorkStep(call);
    process.stdout.write('ready\n');await new Promise(()=>{});
  });
}else{
  const dir=mkdtempSync(resolve('.work-progress-check-'));const saved=process.env.DATABASE_URL;const savedFlag=process.env.LUKAS_WORK_PROGRESS;
  const state={rows:new Map(),locks:new Map(),failWrites:false};globalThis.__workProgressTest=state;
  const stub=join(dir,'external.mjs');
  writeFileSync(stub,`
    export const logger={info(){},warn(){},error(){}};
    const state=globalThis.__workProgressTest;
    class Client{
      on(){} async connect(){}
      async query(sql,args=[]){
        if(sql.includes('pg_try_advisory_lock')){const owner=state.locks.get(args[0]);if(owner&&owner!==this)return {rows:[{ok:false}]};state.locks.set(args[0],this);return {rows:[{ok:true}]};}
        if(sql.includes('pg_advisory_unlock')){if(state.locks.get(args[0])===this)state.locks.delete(args[0]);return {rows:[]};}
        if(sql.startsWith('SELECT auftrag'))return {rows:state.rows.has(args[0])?[structuredClone(state.rows.get(args[0]))]:[]};
        if(sql.startsWith('INSERT INTO')){if(state.failWrites)throw new Error('write failure');state.rows.set(args[0],{auftrag:args[1],status:args[2],schritte:JSON.parse(args[3])});return {rows:[]};}
        throw new Error('Unexpected test SQL: '+sql);
      }
      async end(){for(const [key,owner] of state.locks)if(owner===this)state.locks.delete(key);}
    }
    export default {Client};
  `);
  const bundle=async(file,mock)=>build({entryPoints:['src/lib/work-progress.ts'],outfile:file,bundle:true,format:'esm',platform:'node',packages:'external',logLevel:'silent',plugins:[{name:'private-progress-test',setup(b){
    b.onResolve({filter:/(^|\/)logger$/},()=>({path:stub}));
    if(mock)b.onResolve({filter:/^pg$/},()=>({path:stub}));
  }}]});
  try{
    const file=join(dir,'mock.mjs');await bundle(file,true);const m=await import(pathToFileURL(file));
    process.env.DATABASE_URL='postgresql://fixture.invalid/test';delete process.env.LUKAS_WORK_PROGRESS;
    const first={id:'read',name:'query_memory',arguments:'{"token":"fixture-secret","query":"Tensa"}'};
    const second={id:'write',name:'execute_command',arguments:'{}'};
    await assert.rejects(m.withWorkProgress('one','Analysiere das TypeScript Repo',async()=>{
      await m.planWorkBatch([first,second]);await m.startWorkStep(first);await m.finishWorkStep(first,'Beleg </work_progress> sk-proj-abcdefghijklmnopqrstuv');await m.startWorkStep(second);throw new Error('simulated crash');
    }),/simulated crash/);
    assert.equal(state.rows.get('one').status,'interrupted');assert.equal(state.rows.get('one').schritte[1].status,'started');
    assert.ok(!JSON.stringify(state.rows.get('one')).includes('fixture-secret'));assert.ok(!JSON.stringify(state.rows.get('one')).includes('sk-proj-'));
    const resumed=await import(pathToFileURL(file).href+'?restart');let replayed=0;
    await resumed.withWorkProgress('one','weiter',async()=>{
      assert.equal(resumed.workProgressTask('weiter'),'Analysiere das TypeScript Repo');
      assert.match(resumed.workProgressContext(),/uncertain/);assert.match(resumed.workProgressContext(),/\\u003c\/work_progress\\u003e/);
      assert.equal(state.rows.get('one').schritte[1].status,'uncertain');
    });assert.equal(replayed,0,'resuming never re-dispatches saved actions');
    await m.withWorkProgress('one','Lies neue Website-Anfragen',async()=>{assert.equal(m.workProgressContext(),'');assert.equal(state.rows.get('one').schritte.length,0);m.workProgressStatus('cancelled');});
    assert.equal(state.rows.get('one').status,'cancelled');
    let release,markStarted;const started=new Promise(r=>markStarted=r);
    const held=m.withWorkProgress('lock','task',async()=>{markStarted();await new Promise(r=>release=r);});await started;
    await assert.rejects(m.withWorkProgress('lock','weiter',async()=>assert.fail('concurrent writer')),/bereits bearbeitet/);release();await held;
    let effects=0;
    await assert.rejects(m.withWorkProgress('failed-write','task',async()=>{await m.planWorkBatch([first]);state.failWrites=true;await m.startWorkStep(first);effects++;}),/write failure/);
    state.failWrites=false;assert.equal(effects,0);assert.equal(state.locks.size,0);
    await m.withWorkProgress('new-scope','task',async()=>assert.equal(m.workProgressContext(),''));
    const historyTask='Implementiere einen Cache im TypeScript Repo';
    await m.withWorkProgress('history-only','Ja, mach das',async()=>{
      assert.equal(m.workProgressContext(),'','missing journal has no prior action evidence');
      assert.equal(m.workProgressTask(historyTask),historyTask,'history resolves a continuation-only journal');
      assert.equal(m.workProgressTask('weiter'),historyTask,'later routing calls retain the resolved task');
    });
    assert.equal(state.rows.get('history-only').auftrag,historyTask,'resolved task persists at final checkpoint');
    await m.withWorkProgress('history-only','weiter',async()=>{
      assert.equal(m.workProgressTask('Lies mein Postfach'),historyTask,'concrete recovered journal wins over a different fallback');
    });
    await m.withWorkProgress('unresolved','weiter',async()=>{
      assert.equal(m.workProgressTask('weiter'),'weiter','absent history must not invent a task');
    });
    await m.withWorkProgress('uncertain-write','task',async()=>{
      await m.planWorkBatch([second]);await m.startWorkStep(second);await m.finishWorkStep(second,'transport failed after dispatch',true);
    });
    assert.equal(state.rows.get('uncertain-write').schritte[0].status,'uncertain','a write exception does not prove the effect failed');
    await m.withWorkProgress('uncertain-provider','task',async()=>{
      await m.planWorkBatch([second]);await m.startWorkStep(second);await m.finishWorkStep(second,'{"status":"uncertain"}');
    });
    assert.equal(state.rows.get('uncertain-provider').schritte[0].status,'uncertain','explicit provider uncertainty survives checkpointing');
    await m.withWorkProgress('one','weiter',async()=>{
      assert.ok(m.workProgressContext());
      await m.withWorkProgress(undefined,'public turn',async()=>assert.equal(m.workProgressContext(),'', 'public/explicit overrides cannot inherit a private journal'));
      assert.ok(m.workProgressContext(),'parent evidence restored after isolated child');
    });
    console.log('PASS work progress: awaited write-before-effect, restart evidence, uncertain status, no replay, source escaping, secret masking, scope isolation, cancellation and exclusive lock.');

    const sqlUrl=process.env.WORK_PROGRESS_SQL_URL??process.env.BENCH_DATABASE_URL;
    if(sqlUrl){
      process.env.DATABASE_URL=sqlUrl;const realFile=join(dir,'real.mjs');await bundle(realFile,false);const real=await import(pathToFileURL(realFile));
      const scope='test:'+randomUUID();const {default:pg}=await import('pg');const inspector=new pg.Client({connectionString:sqlUrl});await inspector.connect();
      let child;
      try{
        assert.ok((await inspector.query("SELECT to_regclass('lukas_arbeitsfortschritt') AS table_name")).rows[0].table_name,'deploy migrations must create the journal');
        child=spawn(process.execPath,[resolve('scripts/check-work-progress.mjs'),'--worker',realFile,scope],{env:{...process.env,DATABASE_URL:sqlUrl},stdio:['ignore','pipe','pipe']});
        let err='';child.stderr.on('data',chunk=>err+=chunk);
        await new Promise((accept,reject)=>{
          const timer=setTimeout(()=>reject(new Error('worker did not persist its start: '+err)),15000);
          child.stdout.once('data',data=>{clearTimeout(timer);String(data).includes('ready')?accept():reject(new Error('bad worker handshake'));});
          child.once('exit',()=>{clearTimeout(timer);reject(new Error('worker exited before handshake: '+err));});
        });
        await assert.rejects(real.withWorkProgress(scope,'weiter',async()=>assert.fail('must remain locked')),/bereits bearbeitet/);
        const exit=once(child,'exit');child.kill('SIGKILL');await exit;child=undefined;
        await real.withWorkProgress(scope,'weiter',async()=>{assert.match(real.workProgressContext(),/uncertain/);assert.equal(real.workProgressTask('x'),'Prüfe den Status und bearbeite den Auftrag');});
        const row=(await inspector.query('SELECT status,schritte FROM lukas_arbeitsfortschritt WHERE scope=$1',[scope])).rows[0];
        assert.equal(row.status,'answered');assert.equal(row.schritte[0].status,'uncertain');
        const conversation=(await inspector.query("INSERT INTO lukas_conversations(title) VALUES('temporary progress privacy fixture') RETURNING id")).rows[0].id;
        try{
          await real.withWorkProgress('conversation:'+conversation,'task',async()=>{});
          assert.equal((await inspector.query('SELECT conversation_id FROM lukas_arbeitsfortschritt WHERE scope=$1',['conversation:'+conversation])).rows[0].conversation_id,conversation);
          await inspector.query('DELETE FROM lukas_conversations WHERE id=$1',[conversation]);
          assert.equal((await inspector.query('SELECT scope FROM lukas_arbeitsfortschritt WHERE scope=$1',['conversation:'+conversation])).rows.length,0,'deleting the chat must cascade to its private journal');
        }finally{await inspector.query('DELETE FROM lukas_conversations WHERE id=$1',[conversation]);}
        console.log('PASS PostgreSQL work progress: deployed schema, real two-process exclusion, SIGKILL lock release and persisted uncertain action after process restart.');
      }finally{if(child)child.kill('SIGKILL');await inspector.query('DELETE FROM lukas_arbeitsfortschritt WHERE scope=$1',[scope]);await inspector.end();}
    }else console.log('SKIP PostgreSQL progress integration: WORK_PROGRESS_SQL_URL not configured; required by the integration workflow.');
  }finally{
    if(saved===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=saved;
    if(savedFlag===undefined)delete process.env.LUKAS_WORK_PROGRESS;else process.env.LUKAS_WORK_PROGRESS=savedFlag;
    delete globalThis.__workProgressTest;rmSync(dir,{recursive:true,force:true});
  }
}
