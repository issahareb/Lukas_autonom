import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { publicTarget, startProxy } from './proxy.mjs';
import { createEngine } from './engine.mjs';
import { startServer } from './server.mjs';

test('network validation rejects internal, mapped, rebinding and non-web destinations',async()=>{
  for(const url of ['http://127.0.0.1','http://2130706433','http://10.0.0.1','http://169.254.169.254','http://[::1]','http://[::ffff:7f00:1]','http://[fd00::1]','http://[2002:7f00:1::]','file:///etc/passwd','https://user:password@example.com','https://example.com:22']) await assert.rejects(()=>publicTarget(url));
  await assert.rejects(()=>publicTarget('https://mixed.example',async()=>[{address:'93.184.216.34'},{address:'127.0.0.1'}]));
  let calls=0;const target=await publicTarget('https://public.example',async()=>{calls++;return[{address:'93.184.216.34'}];});
  assert.equal(target.address,'93.184.216.34');assert.equal(calls,1);
});

test('RPC requires authentication and does not execute malformed requests',async()=>{
  const dir=await mkdtemp(tmpdir()+'/lukas-rpc-');let calls=0;
  const app=await startServer({token:'x'.repeat(40),port:0,dataDir:dir,engine:{ready:async()=>{},close:async()=>{},run:async()=>{calls++;return{ok:true};}}});
  try{
    const url=`http://localhost:${app.server.address().port}`;
    assert.equal((await fetch(url+'/operate',{method:'POST',body:'{}'})).status,401);
    assert.equal((await fetch(url+'/healthz')).status,200);
    assert.equal((await fetch(url+'/operate',{method:'POST',headers:{authorization:'Bearer '+'x'.repeat(40)},body:'[]'})).status,400);
    assert.equal(calls,0);
    assert.equal((await fetch(url+'/render',{method:'POST',headers:{authorization:'Bearer '+'x'.repeat(40)},body:'{}'})).status,200);
    assert.equal(calls,1);
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});

test('real Chromium: JS, multi-call state, secret redaction, persistence and isolated sessions',async()=>{
  const dir=await mkdtemp(tmpdir()+'/lukas-engine-');const proxy=await startProxy();
  const fixture=async ctx=>ctx.route('https://93.184.216.34/**',route=>route.fulfill({contentType:'text/html',body:`<html><body><input id="name"><input id="password" type="password"><button id="save" onclick="localStorage.setItem('saved',document.querySelector('#name').value);document.querySelector('#result').textContent=document.querySelector('#name').value;document.cookie='login=yes;max-age=3600'">Save</button><div id="result"></div><script>document.querySelector('#result').textContent=localStorage.getItem('saved')||'JS READY'</script></body></html>`}));
  let engine=createEngine(proxy.address().port,dir,fixture);
  try{
    await engine.ready();
    const render=await engine.run('render',{url:'https://93.184.216.34/',scrolls:0});assert.equal(render.ok,true);assert.match(render.text,/JS READY/);
    let r=await engine.run('operate',{sitzung:'first',schritte:[{art:'oeffne',url:'https://93.184.216.34/'},{art:'tippe',wahl:'#name',text:'kept across calls'}]});assert.equal(r.ok,true);assert.ok(r.bild);
    r=await engine.run('operate',{sitzung:'first',schritte:[{art:'klicke',wahl:'#save'}]});assert.equal(r.ok,true);assert.match(r.text,/kept across calls/);
    r=await engine.run('operate',{sitzung:'second',schritte:[{art:'oeffne',url:'https://93.184.216.34/'}]});assert.doesNotMatch(r.text,/kept across calls/);
    r=await engine.run('operate',{sitzung:'secret',zugang:{PASSWORT:'never-expose-this-secret'},schritte:[{art:'oeffne',url:'https://93.184.216.34/'},{art:'tippe',wahl:'#name',text:'{{PASSWORT}}'},{art:'klicke',wahl:'#save'}]});assert.equal(r.ok,true);assert.equal(r.bild,null);assert.doesNotMatch(JSON.stringify(r),/never-expose-this-secret/);
    r=await engine.run('operate',{sitzung:'first',schritte:[{art:'klicke',wahl:'#missing'},{art:'tippe',wahl:'#name',text:'must not run'}]});assert.equal(r.ok,false);assert.equal(r.schritte.length,1);
    r=await engine.run('render',{url:'http://127.0.0.1/',scrolls:0});assert.equal(r.ok,false);
    await engine.close();engine=createEngine(proxy.address().port,dir,fixture);
    r=await engine.run('operate',{sitzung:'first',schritte:[{art:'warte',ms:1}]});assert.equal(r.ok,true);assert.match(r.text,/kept across calls/);
  }finally{await engine.close();await new Promise(resolve=>proxy.close(resolve));await rm(dir,{recursive:true,force:true});}
});
