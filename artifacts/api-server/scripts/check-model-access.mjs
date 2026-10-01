// /models ist read-only: keine Antworten erzeugen, keine Generierungskosten.
import OpenAI from "openai";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim();
if (!key) {
  console.error("AI_INTEGRATIONS_OPENAI_API_KEY fehlt. Im Deployment oder mit lokaler .env ausfuehren.");
  process.exit(1);
}
const dir = mkdtempSync(join(process.cwd(), ".models-check-"));
try {
  const file = join(dir, "router.mjs");
  await build({
    entryPoints: ["src/lib/ai/model-router.ts"], outfile: file, bundle: true, format: "esm", platform: "node",
    plugins: [{ name: "silent-log", setup(b) {
      b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: "logger", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const logger = { info(){}, warn(){} };" }));
    } }], logLevel: "silent",
  });
  const { modelRoutingSnapshot, fallbackRoutes } = await import(pathToFileURL(file));
  const client = new OpenAI({
    apiKey: key,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "") || "https://api.openai.com/v1",
    maxRetries: 0, timeout: 15000,
  });
  const available = new Set();
  for await (const model of client.models.list()) available.add(model.id);
  const rows = modelRoutingSnapshot().flatMap((route) => [route, ...fallbackRoutes(route)].map((r, i) => ({
    profil: r.profile, pfad: i ? "Ersatz" : "Primaer", provider: r.provider, modell: r.model,
    imAccount: r.provider === "openai" ? available.has(r.model) : "separater Provider",
  })));
  console.table(rows);
  console.log("Nur Katalogzugriff geprueft. Eine gelistete ID beweist keinen erfolgreichen Responses-/Werkzeugaufruf.");
  if (rows.some((r) => r.imAccount === false)) process.exitCode = 1;
} catch (error) {
  console.error("Modellkatalog nicht pruefbar (HTTP " + (error?.status ?? "Netz/SDK") + "). Zugang und /models-Unterstuetzung des Gateways pruefen.");
  process.exitCode = 1;
} finally { rmSync(dir, { recursive: true, force: true }); }
