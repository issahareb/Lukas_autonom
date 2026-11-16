/** Reviewed project identities. Add aliases here only with evidence; never
 * infer an identity from fuzzy similarity (TaxiBot is not TaxiBB). */
export const PROJEKTE = [{
  id: "taxibb", titel: "TaxiBB Essen", domain: "taxibbessen.de", repository: "issahareb/Taxibbessen",
  aliases: ["taxibb", "taxi bb", "taxibb essen", "taxi bb essen", "taxibbessen", "taxibbessen.de",
    "www.taxibbessen.de", "issahareb/Taxibbessen", "github.com/issahareb/Taxibbessen", "project:taxibb"],
}];
const basis = (s: string) => s.normalize("NFKC").toLowerCase().trim()
  .replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/[ _-]+/g, " ");
export function projektFuerAlias(s: string) {
  // Resolve URLs by their parsed authority, never by a matching substring.
  // A project page is still the same project; a lookalike host or userinfo is not.
  if (/^https?:\/\//i.test(s.trim())) {
    try {
      const url = new URL(s.trim());
      if (url.username || url.password || url.port) return undefined;
      return PROJEKTE.find(p => [p.domain, "www." + p.domain].includes(url.hostname.toLowerCase()) ||
        (url.hostname.toLowerCase() === "github.com" &&
          url.pathname.replace(/\/$/, "").replace(/\.git$/i, "").toLowerCase() === "/" + p.repository.toLowerCase()));
    } catch { return undefined; }
  }
  const key = basis(s);
  return PROJEKTE.find(p => p.aliases.some(a => basis(a) === key));
}
export function projekteImText(text: string) {
  const s = text.normalize("NFKC").toLowerCase();
  const urls = s.match(/https?:\/\/[^\s<>"']+/g) ?? [];
  const urlProjects = urls.map(url => projektFuerAlias(url.replace(/[),;!?.]+$/, ""))).filter(Boolean);
  const plain = s.replace(/https?:\/\/[^\s<>"']+/g, " ");
  return PROJEKTE.filter(p => urlProjects.includes(p) || p.aliases.some(alias => {
    const pattern = alias.toLowerCase().split(/[ _-]+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[ _-]+");
    return new RegExp(`(?<![\\p{L}\\p{N}_.@:/-])${pattern}(?![\\p{L}\\p{N}_@-]|\\.[\\p{L}\\p{N}]|:\\d)`, "u").test(plain);
  }));
}
export function projektSchluessel(s: string): string {
  return projektFuerAlias(s)?.id ?? s.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 120);
}
export function aliasSchluessel(keys: string[]): string[] {
  return [...new Set(keys.flatMap(k => {
    const p = projektFuerAlias(k);
    return p ? [p.id, ...p.aliases.flatMap(a => [a, "https://" + a, "https://" + a + "/"])
      .map(a => a.trim().toLowerCase().replace(/\s+/g, "_"))] : [k];
  }))];
}
export function projektKontext(query: string): string {
  return projekteImText(query).map(p => `[Projekt ${p.id}] ${p.titel}; Domain: ${p.domain}; Repository: ${p.repository}. ` +
    `Diese Bezeichnungen gehören zum selben Projekt. Angaben zu Zustand und Fortschritt brauchen die folgenden Quellen.`).join("\n");
}
