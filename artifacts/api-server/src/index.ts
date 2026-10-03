import { execFile } from "node:child_process";
import { join } from "node:path";
import { inspectTelefonSetup } from "./lib/telefon-diagnose";
import app from "./app";
import { startMoltbookWorker, stopMoltbookWorker } from "./lib/moltbook-worker";
import { startAutonomy, stopAutonomy } from "./lib/autonomy";
import { startSelbstheilung, stopSelbstheilung } from "./lib/selbstheilung";
import { startSandboxCleanup, stopSandboxCleanup } from "./lib/code-sandbox";
import { startConsolidationWorker, stopConsolidationWorker } from "./lib/consolidation-worker";
import { seedPublicFactsOnce } from "./lib/seed-public-facts";
import { richteAbschiedEin } from "./lib/abschied";
import { logger } from "./lib/logger";
import { shutdownLiveSessions } from "./lib/ai/live-session";
import { istTelnyx, telnyxStand, telnyxXml } from "./lib/telnyx";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Konfigurations-Diagnose (nur gesetzt/fehlt — niemals Werte loggen)
  const envStatus = Object.fromEntries(
    [
      "DATABASE_URL",
      "AI_INTEGRATIONS_OPENAI_API_KEY",
      "LUKAS_API_TOKEN",
      "ELEVENLABS_API_KEY",
      "ELEVENLABS_LLM_TOKEN",
      "ELEVENLABS_AGENT_ID",
      "MOLTBOOK_API_KEY",
      "VOYAGE_API_KEY",
      "VPS_DATABASE_URL",
    ].map((k) => [k, process.env[k] ? "gesetzt" : "FEHLT"]),
  );
  logger.info(envStatus, "Env-Status");
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    logger.warn(
      "AI_INTEGRATIONS_OPENAI_API_KEY fehlt — Server läuft, aber Lukas kann nicht denken (Chat/Reflexion/Moltbook liefern Fehler), bis der Key gesetzt ist.",
    );
  }
  if (!process.env.LUKAS_API_TOKEN) {
    logger.warn("LUKAS_API_TOKEN fehlt — die private API ist UNGESCHÜTZT. Vor echtem Betrieb setzen!");
  }

  // One read-only provider check per startup; never log keys or the signed XML.
  if (istTelnyx()) {
    void Promise.resolve().then(() => {
      telnyxXml("", "eingehend"); // Validate the configured OpenAI SIP destination.
      return telnyxStand();
    }).then(stand => logger.info(stand, "Telnyx-Status"))
      .catch(err => logger.warn({ grund: err instanceof Error ? err.message : "Konfiguration unvollständig" }, "Telnyx-Status"));
  }

  if (process.env.LUKAS_TELEFON_DIAGNOSE === "true") {
    void inspectTelefonSetup({ publicBaseUrl: process.env.LUKAS_PUBLIC_URL })
      .then(report => logger.info(report, "Telefonie-Konfigurationsprüfung"))
      .catch(() => logger.warn("Telefonie-Konfigurationsprüfung fehlgeschlagen"));
  }

  if (process.env.LUKAS_BACKGROUND_PAUSED === "true" && process.env.LUKAS_PAUSE_VPS_BACKGROUND === "true") {
    // Fixed operational helper: uses existing SSH credentials without exposing them.
    execFile(process.execPath, [join(__dirname, "../scripts/pause-vps-background.mjs")],
      { timeout: 95_000, maxBuffer: 131072 }, (error, stdout, stderr) => {
        try {
          const report = JSON.parse(stdout.trim() || stderr.trim());
          if (error || !report.ok) logger.warn(report, "VPS-Hintergrundprüfung");
          else logger.info(report, "VPS-Hintergrundprüfung");
        } catch { logger.warn("VPS-Hintergrundprüfung ohne gültigen Bericht"); }
      });
  }

  startMoltbookWorker();
  startAutonomy();
  startSelbstheilung();
  startConsolidationWorker();
  startSandboxCleanup();
  seedPublicFactsOnce();

  /*
   * Erst jetzt, wo die Taktgeber laufen, ist bekannt, was beim Herunterfahren
   * gestoppt werden muss. Railway schickt bei jedem Deployment ein SIGTERM —
   * ohne das hier wird mitten in einer Antwort abgeschnitten.
   */
  richteAbschiedEin(server, () => {
    stopAutonomy();
    stopMoltbookWorker();
    stopSelbstheilung();
    stopConsolidationWorker();
    stopSandboxCleanup();
    return shutdownLiveSessions();
  });
});
