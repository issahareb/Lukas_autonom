import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
const dir = mkdtempSync(resolve('.hinweis-check-'));
try {
  const stub = join(dir, 'stub.mjs');
  writeFileSync(stub, `
export const telefonAnrufe={id:'id'};
export const eq=(field,value)=>({field,value});
export const db={select:()=>({from:()=>({where:condition=>({limit:async()=>globalThis.hintCall?.id===condition.value?[globalThis.hintCall]:[]})})})};
export const fluestereLiveTelefon=(...args)=>{globalThis.hintSent.push(args);return globalThis.hintResult;};
`);
  const out = join(dir, 'hinweis.mjs');
  await build({entryPoints:['src/lib/telefon-hinweis.ts'],outfile:out,bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'isolate',setup(b){b.onResolve({filter:/^(@workspace\/db|drizzle-orm|\.\/ai\/live-session)$/},()=>({path:stub}));}}]});
  const { telefonHinweis } = await import(out);
  globalThis.hintCall={id:7,kontextId:'verified-context',richtung:'ausgehend',zielStatus:'in-progress',sipStatus:'in-progress',liveBereit:true,conversationId:3};
  globalThis.hintSent=[]; globalThis.hintResult=true;
  await assert.rejects(telefonHinweis(7,'Private details',4),/nicht zu diesem Chat/);
  await assert.rejects(telefonHinweis(8,'Wrong call',3),/nicht mehr/);
  assert.equal(hintSent.length,0);
  assert.match(await telefonHinweis(7,'Delivery?',3),/übermittelt/);
  assert.deepEqual(hintSent.pop(),['verified-context','Delivery?',false]);
  hintCall.zielStatus='completed';
  await assert.rejects(telefonHinweis(7,'Late hint',3),/nicht mehr/);
  hintCall.zielStatus='ringing';hintCall.liveBereit=false;hintResult='queued';
  assert.match(await telefonHinweis(7,'Before answer',3),/vorgemerkt/);
  assert.deepEqual(hintSent.pop(),['verified-context','Before answer',true]);
  hintResult=false;hintCall.liveBereit=true;
  await assert.rejects(telefonHinweis(7,'Disconnected',3),/noch nicht/);
  console.log('OK — Telefonhinweise: genaue Anruf-/Chat-Zuordnung, bestätigte Übermittlung, Vormerken, Ende und Verbindungsfehler.');
} finally { rmSync(dir,{recursive:true,force:true});delete globalThis.hintCall;delete globalThis.hintSent;delete globalThis.hintResult; }
