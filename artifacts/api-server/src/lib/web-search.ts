import { browserServiceCall, browserServiceConfigured } from "./browser-service";

type SearchResult = { title: string; url: string; snippet?: string };
type BrowserSearch = { ok: boolean; results?: SearchResult[]; fehler?: string };
const text = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const format = (results: SearchResult[]) => results.map((r,i) => `${i+1}. ${r.title}\n   ${r.url}\n   ${r.snippet || ""}`).join("\n\n");

export async function webSearch(query: string): Promise<string> {
  if (!query.trim()) return "Suchanfrage fehlt.";
  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.slice(0,1000))}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LukasAgent/1.0)" }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Search HTTP failure");
    const html = await response.text();
    const links = [...html.matchAll(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].slice(0,8);
    const snippets = [...html.matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].slice(0,8);
    const results = links.map((m,i) => {
      const redirect = m[1].match(/uddg=([^&]+)/);
      return { url: redirect ? decodeURIComponent(redirect[1]) : text(m[1]), title:text(m[2]), snippet:text(snippets[i]?.[1] || "") };
    }).filter(r => /^https?:\/\//.test(r.url));
    if (results.length) return format(results);
    // Empty HTML can be a challenge page; it is not evidence of zero results.
  } catch { /* Independent browser path below; no automatic MCP/VPS dependency. */ }
  if (browserServiceConfigured()) {
    try {
      const result = await browserServiceCall<BrowserSearch>("search", { query });
      if (result.ok && result.results?.length) return "[Browser-Websuche]\n" + format(result.results);
      return "Websuche derzeit nicht erfolgreich: " + (result.fehler || "Keine verifizierbaren Treffer vom Suchanbieter.") + " Bekannte Quellseiten können direkt mit browse_page geprüft werden.";
    } catch { return "Websuche und Railway-Browser derzeit nicht erreichbar. Keine Suchergebnisse verifiziert. Bei bekannter Quelle fetch_url verwenden; nicht behaupten, es gebe keine Treffer."; }
  }
  return "Websuche fehlgeschlagen; keine Suchergebnisse verifiziert. Der unabhängige Browser ist noch nicht konfiguriert.";
}
