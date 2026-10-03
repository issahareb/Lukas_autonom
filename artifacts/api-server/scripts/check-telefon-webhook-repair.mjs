import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
const directory = await mkdtemp(join(tmpdir(), "lukas-webhook-repair-")), output = join(directory, "repair.mjs");
const originalFetch = globalThis.fetch;
const names = ["AI_INTEGRATIONS_OPENAI_API_KEY", "OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_BASE_URL", "OPENAI_PROJECT_ID",
  "OPENAI_WEBHOOK_SECRET", "LUKAS_TELEFON_WEBHOOK_REPAIR", "LUKAS_PUBLIC_URL", "RAILWAY_PUBLIC_DOMAIN"];
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
const SECRET = "PRIVATE_PROVIDER_TEXT_DO_NOT_RETURN", expectedUrl = "https://app.example/api/telefon/eingehend", requests = [];
let mode = "ok", sequence = 0, current;
function reset(selected = "ok") {
  for (const name of names) delete process.env[name];
  Object.assign(process.env, { AI_INTEGRATIONS_OPENAI_API_KEY: "fake-key", OPENAI_PROJECT_ID: "proj_test",
    OPENAI_WEBHOOK_SECRET: "fake-signing-secret", LUKAS_TELEFON_WEBHOOK_REPAIR: "true" });
  mode = selected; requests.length = 0;
  current = { id: "whe_test", url: expectedUrl, event_types: ["realtime.call.incoming", "unknown.future.event"],
    name: SECRET, signing_secret_hint: SECRET };
  if (mode === "already_configured") current.event_types.push("live.transport.incoming");
}
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input)), body = options.body === undefined ? undefined : JSON.parse(options.body);
  requests.push({ url, method: options.method, body });
  assert.equal(url.origin, "https://api.openai.com");
  assert.equal(options.headers.Authorization, "Bearer fake-key");
  assert.equal(options.headers["OpenAI-Project"], "proj_test"); assert.equal(options.redirect, "error");
  assert.ok(!/\/live\/|\/calls|rotate_secret/.test(url.pathname));
  if (url.pathname === "/v1/webhook_event_types") {
    assert.equal(options.method, "GET");
    return Response.json({ data: mode === "unavailable" ? ["batch.completed"]
      : ["live.transport.incoming", "batch.completed", "response.completed", "realtime.call.incoming"] });
  }
  if (url.pathname === "/v1/webhook_endpoints") {
    assert.equal(options.method, "GET"); assert.equal(url.searchParams.get("limit"), "100");
    if (mode === "missing") return Response.json({ data: [], has_more: false, last_id: null });
    if (mode === "ambiguous") return Response.json({ data: [current, { ...current, id: "whe_other" }], has_more: false, last_id: "whe_other" });
    if (mode === "incomplete") {
      const page = Number((url.searchParams.get("after") ?? "page_0").replace("page_", "")) + 1;
      return Response.json({ data: [], has_more: true, last_id: "page_" + page });
    }
    return Response.json({ data: [current], has_more: false, last_id: "whe_test" });
  }
  if (url.pathname === "/v1/webhook_endpoints/whe_test/test") {
    assert.equal(options.method, "POST"); assert.deepEqual(Object.keys(body), ["event_type"]);
    assert.equal(body.event_type, "realtime.call.incoming"); assert.notEqual(body.event_type, "live.transport.incoming");
    if (mode === "test_503") return new Response(SECRET, { status: 503 });
    return Response.json({ object: "webhook_endpoint.test", event_type: body.event_type, success: true,
      status_code: mode === "delivery_401" ? 401 : 200,
      webhook_endpoint_id: mode === "wrong_test_target" ? "whe_other" : "whe_test" });
  }
  assert.equal(url.pathname, "/v1/webhook_endpoints/whe_test");
  if (options.method === "POST") {
    assert.deepEqual(Object.keys(body), ["event_types"]);
    assert.deepEqual(body.event_types, ["realtime.call.incoming", "unknown.future.event", "live.transport.incoming"]);
    if (mode === "update_403") return new Response(SECRET, { status: 403 });
    current = { ...current, event_types: [...body.event_types] };
    if (mode === "ambiguous_timeout") throw new Error(SECRET);
    return Response.json(current);
  }
  assert.equal(options.method, "GET");
  if (mode === "changed_target") return Response.json({ ...current, url: "https://other.example/hook" });
  if (mode === "dropped_old_event" && current.event_types.includes("live.transport.incoming"))
    return Response.json({ ...current, event_types: ["live.transport.incoming"] });
  return Response.json(current);
};
const freshModule = () => import(pathToFileURL(output).href + "?case=" + ++sequence);
async function run(selected) {
  reset(selected); const module = await freshModule(); assert.equal(requests.length, 0);
  const first = module.repairTelefonWebhookOnce({ publicBaseUrl: "https://app.example" });
  assert.equal(first, module.repairTelefonWebhookOnce({ publicBaseUrl: "https://app.example" }));
  const report = await first;
  for (const hidden of [SECRET, "fake-key", "fake-signing-secret"]) assert.ok(!JSON.stringify(report).includes(hidden));
  const count = requests.length;
  await module.repairTelefonWebhookOnce({ publicBaseUrl: "https://app.example" });
  assert.equal(requests.length, count); return report;
}
try {
  await build({ entryPoints: [resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib/telefon-webhook-repair.ts")],
    outfile: output, bundle: true, platform: "node", target: "node22", format: "esm", logLevel: "silent" });
  reset(); delete process.env.LUKAS_TELEFON_WEBHOOK_REPAIR;
  assert.equal((await (await freshModule()).repairTelefonWebhookOnce({ publicBaseUrl: "https://app.example" })).status, "disabled");
  assert.equal(requests.length, 0);
  const good = await run("ok");
  assert.equal(good.status, "configured_delivery_verified"); assert.equal(good.updateAttempted, true);
  assert.equal(good.subscriptionVerified, true); assert.equal(good.deliveryVerified, true); assert.equal(good.deliveryHttpStatus, 200);
  assert.equal(requests.filter(request => request.method === "POST").length, 2);
  assert.equal(requests.at(-2).method, "GET");
  const already = await run("already_configured");
  assert.equal(already.status, "configured_delivery_verified"); assert.equal(already.updateAttempted, false);
  assert.equal(requests.filter(request => request.method === "POST").length, 1);
  assert.equal((await run("ambiguous_timeout")).status, "configured_delivery_verified");
  assert.equal(requests.filter(request => request.method === "POST" && !request.url.pathname.endsWith("/test")).length, 1);
  for (const [selected, status] of [["unavailable", "live_event_unavailable"], ["missing", "endpoint_missing"],
    ["ambiguous", "endpoint_ambiguous"], ["incomplete", "listing_incomplete"], ["changed_target", "endpoint_changed"]]) {
    const result = await run(selected);
    assert.equal(result.status, status); assert.equal(result.updateAttempted, false);
    assert.ok(requests.every(request => request.method === "GET"));
  }
  for (const selected of ["update_403", "dropped_old_event"]) {
    const result = await run(selected);
    assert.equal(result.status, "subscription_unverified"); assert.equal(result.subscriptionVerified, false);
    assert.ok(!requests.some(request => request.url.pathname.endsWith("/test")));
  }
  for (const selected of ["delivery_401", "wrong_test_target", "test_503"]) {
    const result = await run(selected);
    assert.equal(result.status, "configured_delivery_unverified"); assert.equal(result.subscriptionVerified, true);
    assert.equal(result.deliveryVerified, false);
    if (selected === "delivery_401") assert.equal(result.deliveryHttpStatus, 401);
  }
  reset(); process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://user:" + SECRET + "@api.openai.com/v1";
  const badBase = await (await freshModule()).repairTelefonWebhookOnce({ publicBaseUrl: "https://app.example" });
  assert.equal(badBase.status, "invalid_config"); assert.equal(requests.length, 0);
  assert.ok(!JSON.stringify(badBase).includes(SECRET));
  console.log("Telephone webhook repair passed: explicit flag, preserved events/secrets, GET reconciliation and signed-delivery status.");
} finally {
  globalThis.fetch = originalFetch;
  for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
  await rm(directory, { recursive: true, force: true });
}
