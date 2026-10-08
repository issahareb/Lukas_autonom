import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const dir = await mkdtemp(join(tmpdir(),"lukas-phone-media-")), out=join(dir,"media.mjs");
const previous=globalThis.fetch, keys=["LUKAS_TELEFON_ANBIETER","TELNYX_APP_ID","TELNYX_API_KEY"];
const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
try {
  await build({stdin:{contents:'export * from "./src/lib/ai/live-output-audio.ts"; export * from "./src/lib/telefon-medien-diagnose.ts";',resolveDir:process.cwd(),loader:"ts"},outfile:out,bundle:true,platform:"node",format:"esm",logLevel:"silent"});
  const {LiveOutputAudio,inspectRecentTelefonMedia}=await import(pathToFileURL(out).href);
  const stats=new LiveOutputAudio(), delta=Buffer.from([1,0,0,0]).toString("base64"), silence=Buffer.alloc(4).toString("base64");
  stats.resetContinuity();
  assert.equal(stats.observe({delta,start_ms:0,end_ms:100},0),true);
  assert.equal(stats.observe({delta:silence,start_ms:100,end_ms:200},100),false);
  stats.observe({delta,start_ms:300,end_ms:400},300);
  stats.observe({delta,start_ms:350,end_ms:450},350);
  stats.observe({delta,start_ms:0,end_ms:100},360);
  assert.deepEqual(stats.summary(),{
    events:5,eventsWithSignal:4,invalidEvents:0,timedEvents:5,untimedEvents:0,invalidTimingEvents:0,
    outOfOrderEvents:1,observedDurationMs:350,timelineGaps:1,maxTimelineGapMs:100,maxArrivalGapMs:200,segments:1,
  });
  stats.resetContinuity(); stats.observe({delta,start_ms:10000,end_ms:10100},5000);
  assert.equal(stats.summary().timelineGaps,1);assert.equal(stats.summary().maxArrivalGapMs,200);
  assert.equal(stats.observe({delta},5100),true);
  stats.observe({delta,start_ms:-1,end_ms:10},5200);
  for(const invalid of ["","!!!!","AQ==","AB==","AQI"])assert.equal(stats.observe({delta:invalid},5300),false);
  assert.equal(stats.summary().untimedEvents,1);assert.equal(stats.summary().invalidTimingEvents,1);assert.equal(stats.summary().invalidEvents,5);
  assert.ok(!JSON.stringify(stats).includes(delta),"only metadata persists on the observer");
  const clock=Date.parse("2026-10-08T15:40:00Z"), requests=[];
  Object.assign(process.env,{LUKAS_TELEFON_ANBIETER:"telnyx",TELNYX_APP_ID:"private-app",TELNYX_API_KEY:"private-key"});
  let mode="ok";
  globalThis.fetch=async(input,options)=>{
    const url=new URL(String(input));requests.push(url);
    assert.equal(url.origin,"https://api.telnyx.com");assert.equal(url.pathname,"/v2/detail_records");
    assert.equal(url.searchParams.get("filter[record_type]"),"sip-trunking");
    assert.equal(url.searchParams.get("filter[started_at][gte]"),"2026-10-08T14:40:00.000Z");
    assert.equal(url.searchParams.get("filter[started_at][lt]"),"2026-10-08T15:40:00.000Z");
    assert.equal(options.method,"GET");assert.equal(options.body,undefined);
    assert.equal(options.headers.Authorization,"Bearer private-key");
    if(mode==="error")throw new Error("private-error");
    if(mode==="malformed")return Response.json({data:"private-text"});
    return Response.json({data:[
      {connection_id:"other-private-app",mos:1,codec:"PCMU",from:"private-number"},
      {connection_id:"private-app",started_at:"2026-10-08T15:30:39Z",mos:mode==="no_fields"?null:"4.2",codec:mode==="no_fields"?"private-codec":"opus",from:"private-number"},
    ]});
  };
  const report=await inspectRecentTelefonMedia(clock);
  assert.equal(report.status,"metadata_available");assert.equal(report.recordsScanned,2);assert.equal(report.matchingRecords,1);
  assert.deepEqual(report.legs,[{startedAt:"2026-10-08T15:30:39.000Z",mos:4.2,codec:"OPUS"}]);
  assert.ok(!JSON.stringify(report).includes("private"));
  mode="no_fields";assert.equal((await inspectRecentTelefonMedia(clock)).status,"quality_fields_unavailable");
  mode="malformed";assert.equal((await inspectRecentTelefonMedia(clock)).status,"invalid_response");
  mode="error";const error=await inspectRecentTelefonMedia(clock);assert.equal(error.status,"provider_read_failed");assert.ok(!JSON.stringify(error).includes("private-error"));
  const before=requests.length;process.env.LUKAS_TELEFON_ANBIETER="twilio";
  assert.equal((await inspectRecentTelefonMedia(clock)).status,"not_checked");assert.equal(requests.length,before);
  console.log("Phone media checks passed: startup audio activity, bounded timing counters, reconnect continuity and metadata-only provider reads.");
} finally {
  globalThis.fetch=previous;
  for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
  await rm(dir,{recursive:true,force:true});
}
