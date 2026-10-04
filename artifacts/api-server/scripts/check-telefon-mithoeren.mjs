import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import express from 'express';
import { WebSocket } from 'ws';
const dir = mkdtempSync(resolve('.mithoeren-check-'));
let server, stop;
const sockets = [], aborts = [];
try {
  const stub = join(dir, 'db.mjs');
  writeFileSync(stub, `
export const telefonAnrufe = {id:'id',kontextId:'kontextId'}, telefonNummern = {nummer:'nummer'};
export const eq = (field,value) => ({field,value});
export const db = { select:()=>({from:table=>({where:condition=>({limit:async()=>{
 const rows=table===telefonAnrufe?[globalThis.liveCall]:[globalThis.liveContact];
 return rows.filter(row=>row && row[condition.field]===condition.value);
}})})}) };
export const logger={warn(){},error(){},info(){}};
`);
  const out = join(dir, 'live.mjs');
  await build({ stdin:{contents:'export * from "./src/lib/telefon-mithoeren.ts"; export * from "./src/lib/telnyx.ts"; export {lukasAuth} from "./src/middlewares/auth.ts";',resolveDir:process.cwd(),loader:'ts'},
    outfile:out,bundle:true,platform:'node',format:'esm',external:['ws'],
    plugins:[{name:'db',setup(b){b.onResolve({filter:/^(@workspace\/db|drizzle-orm|.*\/logger)$/},()=>({path:stub}));}}] });
  const m=await import(out);
  Object.assign(process.env,{TELNYX_API_KEY:'test-provider',LUKAS_API_TOKEN:'test-owner',LUKAS_PUBLIC_URL:'https://lukas.example.test',OPENAI_PROJECT_ID:'proj_test'});
  const date=new Date('2026-10-04T10:00:00Z');
  globalThis.liveCall={id:1,kontextId:'11111111-1111-4111-8111-111111111111',nummer:'4915112345678',richtung:'ausgehend',providerSid:'v3:root',zielStatus:'in-progress',sipStatus:'in-progress',mithoerenZustimmung:true,mithoerenBestaetigtAm:date};
  globalThis.liveContact={nummer:liveCall.nummer,stufe:'oeffentlich',mithoerenZustimmung:true,mithoerenBestaetigtAm:date};
  const ticket=m.mithoerTicket(liveCall.kontextId);
  assert.equal(m.pruefeMithoerTicket(ticket),liveCall.kontextId);
  assert.equal(m.pruefeMithoerTicket(ticket+'x'),null);
  assert.equal(m.pruefeMithoerTicket(m.telefonKontext('+4915112345678','ausgehend')),null);
  assert.equal(m.pruefeTelefonKontext(ticket),null);
  const now=Date.now; Date.now=()=>now()-13*3600000;
  const expired=m.mithoerTicket(liveCall.kontextId); Date.now=now;
  assert.equal(m.pruefeMithoerTicket(expired),null);
  assert.ok(!m.telnyxXml('+4915112345678','ausgehend','test',liveCall.kontextId,true).includes('<Stream'));
  const xml=m.telnyxXml('+4915112345678','ausgehend','test',liveCall.kontextId,false,true);
  assert.match(xml,/<Start><Stream.*track="both_tracks".*codec="PCMU"/);
  assert.match(xml,/record="do-not-record"/);
  assert.ok(xml.indexOf('<Start>')<xml.indexOf('<Dial'));
  assert.throws(()=>m.telnyxXml('','eingehend','',undefined,false,true));
  const app=express(); app.use(m.lukasAuth); app.get('/api/lukas/telefon/anrufe/:id/live',m.mithoerenAntwort);
  server=app.listen(0,'127.0.0.1'); await once(server,'listening'); stop=m.starteTelefonMithoeren(server);
  const base='http://127.0.0.1:'+server.address().port, path='/api/lukas/telefon/anrufe/1/live';
  assert.equal((await fetch(base+path)).status,401);
  assert.equal((await fetch(base+path+'?token=test-owner')).status,401);
  liveCall.mithoerenZustimmung=false;
  assert.equal((await fetch(base+path,{headers:{Authorization:'Bearer test-owner'}})).status,409);
  liveCall.mithoerenZustimmung=true;
  const connect=async value=>{const ws=new WebSocket(base.replace('http','ws')+'/api/telefon/telnyx/live?ticket='+encodeURIComponent(value));sockets.push(ws);await once(ws,'open');return ws;};
  await assert.rejects(connect('forged'));
  const listen=async()=>{
    const controller=new AbortController();aborts.push(controller);
    const r=await fetch(base+path,{headers:{Authorization:'Bearer test-owner'},signal:controller.signal});
    assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);
    const reader=r.body.getReader();let pending='';
    return {controller, async next(type){
      let timer;
      try {return await Promise.race([(async()=>{for(;;){
        const index=pending.indexOf('\n\n');
        if(index>=0){const data=JSON.parse(pending.slice(6,index));pending=pending.slice(index+2);if(data.type===type)return data;continue;}
        const chunk=await reader.read();assert.equal(chunk.done,false);pending+=new TextDecoder().decode(chunk.value);
      }})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('missing '+type)),3000);})]);}
      finally {clearTimeout(timer);}
    }};
  };
  let listener=await listen();assert.equal((await listener.next('waiting')).type,'waiting');
  const ws=await connect(ticket);let reverseAudio=0;ws.on('message',()=>reverseAudio++);
  const start={event:'start',stream_id:'stream-one',start:{call_control_id:'v3:root',media_format:{encoding:'PCMU',sample_rate:8000,channels:1}}};
  ws.send(JSON.stringify(start));assert.equal((await listener.next('format')).codec,'PCMU');
  const audio=track=>({event:'media',stream_id:'stream-one',media:{track,chunk:'1',timestamp:'0',payload:Buffer.alloc(160,255).toString('base64')}});
  for(const track of ['inbound','outbound']){ws.send(JSON.stringify(audio(track)));assert.equal((await listener.next('audio')).track,track);}
  listener.controller.abort();
  listener=await listen();assert.equal((await listener.next('format')).streamId,'stream-one');
  assert.equal(ws.readyState,WebSocket.OPEN,'Stopping playback leaves the provider stream and call running');
  assert.equal(reverseAudio,0,'Never send browser audio to the provider');
  const wrong=await connect(ticket);wrong.send(JSON.stringify({...start,start:{...start.start,call_control_id:'v3:other'}}));
  assert.equal((await once(wrong,'close'))[0],1008);
  assert.equal(ws.readyState,WebSocket.OPEN);
  assert.equal(m.streamAudio({...audio('inbound'),stream_id:'other'},m.streamFormat(start)),null);
  assert.equal(m.streamFormat({...start,start:{media_format:{encoding:'OPUS',sample_rate:48000,channels:1}}}),null);
  liveContact.mithoerenZustimmung=false;
  const closed=once(ws,'close');
  assert.match((await listener.next('end')).message,/Zustimmung/);await closed;
  liveContact.mithoerenZustimmung=true;liveContact.mithoerenBestaetigtAm=new Date(date.getTime()+1000);
  assert.equal(await m.erlaubterMithoerAnruf(1),null,'Re-enabled consent cannot authorize an old call');
  liveContact.mithoerenBestaetigtAm=date;liveCall.zielStatus='completed';
  assert.equal(await m.erlaubterMithoerAnruf(1),null);
  console.log('OK — Live-Mithören: echter WebSocket/SSE-Audioweg, beide Spuren, Bearer-Schutz, getrennte Zustimmung, Call-Bindung, Widerruf, keine Rückübertragung.');
} finally {
  rmSync(dir,{recursive:true,force:true});
  for(const controller of aborts)controller.abort();
  stop?.();for(const ws of sockets)ws.terminate();
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  delete globalThis.liveCall;delete globalThis.liveContact;
}
