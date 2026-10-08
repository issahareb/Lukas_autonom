import { istTelnyx, telnyxAnfrage } from "./telnyx";

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
function mos(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d(?:\.\d+)?$/.test(value))) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 1 && result <= 5 ? result : null;
}
function codec(value: unknown): string | null {
  const allowed = ["OPUS", "PCMU", "PCMA", "G722", "G.722", "G729", "G.729", "AMR", "AMR-WB"];
  return typeof value === "string" && allowed.includes(value.toUpperCase()) ? value.toUpperCase() : null;
}
/** Narrow, read-only metadata probe. No recordings, phone numbers or provider IDs in output. */
export async function inspectRecentTelefonMedia(now = Date.now()) {
  const empty = { status: "not_checked", recordsScanned: 0, matchingRecords: 0,
    pageMayBeTruncated: false, legs: [] as Array<{ startedAt: string | null; mos: number | null; codec: string | null }> };
  if (!istTelnyx() || !process.env.TELNYX_APP_ID || !process.env.TELNYX_API_KEY) return empty;
  const from = new Date(now - 60 * 60 * 1000).toISOString(), to = new Date(now).toISOString();
  try {
    const query = new URLSearchParams({
      "filter[record_type]": "sip-trunking", "filter[started_at][gte]": from,
      "filter[started_at][lt]": to, "page[size]": "50",
    });
    const response = await telnyxAnfrage<{ data?: unknown }>("/detail_records?" + query.toString());
    if (!Array.isArray(response.data)) return { ...empty, status: "invalid_response" };
    const records = response.data.map(object).filter((row): row is Record<string, unknown> => row !== null);
    const matched = records.filter(row => row.connection_id === process.env.TELNYX_APP_ID);
    const legs = matched.slice(0, 20).map(row => ({
      startedAt: typeof row.started_at === "string" && /^\d{4}-\d\d-\d\dT[\d:.+-]+Z?$/.test(row.started_at) &&
        Number.isFinite(Date.parse(row.started_at)) ? new Date(row.started_at).toISOString() : null,
      mos: mos(row.mos), codec: codec(row.codec ?? row.audio_codec),
    }));
    return { status: legs.some(row => row.mos !== null || row.codec !== null) ? "metadata_available" : "quality_fields_unavailable",
      recordsScanned: records.length, matchingRecords: matched.length,
      pageMayBeTruncated: response.data.length >= 50, legs };
  } catch {
    return { ...empty, status: "provider_read_failed" };
  }
}
