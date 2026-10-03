/** Explicit setup operation; never creates calls, sessions or webhook secrets. */
type Json = Record<string, unknown>;
type Endpoint = { id: string; url: string; event_types: string[] };
type RequestResult = { ok: boolean; httpStatus?: number; data?: Json };
export type TelefonWebhookRepairReport = {
  enabled: boolean;
  status: "disabled" | "invalid_config" | "api_error" | "live_event_unavailable" |
    "listing_incomplete" | "endpoint_missing" | "endpoint_ambiguous" | "endpoint_changed" |
    "subscription_unverified" | "configured_test_unavailable" |
    "configured_delivery_unverified" | "configured_delivery_verified" | "internal_error";
  stage: "none" | "catalog" | "list" | "retrieve" | "update" | "verify" | "test";
  updateAttempted: boolean; subscriptionVerified: boolean; deliveryVerified: boolean;
  providerHttpStatus: number | null; deliveryHttpStatus: number | null;
  testEventType: "batch.completed" | "response.completed" | "realtime.call.incoming" | null;
};
const LIVE_EVENT = "live.transport.incoming";
let attempt: Promise<TelefonWebhookRepairReport> | undefined;
function object(value: unknown): Json | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : undefined;
}
function parseEndpoint(value: unknown): Endpoint | null {
  const row = object(value);
  if (!row || typeof row.id !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(row.id) ||
      typeof row.url !== "string" || !Array.isArray(row.event_types) ||
      !row.event_types.every(event => typeof event === "string")) return null;
  return { id: row.id, url: row.url, event_types: row.event_types as string[] };
}
function matchesUrl(actual: string, expected: string): boolean {
  try {
    const url = new URL(actual), target = new URL(expected);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      url.origin === target.origin && url.pathname.replace(/\/+$/, "") === target.pathname;
  } catch { return false; }
}
function initialReport(enabled: boolean): TelefonWebhookRepairReport {
  return { enabled, status: enabled ? "invalid_config" : "disabled", stage: "none",
    updateAttempted: false, subscriptionVerified: false, deliveryVerified: false,
    providerHttpStatus: null, deliveryHttpStatus: null, testEventType: null };
}
async function performRepair(options: { publicBaseUrl?: string }): Promise<TelefonWebhookRepairReport> {
  const report = initialReport(true);
  try {
    const integrationKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim();
    const key = (process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "").trim();
    const project = process.env.OPENAI_PROJECT_ID?.trim() ?? "";
    if (!key || !integrationKey || !process.env.OPENAI_WEBHOOK_SECRET?.trim() || !/^proj_[A-Za-z0-9_-]+$/.test(project)) return report;
    const rawBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim();
    const base = rawBase ? rawBase.replace(/^["']+/, "").replace(/["'\s/]+$/, "") : "https://api.openai.com/v1";
    const apiUrl = new URL(base);
    if (apiUrl.protocol !== "https:" || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) return report;
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
    const publicBase = options.publicBaseUrl?.trim() || process.env.LUKAS_PUBLIC_URL?.trim() || (domain ? "https://" + domain : "");
    if (!publicBase) return report;
    const publicUrl = new URL(publicBase);
    if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) return report;
    const expectedUrl = new URL("/api/telefon/eingehend", publicUrl.origin).href;
    const headers = { Authorization: "Bearer " + key, "OpenAI-Project": project,
      "Content-Type": "application/json", Accept: "application/json" };
    const request = async (path: string, body?: Json): Promise<RequestResult> => {
      try {
        const response = await fetch(base + path, {
          method: body === undefined ? "GET" : "POST", headers, redirect: "error",
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          return { ok: false, httpStatus: response.status };
        }
        const data = object(await response.json().catch(() => undefined));
        return { ok: Boolean(data), httpStatus: response.status, data };
      } catch { return { ok: false }; }
    };
    const fail = (result: RequestResult) => {
      report.status = "api_error"; report.providerHttpStatus = result.httpStatus ?? null; return report;
    };
    report.stage = "catalog";
    const catalog = await request("/webhook_event_types");
    if (!catalog.ok || !catalog.data || !Array.isArray(catalog.data.data) || !catalog.data.data.every(event => typeof event === "string")) return fail(catalog);
    const availableEvents = new Set(catalog.data.data as string[]);
    if (!availableEvents.has(LIVE_EVENT)) { report.status = "live_event_unavailable"; return report; }
    report.stage = "list";
    const matches: Endpoint[] = [], cursors = new Set<string>();
    let after = "", complete = false;
    for (let page = 0; page < 3; page++) {
      const result = await request("/webhook_endpoints?limit=100" + (after ? "&after=" + encodeURIComponent(after) : ""));
      if (!result.ok || !result.data || !Array.isArray(result.data.data) || typeof result.data.has_more !== "boolean") return fail(result);
      for (const value of result.data.data) {
        const endpoint = parseEndpoint(value);
        if (!endpoint) return fail(result);
        if (matchesUrl(endpoint.url, expectedUrl)) matches.push(endpoint);
      }
      if (!result.data.has_more) { complete = true; break; }
      const cursor = result.data.last_id;
      if (typeof cursor !== "string" || !cursor || cursor.length > 256 || cursors.has(cursor)) return fail(result);
      cursors.add(cursor); after = cursor;
    }
    if (!complete) { report.status = "listing_incomplete"; return report; }
    if (matches.length !== 1) { report.status = matches.length ? "endpoint_ambiguous" : "endpoint_missing"; return report; }
    report.stage = "retrieve";
    const endpointPath = "/webhook_endpoints/" + encodeURIComponent(matches[0].id);
    const fresh = await request(endpointPath);
    if (!fresh.ok) return fail(fresh);
    const existing = parseEndpoint(fresh.data);
    if (!existing || existing.id !== matches[0].id || !matchesUrl(existing.url, expectedUrl)) {
      report.status = "endpoint_changed"; return report;
    }
    const preservedEvents = [...new Set(existing.event_types)];
    if (!preservedEvents.includes(LIVE_EVENT)) {
      report.stage = "update"; report.updateAttempted = true;
      const update = await request(endpointPath, { event_types: [...preservedEvents, LIVE_EVENT] });
      report.providerHttpStatus = update.httpStatus ?? null;
      // Reconcile even an ambiguous timeout with GET; never blindly retry POST.
    }

    report.stage = "verify";
    const verified = await request(endpointPath);
    if (!verified.ok) return fail(verified);
    const current = parseEndpoint(verified.data);
    if (!current || current.id !== existing.id || !matchesUrl(current.url, expectedUrl) ||
        !current.event_types.includes(LIVE_EVENT) || !preservedEvents.every(event => current.event_types.includes(event))) {
      report.status = "subscription_unverified"; return report;
    }
    report.subscriptionVerified = true;
    const harmlessEvents = ["batch.completed", "response.completed", "realtime.call.incoming"] as const;
    const testEvent = harmlessEvents.find(event => current.event_types.includes(event) && availableEvents.has(event))
      ?? (availableEvents.has("batch.completed") ? "batch.completed" : undefined);
    if (!testEvent) { report.status = "configured_test_unavailable"; return report; }
    report.stage = "test"; report.testEventType = testEvent;
    const tested = await request(endpointPath + "/test", { event_type: testEvent });
    report.providerHttpStatus = tested.httpStatus ?? null;
    const deliveryStatus = tested.data?.status_code;
    report.deliveryHttpStatus = Number.isInteger(deliveryStatus) && Number(deliveryStatus) >= 100 && Number(deliveryStatus) <= 599
      ? Number(deliveryStatus) : null;
    report.deliveryVerified = Boolean(tested.ok && tested.data?.object === "webhook_endpoint.test" &&
      tested.data.webhook_endpoint_id === existing.id && tested.data.event_type === testEvent &&
      tested.data.success === true && report.deliveryHttpStatus === 200);
    report.status = report.deliveryVerified ? "configured_delivery_verified" : "configured_delivery_unverified";
    return report;
  } catch {
    report.status = report.stage === "none" ? "invalid_config" : "internal_error"; return report;
  }
}
/** Default off; one promise per process. Clear the deployment flag after verification. */
export function repairTelefonWebhookOnce(options: { publicBaseUrl?: string } = {}): Promise<TelefonWebhookRepairReport> {
  if (process.env.LUKAS_TELEFON_WEBHOOK_REPAIR?.trim().toLowerCase() !== "true") return Promise.resolve(initialReport(false));
  attempt ??= performRepair(options);
  return attempt;
}
