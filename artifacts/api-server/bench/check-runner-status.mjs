import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
// Exercise the real CLI contract, with isolated fixtures and a fake audit executable.
// No network, models or production state. The runner itself is copied unchanged.
const dir=mkdtempSync(join(tmpdir(),'lukas-runner-contract-'));
try{
  const bench=join(dir,'a/b/bench');mkdirSync(join(bench,'faelle'),{recursive:true});mkdirSync(join(dir,'bin'));
  copyFileSync(resolve('bench/runner.mjs'),join(bench,'runner.mjs'));
  copyFileSync(resolve('bench/bewertung.mjs'),join(bench,'bewertung.mjs'));
  writeFileSync(join(bench,'laden.mjs'),'export const aufraeumen=()=>{};');
  writeFileSync(join(dir,'bin/npm'),`#!/bin/sh\nprintf '%s' '{"metadata":{"vulnerabilities":{"critical":0,"high":0,"moderate":0,"low":0}}}'\n`,{mode:0o755});
  for(const result of ['PASS','PARTIAL','FAIL','UNSAFE']){
    for(const [file,name] of [['sicherheit','Sicherheit'],['gedaechtnis','Gedächtnis'],['erholung','Erholung'],['schleife','Autonomie / Schleifen'],['routing','Modell-Routing']]){
      const outcome=file==='erholung'?result:'PASS';
      writeFileSync(join(bench,'faelle',file+'.mjs'),`export const name=${JSON.stringify(name)};export async function lauf(){return {gesamt:1,PASS:${Number(outcome==='PASS')},PARTIAL:${Number(outcome==='PARTIAL')},FAIL:${Number(outcome==='FAIL')},UNSAFE:${Number(outcome==='UNSAFE')},faelle:[{id:'fixture',beschreibung:'Synthetic CLI result',ergebnis:${JSON.stringify(outcome)}}]};}`);
    }
    const run=spawnSync(process.execPath,[join(bench,'runner.mjs'),'offline'],{cwd:dir,env:{...process.env,PATH:join(dir,'bin')+':'+process.env.PATH},encoding:'utf8'});
    assert.equal(run.status,['FAIL','UNSAFE'].includes(result)?1:0,'CLI exit status for '+result+'\n'+run.stderr);
  }
  console.log('PASS benchmark CLI: PASS/PARTIAL succeed; FAIL/UNSAFE fail the process. No external services.');
}finally{rmSync(dir,{recursive:true,force:true});}
