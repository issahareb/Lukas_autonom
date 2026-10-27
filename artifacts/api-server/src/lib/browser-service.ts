/** Railway browser RPC. This URL is operator configuration, never model input. */
export function browserServiceConfigured(): boolean {
  return Boolean(process.env.LUKAS_BROWSER_URL?.trim());
}

export async function browserServiceCall<T>(operation: "render" | "operate" | "search" | "healthz", input?: unknown): Promise<T> {
  const endpoint = process.env.LUKAS_BROWSER_URL?.trim();
  const token = process.env.LUKAS_BROWSER_TOKEN?.trim();
  if (!endpoint || !token) throw new Error("Railway-Browser ist nicht vollständig konfiguriert.");
  const base = new URL(endpoint);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("Ungültige Browser-Konfiguration.");
  const controller = AbortSignal.timeout(operation === "healthz" ? 10000 : 165000);
  try {
    const response = await fetch(new URL(`/${operation}`, base), {
      method: operation === "healthz" ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(operation === "healthz" ? {} : { body: JSON.stringify(input) }),
      signal: controller, redirect: "error",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } catch {
    // Never retry a form submission or silently route it through SSH.
    throw new Error("Railway-Browser nicht erreichbar oder Auftrag unterbrochen. Keine automatische Wiederholung; bei Bedienaktionen zuerst den Seitenzustand prüfen. Der VPS wird nicht verwendet.");
  }
}
