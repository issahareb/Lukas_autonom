import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
const directory = await mkdtemp(join(tmpdir(), "lukas-telefon-diagnose-"));
const output = join(directory, "diagnose.mjs");
const names = ["AI_INTEGRATIONS_OPENAI_API_KEY", "OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_BASE_URL", "OPENAI_PROJECT_ID",
  "OPENAI_WEBHOOK_SECRET", "LUKAS_LIVE_MODEL", "LUKAS_LIVE_VOICE", "RAILWAY_PUBLIC_DOMAIN", "LUKAS_TELEFON_ANBIETER",
  "TELNYX_API_KEY", "TELNYX_NUMMER", "TELNYX_APP_ID", "TELNYX_PUBLIC_KEY"];
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
const originalFetch = globalThis.fetch, requests = [];
let mode = "ok";
const OPENAI_KEY = "not-a-real-openai-key", TELNYX_KEY = "not-a-real-telnyx-key";
const PRIVATE_TEXT = "PROVIDER_ERROR_MUST_NEVER_BE_LOGGED", publicBaseUrl = "https://app.example";
function reset() {
  for (const name of names) delete process.env[name];
  Object.assign(process.env, {
    AI_INTEGRATIONS_OPENAI_API_KEY: OPENAI_KEY, OPENAI_PROJECT_ID: "proj_test",
    OPENAI_WEBHOOK_SECRET: "whsec_test_private", LUKAS_TELEFON_ANBIETER: "telnyx",
    TELNYX_API_KEY: TELNYX_KEY, TELNYX_NUMMER: "+49201123456", TELNYX_APP_ID: "app_test", TELNYX_PUBLIC_KEY: "test_public_key",
  });
  requests.length = 0; mode = "ok";
}
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input)); requests.push({ url, ...options });
  assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); assert.equal(options.body, undefined);
  if (["api.openai.com", "gateway.example"].includes(url.hostname)) {

    assert.equal(options.headers.Authorization, "Bearer " + OPENAI_KEY);
    assert.equal(options.headers["OpenAI-Project"], "proj_test");
    if (url.pathname.endsWith("/webhook_event_types")) {
      if (mode === "event_types_403") return new Response(PRIVATE_TEXT, { status: 403 });
      return Response.json({ data: mode === "event_unavailable" ? ["realtime.call.incoming"] : ["live.transport.incoming"] });
    }
    if (url.pathname.endsWith("/webhook_endpoints")) {
      assert.equal(url.searchParams.get("limit"), "100");
      if (mode === "endpoints_403") return new Response(PRIVATE_TEXT, { status: 403 });
      if (mode === "endpoint_malformed") return Response.json({ data: [{ url: PRIVATE_TEXT, event_types: 17 }], has_more: false });
      const after = url.searchParams.get("after");
      return Response.json({ data: mode === "missing_endpoint" || mode === "page_cap" || (mode === "second_page" && !after) ? []
        : [{ id: "we_test", name: PRIVATE_TEXT, signing_secret_hint: PRIVATE_TEXT,
          url: "https://app.example/api/telefon/eingehend",
          event_types: mode === "missing_event" ? ["realtime.call.incoming"] : ["live.transport.incoming"] }],
        has_more: mode === "page_cap" || (mode === "second_page" && !after), last_id: "page_" + (after || "first") });
    }
    assert.match(url.pathname, /\/models\/gpt-live-1$/);

    if (mode === "network_error") throw new Error(PRIVATE_TEXT);
    if (mode === "model_401") return new Response(PRIVATE_TEXT, { status: 401 });
    if (mode === "model_404") return new Response(PRIVATE_TEXT, { status: 404 });
    if (mode === "model_malformed") return new Response("not-json-" + PRIVATE_TEXT, { status: 200 });
    return Response.json({ id: mode === "model_mismatch" ? PRIVATE_TEXT : "gpt-live-1" });
  }
  assert.equal(url.hostname, "api.telnyx.com");
  assert.equal(options.headers.Authorization, "Bearer " + TELNYX_KEY);
  assert.equal(options.headers["OpenAI-Project"], undefined);
  if (url.pathname === "/v2/phone_numbers") {
    assert.equal(url.searchParams.get("filter[phone_number]"), "+49201123456");
    return Response.json({ data: mode === "phone_empty" ? [] : [{ phone_number: "+49201123456",
      status: mode === "phone_pending" ? "requirement-info-pending" : "active",
      connection_id: mode === "phone_wrong_app" ? "different_app" : "app_test" }] });
  }
  if (url.pathname === "/v2/texml_applications/app_test") {
    if (mode === "app_403") return new Response(PRIVATE_TEXT, { status: 403 });
    if (mode === "app_malformed") return Response.json({ data: [PRIVATE_TEXT] });
    return Response.json({ data: { active: mode !== "app_inactive", voice_method: mode === "wrong_method" ? "get" : "post",
      voice_url: mode === "wrong_url" ? "https://elsewhere.example/old-hook"
        : mode === "credential_url" ? "https://user:" + PRIVATE_TEXT + "@app.example/api/telefon/telnyx/texml"
        : "https://app.example/api/telefon/telnyx/texml",
      outbound: mode === "profile_missing" ? {} : { outbound_voice_profile_id: "profile_test" } } });
  }
  if (url.pathname === "/v2/outbound_voice_profiles/profile_test") {
    if (mode === "profile_404") return new Response(PRIVATE_TEXT, { status: 404 });
    return Response.json({ data: { enabled: mode !== "profile_disabled" } });
  }
  throw new Error("Unexpected diagnostic path");
};
try {
  await build({ entryPoints: [resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib/telefon-diagnose.ts")],
    outfile: output, bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "silent" });
  const { inspectTelefonSetup } = await import(pathToFileURL(output).href);
  assert.equal(requests.length, 0); reset();
  const good = await inspectTelefonSetup({ publicBaseUrl });
  assert.equal(good.configurationChecksPassed, true);
  assert.equal(good.openai.apiOrigin, "https://api.openai.com");
  assert.equal(good.openai.model, "gpt-live-1"); assert.equal(good.openai.voice, "cedar");
  assert.equal(good.openai.projectHeaderSentByLive, true);
  assert.equal(good.openai.liveSession, "not_tested"); assert.equal(good.openai.billing, "not_tested");
  assert.equal(good.openai.webhookSubscription, "subscribed"); assert.equal(requests.length, 6);
  assert.equal(good.openaiWebhooks.liveEventSubscribed, true);
  assert.equal(good.openaiWebhooks.signingSecretMatches, "not_verified");
  assert.ok(!JSON.stringify(good).includes(PRIVATE_TEXT));
  for (const hidden of [OPENAI_KEY, TELNYX_KEY, "whsec_test_private", "+49201123456", "proj_test"])
    assert.ok(!JSON.stringify(good).includes(hidden));
  const failures = [
    ["event_types_403", r => r.openaiWebhooks.eventTypes.httpStatus === 403],
    ["endpoints_403", r => r.openai.webhookSubscription === "not_verified"],
    ["event_unavailable", r => r.openaiWebhooks.liveEventAvailable === false],
    ["missing_endpoint", r => r.openai.webhookSubscription === "missing_endpoint"],
    ["endpoint_malformed", r => r.openaiWebhooks.endpoints.status === "invalid_response"],
    ["missing_event", r => r.openai.webhookSubscription === "missing_live_event"],
    ["page_cap", r => r.openaiWebhooks.pageLimitReached && !r.openaiWebhooks.listingComplete && r.openai.webhookSubscription === "not_verified"],
    ["phone_empty", r => r.telnyx.numberFound === false],
    ["phone_pending", r => r.telnyx.numberActive === false],
    ["phone_wrong_app", r => r.telnyx.numberAttachedToApplication === false],
    ["app_inactive", r => r.telnyx.applicationActive === false],
    ["wrong_url", r => r.telnyx.voiceUrlMatches === false],
    ["credential_url", r => r.telnyx.voiceUrlMatches === false],
    ["wrong_method", r => r.telnyx.voiceMethodPost === false],
    ["app_403", r => r.telnyx.application.httpStatus === 403],
    ["app_malformed", r => r.telnyx.application.status === "invalid_response"],
    ["profile_missing", r => r.telnyx.outboundProfileConfigured === false],
    ["profile_disabled", r => r.telnyx.outboundProfileEnabled === false],
    ["profile_404", r => r.telnyx.outboundProfile.httpStatus === 404],
    ["model_401", r => r.openai.catalog.httpStatus === 401],
    ["model_404", r => r.openai.catalog.httpStatus === 404],
    ["model_mismatch", r => r.openai.modelIdMatches === false],
    ["model_malformed", r => r.openai.catalog.status === "invalid_response"],
    ["network_error", r => r.openai.catalog.status === "network_error"],
  ];
  for (const [failure, check] of failures) {
    reset(); mode = failure; const report = await inspectTelefonSetup({ publicBaseUrl });
    assert.equal(report.configurationChecksPassed, false, failure);
    assert.ok(check(report), failure); assert.ok(!JSON.stringify(report).includes(PRIVATE_TEXT));
  }
  reset(); mode = "second_page";
  const second = await inspectTelefonSetup({ publicBaseUrl });
  assert.equal(second.openaiWebhooks.pagesScanned, 2); assert.equal(second.configurationChecksPassed, true);
  reset(); process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "  'https://gateway.example/v1/'  ";
  const gateway = await inspectTelefonSetup({ publicBaseUrl });
  assert.equal(gateway.openai.apiOrigin, "https://gateway.example"); assert.equal(gateway.configurationChecksPassed, true);
  assert.ok(requests.some(request => request.url.href === "https://gateway.example/v1/models/gpt-live-1"));
  reset(); process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://user:" + PRIVATE_TEXT + "@api.openai.com/v1";
  const badBase = await inspectTelefonSetup({ publicBaseUrl });
  assert.equal(badBase.openai.apiOrigin, null); assert.equal(badBase.openai.catalog.status, "invalid_config");
  assert.ok(requests.every(request => request.url.hostname === "api.telnyx.com"));
  assert.ok(!JSON.stringify(badBase).includes(PRIVATE_TEXT));
  reset(); delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY; process.env.OPENAI_API_KEY = OPENAI_KEY;
  const fallback = await inspectTelefonSetup({ publicBaseUrl });
  assert.equal(fallback.openai.keySource, "OPENAI_API_KEY"); assert.equal(fallback.openai.modelIdMatches, true);
  assert.equal(fallback.openai.webhookVerifierKeyConfigured, false); assert.equal(fallback.configurationChecksPassed, false);
  reset(); process.env.AI_INTEGRATIONS_OPENAI_API_KEY = ""; process.env.OPENAI_API_KEY = OPENAI_KEY;
  const blank = await inspectTelefonSetup({ publicBaseUrl });
  assert.equal(blank.openai.catalog.status, "missing_config");
  assert.ok(requests.every(request => request.url.hostname === "api.telnyx.com"));
  reset(); process.env.OPENAI_PROJECT_ID = "invalid-project";
  const badProject = await inspectTelefonSetup({ publicBaseUrl });
  assert.equal(badProject.openai.catalog.status, "invalid_config"); assert.equal(badProject.openai.projectHeaderSentByLive, false);
  assert.ok(requests.every(request => request.url.hostname === "api.telnyx.com"));
  reset(); delete process.env.TELNYX_PUBLIC_KEY;
  const missing = await inspectTelefonSetup({ publicBaseUrl });
  assert.ok(missing.telnyx.missingEnvironment.includes("TELNYX_PUBLIC_KEY")); assert.equal(missing.configurationChecksPassed, false);
  reset(); const noDomain = await inspectTelefonSetup();
  assert.equal(noDomain.telnyx.voiceUrlMatches, null); assert.equal(noDomain.configurationChecksPassed, false);
  process.env.RAILWAY_PUBLIC_DOMAIN = "app.example";
  assert.equal((await inspectTelefonSetup()).configurationChecksPassed, true);
  reset(); process.env.LUKAS_TELEFON_ANBIETER = "twilio";
  assert.equal((await inspectTelefonSetup({ publicBaseUrl })).telnyx.selected, false); assert.equal(requests.length, 3);
  console.log("Telephone diagnostics passed: metadata-only requests, sanitized output, project isolation and configuration failures.");
} finally {
  globalThis.fetch = originalFetch;
  for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
  await rm(directory, { recursive: true, force: true });
}
