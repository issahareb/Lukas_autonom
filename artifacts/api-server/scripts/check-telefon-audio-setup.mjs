import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const dir = await mkdtemp(join(tmpdir(), "lukas-phone-quality-"));
const output = join(dir, "quality.mjs"), oldFetch = globalThis.fetch;
const names = ["LUKAS_TELEFON_ANBIETER","TELNYX_API_KEY","TELNYX_APP_ID","TELNYX_NUMMER","TELNYX_AUDIO_OPTIMIZE","TELNYX_SIP_REGION","TELNYX_MEDIA_ANCHOR"];
const saved = Object.fromEntries(names.map(k=>[k,process.env[k]]));
let serial = 0;
try {
  await build({entryPoints:[resolve("src/lib/telefon-audio-setup.ts")],outfile:output,bundle:true,platform:"node",format:"esm",logLevel:"silent"});
  async function scenario(mode = "normal", env = {}) {
    for (const name of names) delete process.env[name];
    Object.assign(process.env,{LUKAS_TELEFON_ANBIETER:"telnyx",TELNYX_API_KEY:"private-key-sentinel",TELNYX_APP_ID:"app_one",TELNYX_NUMMER:"+49201123456"},env);
    const app = {id:"app_one",active:true,friendly_name:"private-name-sentinel",voice_url:"https://voice.example/hook?secret=private-url-sentinel",anchorsite_override:"Latency",status_callback:"preserved"};
    const phone = {id:"number_one",phone_number:"+49201123456",connection_id:"app_one",status:"active",hd_voice_enabled:false,cnam_listing:{enabled:true}};
    if (mode==="ready") { app.anchorsite_override="Frankfurt, Germany";phone.hd_voice_enabled=true; }
    if (mode==="unknown_hd") delete phone.hd_voice_enabled;
    if (mode==="wrong_app") phone.connection_id="other";
    if (mode==="inactive") phone.status="pending";
    if (mode==="bad_id") phone.id="../../other";
    if (mode==="missing_name") delete app.friendly_name;
    if (mode==="unknown_anchor") app.anchorsite_override="private-anchor-sentinel";
    const requests=[];
    globalThis.fetch = async (input, options) => {
      const url=new URL(String(input));
      assert.equal(url.origin,"https://api.telnyx.com");
      assert.equal(options.headers.Authorization,"Bearer private-key-sentinel");
      assert.ok(["GET","PATCH"].includes(options.method),"never place a call");
      const body=options.body===undefined?undefined:JSON.parse(options.body);
      requests.push({path:url.pathname,method:options.method,body});
      if (url.pathname==="/v2/phone_numbers") {
        assert.equal(options.method,"GET");assert.equal(url.searchParams.get("filter[phone_number]"),phone.phone_number);
        return Response.json({data:mode==="missing_number"?[]:mode==="duplicate"?[phone,phone]:[phone]});
      }
      if (url.pathname==="/v2/texml_applications/app_one") {
        if (options.method==="PATCH") {
          assert.deepEqual(body,{friendly_name:app.friendly_name,voice_url:app.voice_url,anchorsite_override:process.env.TELNYX_MEDIA_ANCHOR||((process.env.TELNYX_SIP_REGION||"Europe")==="Europe"?"Frankfurt, Germany":"Latency")});
          if(mode==="anchor_failure")return Response.json({errors:[{code:"10010",detail:"private-error-sentinel"}]},{status:403});
          if(mode!=="anchor_unverified") app.anchorsite_override=body.anchorsite_override;
        }
        return Response.json({data:app});
      }
      assert.equal(url.pathname,"/v2/phone_numbers/number_one");
      if (options.method==="PATCH") {
        assert.deepEqual(body,{hd_voice_enabled:true});
        if(mode==="hd_failure")return Response.json({errors:[{code:"10010",detail:"private-error-sentinel"}]},{status:403});
        if(mode==="network_failure")throw new Error("private-error-sentinel");
        if(mode!=="hd_unverified")phone.hd_voice_enabled=true;
      }
      return Response.json({data:mode==="wrong_detail"?{...phone,connection_id:"other"}:mode==="wrong_detail_id"?{...phone,id:"other"}:phone});
    };
    const mod=await import(pathToFileURL(output).href+"?case="+serial++);
    const [report,concurrent]=await Promise.all([mod.configureTelefonAudioOnce(),mod.configureTelefonAudioOnce()]);
    assert.equal(report,concurrent,"one setup shared by concurrent calls");
    const total=requests.length;
    assert.equal(await mod.configureTelefonAudioOnce(),report);assert.equal(requests.length,total,"once per process, no repeated setup");
    for(const secret of ["private-key-sentinel","private-name-sentinel","private-url-sentinel","private-error-sentinel","private-anchor-sentinel","+49201123456","app_one","number_one"])
      assert.ok(!JSON.stringify(report).includes(secret),"no credentials, URLs, provider values or identifiers in report");
    assert.equal(app.status_callback,"preserved");assert.deepEqual(phone.cnam_listing,{enabled:true});
    return {report,requests,patches:requests.filter(x=>x.method==="PATCH")};
  }
  const fixed=await scenario();
  assert.equal(fixed.report.sipRegion,"Europe");assert.equal(fixed.report.mediaAnchor.status,"updated");
  assert.deepEqual(fixed.report.hdVoice,{status:"updated",before:false,after:true});assert.equal(fixed.patches.length,2);
  assert.equal(fixed.requests.length,7,"list, app read/patch/verify, phone read/patch/verify");
  for(const env of [{TELNYX_AUDIO_OPTIMIZE:"false"},{LUKAS_TELEFON_ANBIETER:"twilio"}]) {
    const r=await scenario("normal",env);assert.equal(r.report.enabled,false);assert.equal(r.requests.length,0);
  }
  for(const env of [{TELNYX_SIP_REGION:"bad"},{TELNYX_MEDIA_ANCHOR:"private-anchor-sentinel"},{TELNYX_APP_ID:""},{TELNYX_NUMMER:"bad"}]) {
    const r=await scenario("normal",env);assert.equal(r.report.hdVoice.status,"configuration_mismatch");assert.equal(r.requests.length,0);
  }
  for(const mode of ["wrong_app","inactive","bad_id","missing_number","duplicate"]) {
    const r=await scenario(mode);assert.equal(r.report.hdVoice.status,"configuration_mismatch");assert.equal(r.patches.length,0);
  }
  const ready=await scenario("ready");assert.equal(ready.patches.length,0);assert.equal(ready.report.hdVoice.status,"unchanged");
  const unknown=await scenario("unknown_hd");assert.equal(unknown.report.hdVoice.status,"unavailable");assert.equal(unknown.patches.length,1);
  for(const mode of ["wrong_detail","wrong_detail_id"]){
    const wrong=await scenario(mode);assert.equal(wrong.report.hdVoice.status,"configuration_mismatch");assert.equal(wrong.patches.length,1);
  }
  const missing=await scenario("missing_name");assert.equal(missing.report.mediaAnchor.status,"configuration_mismatch");assert.equal(missing.report.hdVoice.status,"updated");
  for(const mode of ["hd_failure","network_failure"]) {
    const r=await scenario(mode);assert.equal(r.report.hdVoice.status,"failed");assert.equal(r.report.mediaAnchor.status,"updated");
  }
  const denied=await scenario("hd_failure");assert.equal(denied.report.hdVoice.httpStatus,403);assert.equal(denied.report.hdVoice.code,"10010");
  const anchorFail=await scenario("anchor_failure");assert.equal(anchorFail.report.mediaAnchor.status,"failed");assert.equal(anchorFail.report.hdVoice.status,"updated");
  assert.equal((await scenario("hd_unverified")).report.hdVoice.status,"verification_failed");
  assert.equal((await scenario("anchor_unverified")).report.mediaAnchor.status,"verification_failed");
  assert.equal((await scenario("unknown_anchor")).report.mediaAnchor.before,null);
  assert.equal((await scenario("normal",{TELNYX_SIP_REGION:"US"})).report.mediaAnchor.after,"Latency");
  assert.equal((await scenario("normal",{TELNYX_MEDIA_ANCHOR:"Amsterdam, Netherlands"})).report.mediaAnchor.after,"Amsterdam, Netherlands");
  console.log("Telephone audio setup passed: region, HD request, scoped mutations, verification, idempotency, failure isolation and private-safe reports.");
} finally {
  globalThis.fetch=oldFetch;
  for(const name of names){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}
  await rm(dir,{recursive:true,force:true});
}
