import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = mkdtempSync(join(process.cwd(), ".routing-check-"));
const stub = join(dir, "stub.mjs"), entry = join(dir, "entry.mjs");
writeFileSync(stub, [
  "export const logger = { info(){}, warn(){}, error(){}, debug(){} };",
  "export const verbucheTag = async (u) => { globalThis.__booked.push(u); };",
  "export const openai = { responses: { create: async (r) => { globalThis.__requests.push(r); return globalThis.__reply(r); } } };",
].join("\n"));
writeFileSync(entry, ["model-router", "model-client", "context-window", "voice-renderer"]
  .map((n) => 'export * from "../src/lib/ai/' + n + '.ts";').join("\n"));
await build({
  entryPoints: [entry], outfile: join(dir, "test.mjs"), bundle: true, format: "esm", platform: "node",
  alias: { "@workspace/integrations-openai-ai": stub },
  plugins: [{ name: "providers", setup(b) {
    b.onResolve({ filter: /(^|\/)(logger|tagesbudget)$/ }, () => ({ path: stub }));
  } }], logLevel: "silent",
});
const { routeLukasModel, directRoute, callLukasModel, fitLukasContext, renderLukasVoice, isModelBroken } =
  await import(pathToFileURL(join(dir, "test.mjs")));
const savedEnv = { ...process.env };
let checks = 0;
const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks++; };
const ok = (name, value) => { assert.ok(value, name); checks++; };
function reset() {
  for (const k of Object.keys(process.env)) if (/^LUKAS_(MODEL|CORE_MODEL|FAST_MODEL|PUBLIC_MODEL|MAX_OUTPUT|REASONING_EFFORT|CONTEXT|VOICE)/.test(k)) delete process.env[k];
  globalThis.__requests = []; globalThis.__booked = [];
  globalThis.__reply = async () => ({ output: [], output_text: "Antwort.", status: "completed", usage: { input_tokens: 100, output_tokens: 20 } });
}
const messages = [{ role: "system", content: "Lukas <<<LUKAS_CACHE_TRENNER>>> Kontext" }, { role: "user", content: "Hallo" }];
const call = (profile = "fast", extra = {}) => callLukasModel({ route: directRoute(profile), messages, ...extra });
try {
  reset();
  for (const f of JSON.parse(readFileSync("bench/fixtures/routing.json", "utf8"))) {
    const actual = routeLukasModel({ userText: f.text, ...f }).profile;
    ok("Bestehender Fall: " + f.text.slice(0, 90) + " -> " + actual, [f.soll, ...(f.auchOk ?? [])].includes(actual));
  }
  for (const text of ["Was ist Python?", "Was bedeutet JSON?", "Erklär mir kurz Docker", "Was ist eine API?", "Was ist eine Strategie?", "Danke für den Commit!", "Danke für die Analyse!", "Wie spät ist es?", "Hallo", "Was heißt SQL?", "What is React?"]) {
    equal("Billige Frage: " + text, routeLukasModel({ userText: text }).profile, "fast");
  }
  equal("Analyse auf Sol", routeLukasModel({ userText: "Analysiere die Ursachen und begründe deine Empfehlung" }).model, "gpt-6-sol");
  equal("Code auf 6.1", routeLukasModel({ userText: "Fix den Fehler in router.ts" }).model, "gpt-6.1-sol");
  equal("FAST auf Luna", directRoute("fast").model, "gpt-6-luna");
  equal("GENERAL auf Terra", directRoute("general").model, "gpt-5.6-terra");
  for (const profile of ["fast", "general", "reasoning", "code", "vision", "long_context"]) ok("Astra nur explizit: " + profile, !directRoute(profile).model.includes("astra"));
  equal("Code-Fortsetzung", routeLukasModel({ userText: "Ja, mach das", previousUserText: "Implementiere den Cache in router.ts" }).profile, "code");
  equal("Neues Danke bleibt billig", routeLukasModel({ userText: "Danke!", previousUserText: "Analysiere unsere Strategie" }).profile, "fast");
  equal("Text braucht keine Vision", routeLukasModel({ userText: "Fasse das kurz zusammen", hasAttachments: true, attachmentKinds: ["text"] }).profile, "fast");
  equal("Bild bleibt sichtbar", routeLukasModel({ userText: "Was siehst du?", attachmentKinds: ["image"] }).profile, "vision");
  equal("Langer Code", routeLukasModel({ userText: "const x = 1;\n".repeat(1500) }).profile, "long_context");
  process.env.LUKAS_PUBLIC_MODEL = "public-only";
  equal("Oeffentlicher Chat steuert FAST nicht", directRoute("fast").model, "gpt-6-luna");
  reset();
  for (const [profile, limit, effort] of [["fast", 2048, "low"], ["general", 4096, "low"], ["vision", 4096, "low"], ["code", 16384, "medium"], ["reasoning", 16384, "medium"], ["long_context", 16384, "medium"]]) {
    await call(profile);
    equal("Ausgabelimit " + profile, globalThis.__requests.at(-1).max_output_tokens, limit);
    equal("Denkaufwand " + profile, globalThis.__requests.at(-1).reasoning?.effort, effort);
  }
  process.env.LUKAS_MAX_OUTPUT_TOKENS = "NaN"; process.env.LUKAS_MAX_OUTPUT_TOKENS_FAST = "-9";
  await call(); equal("Ungueltige Limits", globalThis.__requests.at(-1).max_output_tokens, 2048);
  process.env.LUKAS_MAX_OUTPUT_TOKENS = "5000"; process.env.LUKAS_MAX_OUTPUT_TOKENS_FAST = "3000";
  await call(); equal("Profil vor global", globalThis.__requests.at(-1).max_output_tokens, 3000);
  await call("fast", { maxTokens: 1400 }); equal("Aufruf vor Profil", globalThis.__requests.at(-1).max_output_tokens, 1400);
  process.env.LUKAS_MODEL_FAST = "gpt-4.1-mini";
  await call(); equal("4.1 ohne Reasoning-Parameter", globalThis.__requests.at(-1).reasoning, undefined);

  reset(); process.env.LUKAS_MODEL_FAST = "missing-luna"; process.env.LUKAS_CORE_MODEL = "gpt-6-astra";
  globalThis.__reply = async (r) => {
    if (r.model === "missing-luna") throw Object.assign(new Error("The model does not exist"), { status: 404, code: "model_not_found" });
    return { output_text: "Ersatz", output: [], status: "completed" };
  };
  const fallback = await call();
  equal("Billiger Ersatz trotz Core", fallback.route.model, "gpt-4.1-mini");
  equal("Profil bleibt erhalten", fallback.route.profile, "fast");
  equal("Begrenzter Rueckfall", globalThis.__requests.map((r) => r.model), ["missing-luna", "gpt-4.1-mini"]);
  ok("Keine Cachemarke im Ersatz", !JSON.stringify(globalThis.__requests.at(-1)).includes("LUKAS_CACHE_TRENNER"));
  await call();
  equal("Defekte ID nicht erneut gefragt", globalThis.__requests.filter((r) => r.model === "missing-luna").length, 1);
  ok("Sperre aktiv", isModelBroken("missing-luna"));
  const now = Date.now;
  try { Date.now = () => now() + 3_600_001; ok("Sperre laeuft aus", !isModelBroken("missing-luna")); }
  finally { Date.now = now; }
  for (const status of [400, 401, 429, 500]) {
    reset(); globalThis.__reply = async () => { throw Object.assign(new Error("request failed"), { status }); };
    await assert.rejects(call());
    equal("Kein Modellwechsel bei " + status, globalThis.__requests.length, 1);
    ok("Kein Modelldefekt bei " + status, !isModelBroken("gpt-6-luna"));
  }
  reset(); process.env.LUKAS_MODEL_FAST = "anthropic:missing-key"; delete process.env.ANTHROPIC_API_KEY;
  equal("Fehlender Provider: billiger Ersatz", directRoute("fast").model, "gpt-4.1-mini");
  equal("Fehlender Provider: gleiches Profil", directRoute("fast").profile, "fast");
  reset(); process.env.LUKAS_MODEL_FAST = "unavailable-primary"; process.env.LUKAS_MODEL_FALLBACK_FAST = "unavailable-secondary";
  globalThis.__reply = async () => { throw Object.assign(new Error("model not found"), { status: 404 }); };
  await assert.rejects(call()); equal("Kein Retry-Kreis", globalThis.__requests.length, 2);
  await assert.rejects(call()); equal("Defekter Ersatz wird uebersprungen", globalThis.__requests.length, 2);
  reset();
  const result = await call();
  equal("Verbrauch pro Zug", result.usage, { rein: 100, raus: 20 });
  await new Promise((r) => setTimeout(r, 0));
  equal("Verbrauch dauerhaft gebucht", globalThis.__booked.length, 1);

  reset();
  const voiceOpts = { systemPrompt: "Du bist Lukas", conversation: messages, draft: "Fertig: Ergebnis 42." };
  equal("Fertige Antwort bleibt erhalten", await renderLukasVoice(voiceOpts), voiceOpts.draft);
  equal("Kein zweiter Modellaufruf", globalThis.__requests.length, 0);
  process.env.LUKAS_VOICE_POLISH = "true"; await renderLukasVoice(voiceOpts);
  equal("Politur explizit aktivierbar", globalThis.__requests.length, 1);
  equal("Politur auf Luna", globalThis.__requests[0].model, "gpt-6-luna");
  process.env.LUKAS_VOICE_HISTORY = "0"; globalThis.__requests = [];
  await renderLukasVoice({ ...voiceOpts, conversation: [{ role: "user", content: "OLD_HISTORY_MARKER" }] });
  ok("Historienlimit 0 sendet keinen Verlauf", !JSON.stringify(globalThis.__requests[0]).includes("OLD_HISTORY_MARKER"));

  reset(); process.env.LUKAS_CONTEXT_MAX_CHARS = "12000";
  const transaction = [
    { role: "user", content: "CURRENT_QUESTION" },
    { role: "assistant", content: null, tool_calls: ["a", "b"].map((id) => ({ id, type: "function", function: { name: "read", arguments: "{}" } })) },
    { role: "tool", tool_call_id: "a", content: "A".repeat(2000) },
    { role: "tool", tool_call_id: "b", content: "B".repeat(2000) },
  ];
  const context = [{ role: "system", content: "S".repeat(4000) }, { role: "user", content: "OLD".repeat(5000) }, { role: "assistant", content: "old answer" }, ...transaction];
  const packed = fitLukasContext(context);
  ok("Alter Dialog entfernt", !packed.some((m) => String(m.content).startsWith("OLD")));
  equal("Aktuelle Frage samt Werkzeugpaaren", packed.slice(-transaction.length), transaction);
  ok("Kein versteckter 20k-Mindestrest", JSON.stringify(packed).length < 12000);
  equal("Originalarchiv vollstaendig", context.length, 7);
  process.env.LUKAS_CONTEXT_MAX_CHARS = "NaN";
  equal("Ungueltiges Kontextlimit", fitLukasContext(messages), messages);
  console.log("OK — " + checks + " Routing-/Kostenpruefungen: Profile, Request-Payloads, Fallback, Sperre, Politur, Buchhaltung, Kontext.");
} finally {
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  rmSync(dir, { recursive: true, force: true });
}
