import { inspectTelefonOwnerContact } from "./lib/telefon-owner";
import { inspectTelefonCodeAccess } from "./lib/telefon-code-diagnose";
import { inspectRecentTelefonMedia } from "./lib/telefon-medien-diagnose";
import { configureTelefonAudioOnce } from "./lib/telefon-audio-setup";
import { repairTelefonWebhookOnce } from "./lib/telefon-webhook-repair";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { inspectTelefonSetup } from "./lib/telefon-diagnose";
import { pruefeLetzteTelefonAufnahme } from "./lib/telefon-aufnahme";
import app from "./app";
import { starteTelefonMithoeren } from "./lib/telefon-mithoeren";
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

  // Resolve the configured owner without logging phone numbers or private content.
  // This only reads configuration, contact metadata and one repository file.
  void inspectTelefonOwnerContact().then(async owner => {
    if (owner.enabled) logger.info({ ...owner, code: await inspectTelefonCodeAccess() }, "Telefon-Owner-Zugang geprüft");
  }).catch(() => logger.warn("Telefon-Owner-Zugang konnte nicht geprüft werden"));

  // One setup pass per startup; no calls and no autonomous work.
  void configureTelefonAudioOnce().then(report => {
    if (report.enabled) logger.info(report, "Telefon-Audioqualität: Einrichtung geprüft");
  }).catch(() => logger.warn("Telefon-Audioqualität konnte nicht eingerichtet werden"));

  // One read-only provider check per startup; never log keys or the signed XML.
  if (istTelnyx()) {
    void Promise.resolve().then(() => {
      telnyxXml("", "eingehend"); // Validate the configured OpenAI SIP destination.
      return telnyxStand();
    }).then(stand => logger.info(stand, "Telnyx-Status"))
      .catch(err => logger.warn({ grund: err instanceof Error ? err.message : "Konfiguration unvollständig" }, "Telnyx-Status"));
  }

  if (process.env.LUKAS_TELEFON_DIAGNOSE === "true" || process.env.LUKAS_TELEFON_WEBHOOK_REPAIR === "true") {
    void (async () => {
      const options = { publicBaseUrl: process.env.LUKAS_PUBLIC_URL };
      const repair = await repairTelefonWebhookOnce(options);
      if (repair.enabled) logger.info(repair, "Telefonie-Webhook-Einrichtung");
      const report = await inspectTelefonSetup(options);
      logger.info(report, "Telefonie-Konfigurationsprüfung");
      if (istTelnyx()) logger.info(await pruefeLetzteTelefonAufnahme(), "Telefonaufnahme-Abrufprüfung");
      if (istTelnyx()) logger.info(await inspectRecentTelefonMedia(), "Telefon-Medienprüfung");
    })().catch(() => logger.warn("Telefonie-Konfigurationsprüfung fehlgeschlagen"));
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
  const stopMithoeren = starteTelefonMithoeren(server);
  richteAbschiedEin(server, () => {
    stopMithoeren();
    stopAutonomy();
    stopMoltbookWorker();
    stopSelbstheilung();
    stopConsolidationWorker();
    stopSandboxCleanup();
    return shutdownLiveSessions();
  });
});
