import { sprachModell, sprachStimme } from "./ai/sprach-sitzung";
type Json = Record<string, unknown>;
type Check = { status: "not_run" | "ok" | "missing_config" | "invalid_config" | "network_error" | "http_error" | "invalid_response"; httpStatus?: number };
type ReadResult = { check: Check; data?: Json };
type OpenAIWebhookReport = {
  eventTypes: Check; liveEventAvailable: boolean | null; endpoints: Check;
  expectedUrlConfigured: boolean; matchingUrlFound: boolean | null; liveEventSubscribed: boolean | null;
  endpointEnabled: "not_exposed_by_api"; signingSecretMatches: "not_verified";
  pagesScanned: number; pageLimit: number; pageLimitReached: boolean; listingComplete: boolean;
};
export type TelefonSetupReport = {
  checkedAt: string; provider: "telnyx" | "twilio"; openaiWebhooks: OpenAIWebhookReport; configurationChecksPassed: boolean;
  openai: {
    keyConfigured: boolean; keySource: "AI_INTEGRATIONS_OPENAI_API_KEY" | "OPENAI_API_KEY" | null;
    apiOrigin: string | null; model: string | null; voice: string | null; projectConfigured: boolean;
    webhookSecretConfigured: boolean; webhookVerifierKeyConfigured: boolean; projectHeaderSentByLive: boolean;
    catalog: Check; modelIdMatches: boolean | null;
    liveSession: "not_tested"; billing: "not_tested"; webhookSubscription: "not_verified" | "subscribed" | "missing_endpoint" | "missing_live_event";
  };
  telnyx: {
    selected: boolean; missingEnvironment: string[]; phone: Check; numberFound: boolean | null;
    numberActive: boolean | null; numberAttachedToApplication: boolean | null;
    application: Check; applicationActive: boolean | null; expectedVoiceUrlConfigured: boolean;
    voiceUrlMatches: boolean | null; voiceMethodPost: boolean | null; outboundProfileConfigured: boolean | null;
    outboundProfile: Check; outboundProfileEnabled: boolean | null;
  };
};
function object(value: unknown): Json | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : undefined;
}
/** Never return provider bodies/errors, credentials or request URLs. */
async function readJson(url: string, key: string, project?: string): Promise<ReadResult> {
  try {
    const response = await fetch(url, {
      method: "GET", redirect: "error",
      headers: { Authorization: "Bearer " + key, Accept: "application/json", ...(project ? { "OpenAI-Project": project } : {}) },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { check: { status: "http_error", httpStatus: response.status } };
    }
    const data = object(await response.json().catch(() => undefined));
    return data ? { check: { status: "ok", httpStatus: response.status }, data }
      : { check: { status: "invalid_response", httpStatus: response.status } };
  } catch { return { check: { status: "network_error" } }; }
}
function openaiConnection(): { base: string; origin: string } | null {
  try {
    const raw = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim();
    const base = raw ? raw.replace(/^["']+/, "").replace(/["'\s/]+$/, "") : "https://api.openai.com/v1";
    const url = new URL(base);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return { base, origin: url.origin };
  } catch { return null; }
}
function expectedVoiceUrl(publicBaseUrl?: string): string | null {
  const configured = publicBaseUrl?.trim() || (process.env.RAILWAY_PUBLIC_DOMAIN?.trim()
    ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN.trim() : "");
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return new URL("/api/telefon/telnyx/texml", url.origin).href;
  } catch { return null; }
}
function matchesVoiceUrl(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string") return false;
  try {
    const url = new URL(actual), target = new URL(expected);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      url.origin === target.origin && url.pathname.replace(/\/+$/, "") === target.pathname;
  } catch { return false; }
}
async function inspectOpenAI(): Promise<TelefonSetupReport["openai"]> {
  const integrationKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const standardKey = process.env.OPENAI_API_KEY;
  const key = (integrationKey ?? standardKey ?? "").trim();
  const connection = openaiConnection();
  let model: string | null = null, voice: string | null = null;
  try { const candidate = sprachModell().trim(); if (/^gpt-live-[A-Za-z0-9.-]{1,100}$/.test(candidate)) model = candidate; } catch {}
  try { const candidate = sprachStimme().trim(); if (/^[a-z][a-z0-9_-]{0,63}$/.test(candidate)) voice = candidate; } catch {}
  const project = process.env.OPENAI_PROJECT_ID?.trim() ?? "";
  const projectConfigured = /^proj_[A-Za-z0-9_-]+$/.test(project);
  const report: TelefonSetupReport["openai"] = {
    keyConfigured: Boolean(key),
    keySource: integrationKey !== undefined ? "AI_INTEGRATIONS_OPENAI_API_KEY" : standardKey !== undefined ? "OPENAI_API_KEY" : null,
    apiOrigin: connection?.origin ?? null, model, voice, projectConfigured,
    webhookSecretConfigured: Boolean(process.env.OPENAI_WEBHOOK_SECRET?.trim()),
    webhookVerifierKeyConfigured: Boolean(integrationKey?.trim()), projectHeaderSentByLive: projectConfigured,
    catalog: { status: "not_run" }, modelIdMatches: null,
    liveSession: "not_tested", billing: "not_tested", webhookSubscription: "not_verified",
  };
  if (!key) { report.catalog = { status: "missing_config" }; return report; }
  if (!connection || !model || !voice || (project && !projectConfigured)) { report.catalog = { status: "invalid_config" }; return report; }
  const result = await readJson(connection.base + "/models/" + encodeURIComponent(model), key, project || undefined);
  report.catalog = result.check;
  if (result.data) report.modelIdMatches = result.data.id === model;
  return report;
}
async function inspectTelnyx(publicBaseUrl?: string): Promise<TelefonSetupReport["telnyx"]> {
  const selected = (process.env.LUKAS_TELEFON_ANBIETER ?? "twilio") === "telnyx";
  const required = ["TELNYX_API_KEY", "TELNYX_NUMMER", "TELNYX_APP_ID", "TELNYX_PUBLIC_KEY"];
  const expected = expectedVoiceUrl(publicBaseUrl);
  const report: TelefonSetupReport["telnyx"] = {
    selected, missingEnvironment: selected ? required.filter(name => !process.env[name]?.trim()) : [],
    phone: { status: "not_run" }, numberFound: null, numberActive: null, numberAttachedToApplication: null,
    application: { status: "not_run" }, applicationActive: null,
    expectedVoiceUrlConfigured: Boolean(expected), voiceUrlMatches: null, voiceMethodPost: null,
    outboundProfileConfigured: null, outboundProfile: { status: "not_run" }, outboundProfileEnabled: null,
  };
  if (!selected) return report;
  const key = process.env.TELNYX_API_KEY?.trim();
  if (!key) { report.phone = { status: "missing_config" }; report.application = { status: "missing_config" }; return report; }
  const number = process.env.TELNYX_NUMMER?.trim() ?? "";
  const applicationId = process.env.TELNYX_APP_ID?.trim() ?? "";
  const validNumber = /^\+[1-9]\d{5,14}$/.test(number);
  const validApplication = /^[A-Za-z0-9_-]{1,100}$/.test(applicationId);
  const [phone, application] = await Promise.all([
    validNumber ? readJson("https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=" + encodeURIComponent(number), key)
      : Promise.resolve<ReadResult>({ check: { status: number ? "invalid_config" : "missing_config" } }),
    validApplication ? readJson("https://api.telnyx.com/v2/texml_applications/" + encodeURIComponent(applicationId), key)
      : Promise.resolve<ReadResult>({ check: { status: applicationId ? "invalid_config" : "missing_config" } }),
  ]);
  report.phone = phone.check; report.application = application.check;
  if (phone.data) {
    if (!Array.isArray(phone.data.data)) report.phone = { status: "invalid_response", httpStatus: phone.check.httpStatus };
    else {
      const match = phone.data.data.map(object).find(row => row?.phone_number === number);
      report.numberFound = Boolean(match); report.numberActive = match?.status === "active";
      report.numberAttachedToApplication = Boolean(validApplication && match?.connection_id === applicationId);
    }
  }
  if (application.data) {
    const app = object(application.data.data);
    if (!app) report.application = { status: "invalid_response", httpStatus: application.check.httpStatus };
    else {
      report.applicationActive = app.active === true; report.voiceMethodPost = app.voice_method === "post";
      report.voiceUrlMatches = expected ? matchesVoiceUrl(app.voice_url, expected) : null;
      const profileId = object(app.outbound)?.outbound_voice_profile_id;
      report.outboundProfileConfigured = typeof profileId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(profileId);
      if (report.outboundProfileConfigured) {
        const profile = await readJson("https://api.telnyx.com/v2/outbound_voice_profiles/" + encodeURIComponent(profileId as string), key);
        report.outboundProfile = profile.check;
        if (profile.data) {
          const data = object(profile.data.data);
          if (!data) report.outboundProfile = { status: "invalid_response", httpStatus: profile.check.httpStatus };
          else report.outboundProfileEnabled = data.enabled === true;
        }
      } else report.outboundProfile = { status: "missing_config" };
    }
  }
  return report;
}

async function inspectOpenAIWebhooks(publicBaseUrl?: string): Promise<OpenAIWebhookReport> {
  const voiceUrl = expectedVoiceUrl(publicBaseUrl);
  const expected = voiceUrl ? new URL("/api/telefon/eingehend", voiceUrl).href : null;
  const report: OpenAIWebhookReport = {
    eventTypes: { status: "not_run" }, liveEventAvailable: null,
    endpoints: { status: "not_run" }, expectedUrlConfigured: Boolean(expected),
    matchingUrlFound: null, liveEventSubscribed: null,
    endpointEnabled: "not_exposed_by_api", signingSecretMatches: "not_verified",
    pagesScanned: 0, pageLimit: 3, pageLimitReached: false, listingComplete: false,
  };
  const key = (process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "").trim();
  const connection = openaiConnection(), rawProject = process.env.OPENAI_PROJECT_ID?.trim() ?? "";
  const projectId = /^proj_[A-Za-z0-9_-]+$/.test(rawProject) ? rawProject : undefined;
  if (!key || !connection || (rawProject && !projectId)) {
    const status = !key ? "missing_config" : "invalid_config";
    report.eventTypes = { status }; report.endpoints = { status }; return report;
  }
  const scanEndpoints = async () => {
    let after = ""; const cursors = new Set<string>();
    let matched = false, subscribed = false;
    for (let page = 0; page < report.pageLimit; page++) {
      const query = "?limit=100" + (after ? "&after=" + encodeURIComponent(after) : "");
      const result = await readJson(connection.base + "/webhook_endpoints" + query, key, projectId);
      report.pagesScanned++; report.endpoints = result.check;
      if (!result.data) return;
      const rows = result.data.data;
      if (!Array.isArray(rows) || typeof result.data.has_more !== "boolean") {
        report.endpoints = { status: "invalid_response", httpStatus: result.check.httpStatus }; return;
      }
      for (const value of rows) {
        const endpoint = object(value);
        if (!endpoint || typeof endpoint.url !== "string" || !Array.isArray(endpoint.event_types) ||
            !endpoint.event_types.every(event => typeof event === "string")) {
          report.endpoints = { status: "invalid_response", httpStatus: result.check.httpStatus }; return;
        }
        if (expected && matchesVoiceUrl(endpoint.url, expected)) {
          matched = true; if (endpoint.event_types.includes("live.transport.incoming")) subscribed = true;
        }
      }
      if (expected) { report.matchingUrlFound = matched; report.liveEventSubscribed = subscribed; }
      if (!result.data.has_more) { report.listingComplete = true; return; }
      if (page + 1 === report.pageLimit) { report.pageLimitReached = true; return; }
      const cursor = result.data.last_id;
      if (typeof cursor !== "string" || !cursor || cursor.length > 256 || cursors.has(cursor)) {
        report.endpoints = { status: "invalid_response", httpStatus: result.check.httpStatus }; return;
      }
      cursors.add(cursor); after = cursor;
    }
  };
  const [eventTypes] = await Promise.all([
    readJson(connection.base + "/webhook_event_types", key, projectId), scanEndpoints(),
  ]);
  report.eventTypes = eventTypes.check;
  if (eventTypes.data) {
    if (Array.isArray(eventTypes.data.data) && eventTypes.data.data.every(event => typeof event === "string")) {
      report.liveEventAvailable = eventTypes.data.data.includes("live.transport.incoming");
    } else report.eventTypes = { status: "invalid_response", httpStatus: eventTypes.check.httpStatus };
  }
  return report;
}

/** Metadata only: no generated answer, session creation, dial or provider mutation. */
export async function inspectTelefonSetup(options: { publicBaseUrl?: string } = {}): Promise<TelefonSetupReport> {
  const [openai, telnyx, openaiWebhooks] = await Promise.all([
    inspectOpenAI(), inspectTelnyx(options.publicBaseUrl), inspectOpenAIWebhooks(options.publicBaseUrl),
  ]);
  if (openaiWebhooks.liveEventSubscribed === true) openai.webhookSubscription = "subscribed";
  else if (openaiWebhooks.listingComplete && openaiWebhooks.expectedUrlConfigured)
    openai.webhookSubscription = openaiWebhooks.matchingUrlFound ? "missing_live_event" : "missing_endpoint";
  const configurationChecksPassed = Boolean(
    openaiWebhooks.liveEventAvailable === true && openaiWebhooks.liveEventSubscribed === true &&
    openaiWebhooks.eventTypes.status === "ok" && openaiWebhooks.endpoints.status === "ok" &&
    openai.keyConfigured && openai.model && openai.voice && openai.projectConfigured &&
    openai.webhookSecretConfigured && openai.webhookVerifierKeyConfigured &&
    openai.catalog.status === "ok" && openai.modelIdMatches === true &&
    telnyx.selected && telnyx.missingEnvironment.length === 0 &&
    telnyx.phone.status === "ok" && telnyx.numberFound === true && telnyx.numberActive === true &&
    telnyx.numberAttachedToApplication === true && telnyx.application.status === "ok" &&
    telnyx.applicationActive === true && telnyx.voiceUrlMatches === true && telnyx.voiceMethodPost === true &&
    telnyx.outboundProfile.status === "ok" && telnyx.outboundProfileEnabled === true
  );
  return { checkedAt: new Date().toISOString(), provider: telnyx.selected ? "telnyx" : "twilio",
    configurationChecksPassed, openai, telnyx, openaiWebhooks };
}
