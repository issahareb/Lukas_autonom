import { projekteImText } from "./projekt-aliasse";

// Generic instructions are not search terms. Personal names remain useful
// for personal questions; named-project queries enforce an identity check.
const STOP = new Set(`aber alle alles als also auch auf aus bei bitte das dass dein deine deinen deinem deiner den denn der des die dies diese diesen diesem dieser doch dort durch ein eine einem einen einer eines er es etwas für fuer gebe gibt habe haben hast hat hier ich ihm ihn im in ist ja kann keine kein mach mein meine meinem meinen meiner mit nach nicht noch nur oder ohne schon sein seine sich sie sind so soll suche suchen gespeicherten gedächtnis gedaechtnis über ueber und uns unser vom von vor war was welche welcher welches wenn wer wie wir wissen wo zu zum zur zusammen projekt projekte information informationen belege belegten nenne originalauszüge fakten bekannte website webseite domain repository`.split(/\s+/));

export function queryWords(query: string): string[] {
  return [...new Set(query.toLocaleLowerCase("de").split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length > 2 && !STOP.has(w)))].slice(0, 24);
}

export function lexicalRelevance(query: string, text: string): number {
  const words = queryWords(query);
  const tokens = new Set(text.toLocaleLowerCase("de").split(/[^\p{L}\p{N}]+/u));
  const hits = words.filter(w => tokens.has(w)).length;
  const projects = projekteImText(query);
  const project = projects.some(p => projekteImText(text).some(t => t.id === p.id));
  if (projects.length && !project) {
    const identityWords = new Set(projects.flatMap(p => queryWords(p.titel + " " + p.aliases.join(" "))));
    // A shared city/industry is not project evidence. Comparisons can still
    // retrieve the other subject when multiple independent terms match.
    const independent = words.filter(w => !identityWords.has(w) && tokens.has(w));
    if (independent.length < 2) return 0;
  }
  return Math.max(words.length ? hits / words.length : 0, project ? 0.9 : 0);
}

export function relevantEnough(query: string, text: string, semantic = 0): boolean {
  // Semantic matches must be strong. One generic overlapping word in a long
  // instruction is insufficient; an explicit project identity always matches.
  const lex = lexicalRelevance(query, text);
  return lex >= 0.18 || semantic >= 0.72;
}

export function boundedMemory(hits: Array<{ text: string }>, maxChars = 6000): string {
  const lines: string[] = [];
  let used = 0;
  for (const hit of hits) {
    const line = hit.text.length > 1400 ? hit.text.slice(0, 1400) + " … [Auszug; Original bei Bedarf gezielt nachladen]" : hit.text;
    if (used + line.length + 3 > maxChars) continue;
    lines.push(`- ${line}`); used += line.length + 3;
  }
  return lines.join("\n");
}
