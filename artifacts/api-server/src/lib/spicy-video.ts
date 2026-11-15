/** SpicyAPI Wan image-to-video. Credentials stay on the API server. */
const BASE = "https://api.spicyapi.ai/api/v1/jobs";
export const SPICY_VIDEO_MODEL = "alibaba/wan-3.0/image-to-video";

function text(value: unknown, name: string, max = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${name}: ungültiger oder fehlender Wert.`);
  }
  return value.trim();
}

function httpsUrl(value: unknown, name: string): string {
  const raw = text(value, name, 12000);
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`${name}: HTTPS-URL erforderlich.`); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(`${name}: HTTPS-URL ohne Anmeldedaten oder Fragment erforderlich.`);
  }
  return raw;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SpicyAPI: ungültige Antwort.");
  }
  return value as Record<string, unknown>;
}

function allowed(input: Record<string, unknown>, names: string[]) {
  if (Object.keys(input).some(key => !names.includes(key))) throw new Error("Unbekannter Video-Parameter.");
}

/** Exported separately so invalid requests can be tested without credentials. */
export function spicyVideoRequest(input: Record<string, unknown>) {
  allowed(input, ["image_url", "last_image_url", "prompt", "duration_seconds", "resolution", "aspect_ratio", "generate_audio", "idempotency_key"]);
  const key = text(input.idempotency_key, "idempotency_key", 128);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new Error("idempotency_key: 16 bis 128 Zeichen aus Buchstaben, Ziffern, _ oder - erforderlich.");
  const duration = input.duration_seconds ?? 5;
  if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 2 || duration > 30) {
    throw new Error("duration_seconds: ganze Zahl von 2 bis 30 erforderlich.");
  }
  const resolution = input.resolution ?? "720p";
  if (typeof resolution !== "string" || !["480p", "720p", "1080p"].includes(resolution)) throw new Error("Ungültige Auflösung.");
  const ratio = input.aspect_ratio;
  if (ratio !== undefined && (typeof ratio !== "string" || !["16:9", "9:16", "1:1", "4:3", "3:4", "adaptive"].includes(ratio))) {
    throw new Error("Ungültiges Seitenverhältnis.");
  }
  if (input.generate_audio !== undefined && typeof input.generate_audio !== "boolean") throw new Error("generate_audio muss boolean sein.");
  return {
    key,
    body: {
      model: SPICY_VIDEO_MODEL,
      input: {
        image_url: httpsUrl(input.image_url, "image_url"),
        ...(input.last_image_url === undefined ? {} : { last_image_url: httpsUrl(input.last_image_url, "last_image_url") }),
        ...(input.prompt === undefined ? {} : { prompt: text(input.prompt, "prompt", 10000) }),
        duration_seconds: duration,
        resolution,
        ...(ratio === undefined ? {} : { aspect_ratio: ratio }),
        generate_audio: input.generate_audio ?? true,
        enable_prompt_expansion: false,
        enable_thinking: false,
      },
    },
  };
}

async function request(path: string, init: RequestInit, signal?: AbortSignal) {
  const key = process.env.SPICY_API_KEY?.trim();
  if (!key) throw new Error("SPICY_API_KEY fehlt. Im Secret-Bereich des API-Servers hinterlegen, niemals im Chat.");
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(20000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${BASE}/${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      redirect: "error",
      signal: combined,
    });
  } catch {
    signal?.throwIfAborted();
    throw new Error("SpicyAPI-Verbindung unterbrochen; Auftragsstatus ist unklar. Bei Erstellung ausschließlich dieselben Parameter und denselben idempotency_key wiederverwenden. Bei vorhandener task_id nur den Status abfragen.");
  }
  if (!response.ok) throw new Error(`SpicyAPI HTTP ${response.status}. Keine automatische neue Bestellung; bei Wiederholung denselben idempotency_key verwenden.`);
  let parsed: unknown;
  try { parsed = await response.json(); }
  catch { throw new Error("SpicyAPI lieferte keine gültige JSON-Antwort. Auftrag kann trotzdem angenommen sein; keinen neuen idempotency_key erzeugen."); }
  const envelope = object(parsed);
  if (envelope.code !== 200) throw new Error("SpicyAPI hat den Auftrag nicht bestätigt. Keine erfolgreiche Erstellung melden; ursprünglichen idempotency_key beibehalten.");
  return object(envelope.data);
}

function taskId(value: unknown): string {
  const id = text(value, "task_id", 160);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Ungültige task_id.");
  return id;
}

export async function erzeugeSpicyVideo(input: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const { key, body } = spicyVideoRequest(input);
  const data = await request("createTask", {
    method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(body),
  }, signal);
  // Acceptance is never a completed video. Preserve the key and original args
  // in tool history so an interrupted response can be recovered without buying twice.
  return JSON.stringify({
    task_id: taskId(data.taskId),
    status: "angenommen",
    abgeschlossen: false,
    idempotency_key: key,
    ...(typeof data.estimatedCost === "string" ? { geschaetzte_kosten: data.estimatedCost } : {}),
    hinweis: "Auftrag angenommen, Video noch nicht fertig. task_id speichern und spicy_video_status verwenden. Während der Verarbeitung keinen neuen Auftrag erstellen.",
  });
}

export async function spicyVideoStatus(input: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  allowed(input, ["task_id"]);
  const id = taskId(input.task_id);
  const data = await request(`recordInfo?taskId=${encodeURIComponent(id)}`, { method: "GET" }, signal);
  if (taskId(data.taskId) !== id) throw new Error("SpicyAPI-Antwort gehört zu einem anderen Auftrag.");
  const state = data.state;
  if (!["queued", "running", "processing", "waiting", "succeeded", "failed", "cancelled", "canceled"].includes(String(state))) {
    return JSON.stringify({ task_id: id, status: "unbekannt", abgeschlossen: false, hinweis: "Unbekannter Anbieterstatus. Keine Fertigstellung annehmen und keinen Ersatzauftrag erstellen." });
  }
  const done = state === "succeeded";
  const failed = ["failed", "cancelled", "canceled"].includes(String(state));
  let assets: Array<{ url: string; mime?: string; expires_at?: string }> = [];
  if (done) {
    const output = object(data.output);
    if (!Array.isArray(output.assets) || output.assets.length === 0) throw new Error("Anbieter meldet Erfolg, liefert aber kein abrufbares Video.");
    assets = output.assets.map((raw: unknown) => {
      const asset = object(raw);
      return {
        url: httpsUrl(asset.url, "Ergebnis-URL"),
        ...(typeof asset.mime === "string" ? { mime: asset.mime } : {}),
        ...(typeof asset.expiresAt === "string" ? { expires_at: asset.expiresAt } : {}),
      };
    });
  }
  return JSON.stringify({
    task_id: id, status: state, abgeschlossen: done || failed, erfolgreich: done,
    ...(typeof data.cost === "string" ? { kosten: data.cost } : {}),
    ...(typeof data.settled === "boolean" ? { abgerechnet: data.settled } : {}),
    ...(done ? { videos: assets, hinweis: "Ergebnislinks können ablaufen. Video rechtzeitig herunterladen; dauerhafte Ablage ist noch nicht eingerichtet." } : {}),
    ...(failed ? { hinweis: "Video fehlgeschlagen oder abgebrochen. Keinen kostenpflichtigen Ersatzauftrag ohne neuen Nutzerauftrag erzeugen." } : {}),
    ...(!done && !failed ? { hinweis: "Noch in Verarbeitung. Nach kurzer Wartezeit erneut Status abfragen; keinen neuen Auftrag erstellen." } : {}),
  });
}
