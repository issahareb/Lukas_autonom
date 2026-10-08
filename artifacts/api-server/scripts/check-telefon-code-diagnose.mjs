import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(process.cwd(), ".phone-code-check-"));
const original = process.env.GITHUB_TOKEN;
const state = { requests: [], result: { type: "file", encoding: "base64", content: "cHJpdmF0ZQ==" }, fail: false, ref: "main" };
globalThis.__phoneCodeCheck = state;
try {
  const out = join(dir, "probe.mjs");
  await build({ entryPoints: ["src/lib/telefon-code-diagnose.ts"], outfile: out, bundle: true, platform: "node", format: "esm", logLevel: "silent",
    plugins: [{ name: "github-read-only", setup(b) {
      b.onResolve({ filter: /^\.\/github$/ }, () => ({ path: "github", namespace: "test" }));
      b.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `
        const state = globalThis.__phoneCodeCheck;
        export const resolveGithubOwner = async repo => ({ owner: "test-owner", repo });
        export const ownRepoRef = () => state.ref;
        export const githubRequest = async (...args) => {
          state.requests.push(args);
          if (state.fail) throw new Error("Bearer secret-code-content");
          return state.result;
        };
      ` }));
    } }] });
  const { inspectTelefonCodeAccess } = await import(pathToFileURL(out).href);
  delete process.env.GITHUB_TOKEN;
  assert.deepEqual(await inspectTelefonCodeAccess(), { readable: false, reason: "github_not_configured" });
  assert.equal(state.requests.length, 0);
  process.env.GITHUB_TOKEN = "synthetic-test-token";
  assert.deepEqual(await inspectTelefonCodeAccess(), { readable: true });
  assert.deepEqual(state.requests.at(-1), ["/repos/test-owner/Lukas_autonom/contents/artifacts/api-server/src/lib/telefon.ts?ref=main"]);
  state.ref = "feature/phone";
  await inspectTelefonCodeAccess();
  assert.ok(state.requests.at(-1)[0].endsWith("?ref=feature%2Fphone"));
  state.result = { type: "dir" };
  assert.deepEqual(await inspectTelefonCodeAccess(), { readable: false, reason: "code_not_readable" });
  state.fail = true;
  const failed = await inspectTelefonCodeAccess();
  assert.deepEqual(failed, { readable: false, reason: "github_read_failed" });
  assert.doesNotMatch(JSON.stringify(failed), /secret|Bearer|cHJp/);
  assert.ok(state.requests.every(args => args.length === 1), "only GET reads, never a write");
  console.log("OK — Phone code access: runtime branch, read-only access and private-safe failures.");
} finally {
  if (original === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = original;
  delete globalThis.__phoneCodeCheck;
  rmSync(dir, { recursive: true, force: true });
}
