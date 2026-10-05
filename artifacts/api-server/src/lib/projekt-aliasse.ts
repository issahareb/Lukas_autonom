/** Reviewed project identities. Add aliases here only with evidence; never
 * infer an identity from fuzzy similarity (TaxiBot is not TaxiBB). */
export const PROJEKTE = [{
  id: "taxibb", titel: "TaxiBB Essen", domain: "taxibbessen.de", repository: "issahareb/Taxibbessen",
  aliases: ["taxibb", "taxi bb", "taxibb essen", "taxi bb essen", "taxibbessen", "taxibbessen.de",
    "www.taxibbessen.de", "issahareb/Taxibbessen", "github.com/issahareb/Taxibbessen"],
}];
const basis = (s: string) => s.normalize("NFKC").toLowerCase().trim()
  .replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/[ _-]+/g, " ");
export function projektFuerAlias(s: string) {
  const key = basis(s);
  return PROJEKTE.find(p => p.aliases.some(a => basis(a) === key));
}
export function projekteImText(text: string) {
  const s = text.normalize("NFKC").toLowerCase();
  return PROJEKTE.filter(p => p.aliases.some(alias => {
    const pattern = alias.toLowerCase().split(/[ _-]+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[ _-]+");
    const prefix = alias.includes(".") ? "(?:https?://)?" : "";
    return new RegExp(`(?<![\\p{L}\\p{N}._/-])${prefix}${pattern}(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}])`, "u").test(s);
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
