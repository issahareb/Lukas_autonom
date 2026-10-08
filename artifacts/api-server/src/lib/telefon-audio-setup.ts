import { istTelnyx, telnyxAnfrage, telnyxSipRegion } from "./telnyx";

const ANCHORS = ["Latency", "Frankfurt, Germany", "Amsterdam, Netherlands", "London, UK"] as const;
type Status = "not_checked" | "unchanged" | "updated" | "unavailable" | "configuration_mismatch" | "verification_failed" | "failed";
type Check<T> = { status: Status; before: T | null; after: T | null; httpStatus?: number; code?: string };
export type TelefonAudioSetup = {
  enabled: boolean; sipRegion: string | null;
  mediaAnchor: Check<string>; hdVoice: Check<boolean>;
};
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function failed<T>(check: Check<T>, error: unknown): void {
  check.status = "failed";
  // telnyxAnfrage strips provider descriptions. Never log raw errors/URLs/keys.
  const safe = error instanceof Error ? error.message.match(/^Telnyx (\d{3}) bei .+ \(Code (\d{5}|unbekannt)\)/) : null;
  if (safe) { check.httpStatus = Number(safe[1]); check.code = safe[2]; }
}

/**
 * Configure the existing telephone path once at startup, without placing calls.
 * Number HD is only a capability request: end-to-end bandwidth still depends on
 * the destination network and SDP negotiation. This never changes monitoring.
 */
let setup: Promise<TelefonAudioSetup> | undefined;
export function configureTelefonAudioOnce(): Promise<TelefonAudioSetup> {
  return setup ??= configureTelefonAudio();
}
async function configureTelefonAudio(): Promise<TelefonAudioSetup> {
  const report: TelefonAudioSetup = {
    enabled: istTelnyx() && process.env.TELNYX_AUDIO_OPTIMIZE !== "false", sipRegion: null,
    mediaAnchor: { status: "not_checked", before: null, after: null },
    hdVoice: { status: "not_checked", before: null, after: null },
  };
  if (!report.enabled) return report;
  const appId = process.env.TELNYX_APP_ID?.trim(), number = process.env.TELNYX_NUMMER?.trim();
  let anchor: string;
  try {
    report.sipRegion = telnyxSipRegion();
    anchor = process.env.TELNYX_MEDIA_ANCHOR?.trim() || (report.sipRegion === "Europe" ? "Frankfurt, Germany" : "Latency");
    if (!ANCHORS.some(value => value === anchor) || !identifier(appId) ||
      !number || !/^\+[1-9]\d{5,14}$/.test(number)) throw new Error("configuration");
  } catch {
    report.mediaAnchor.status = report.hdVoice.status = "configuration_mismatch"; return report;
  }

  let numberId: string;
  try {
    const listed = await telnyxAnfrage<{ data?: unknown }>("/phone_numbers?filter[phone_number]=" + encodeURIComponent(number!));
    const matches = Array.isArray(listed.data) ? listed.data.map(object).filter(n => n?.phone_number === number) : [];
    const selected = matches.length === 1 ? matches[0] : null;
    if (!selected || !identifier(selected.id) || selected.connection_id !== appId || selected.status !== "active") {
      report.mediaAnchor.status = report.hdVoice.status = "configuration_mismatch"; return report;
    }
    numberId = selected.id;
  } catch (error) { failed(report.mediaAnchor, error); failed(report.hdVoice, error); return report; }

  // A fixed EU media anchor avoids choosing the US webhook server as the media
  // location. PATCH only these fields; keep the required existing name/URL.
  try {
    const path = "/texml_applications/" + encodeURIComponent(appId!);
    const read = await telnyxAnfrage<{ data?: unknown }>(path);
    const app = object(read.data);
    if (!app || app.active !== true || typeof app.friendly_name !== "string" ||
      typeof app.voice_url !== "string" || !app.friendly_name || !app.voice_url) {
      report.mediaAnchor.status = "configuration_mismatch";
    } else {
      report.mediaAnchor.before = ANCHORS.some(value => value === app.anchorsite_override) ? String(app.anchorsite_override) : null;
      if (app.anchorsite_override === anchor) {
        report.mediaAnchor.after = anchor; report.mediaAnchor.status = "unchanged";
      } else {
        await telnyxAnfrage(path, { friendly_name: app.friendly_name, voice_url: app.voice_url, anchorsite_override: anchor }, "PATCH");
        const verified = object((await telnyxAnfrage<{ data?: unknown }>(path)).data);
        report.mediaAnchor.after = ANCHORS.some(value => value === verified?.anchorsite_override) ? String(verified?.anchorsite_override) : null;
        report.mediaAnchor.status = verified?.anchorsite_override === anchor ? "updated" : "verification_failed";
      }
    }
  } catch (error) { failed(report.mediaAnchor, error); }

  // Select only our existing, active number attached to this application.
  try {
    const path = "/phone_numbers/" + encodeURIComponent(numberId);
    const current = object((await telnyxAnfrage<{ data?: unknown }>(path)).data);
    if (!current || current.id !== numberId || current.phone_number !== number || current.connection_id !== appId || current.status !== "active") {
      report.hdVoice.status = "configuration_mismatch"; return report;
    }
    report.hdVoice.before = typeof current.hd_voice_enabled === "boolean" ? current.hd_voice_enabled : null;
    if (current.hd_voice_enabled === true) {
      report.hdVoice.after = true; report.hdVoice.status = "unchanged";
    } else if (current.hd_voice_enabled !== false) {
      report.hdVoice.status = "unavailable";
    } else {
      await telnyxAnfrage(path, { hd_voice_enabled: true }, "PATCH");
      const verified = object((await telnyxAnfrage<{ data?: unknown }>(path)).data);
      const matchesNumber = verified?.id === numberId && verified?.phone_number === number && verified?.connection_id === appId && verified?.status === "active";
      report.hdVoice.after = matchesNumber && typeof verified?.hd_voice_enabled === "boolean" ? verified.hd_voice_enabled : null;
      report.hdVoice.status = matchesNumber && verified?.hd_voice_enabled === true ? "updated" : "verification_failed";
    }
  } catch (error) { failed(report.hdVoice, error); }
  return report;
}
