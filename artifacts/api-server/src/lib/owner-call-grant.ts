/** Server-created, one-use capability. Never expose this in a tool schema. */
export type OwnerCallGrant = (nummer: string) => boolean;
const PHONE = String.raw`(?<![\p{L}\p{N}])(?:\+|00)[1-9][0-9 ()/.-]*[0-9]`;
export function ownerCallGrantFromMessage(raw: string): OwnerCallGrant | undefined {
  const text = raw.trim();
  if (!text || text.length > 20000) return undefined;
  const plain = text.replace(/```[\s\S]*?```|"[^"\n]*"|„[^“\n]*“|»[^«\n]*«|`[^`\n]*`/g, " ");
  const head = /^(?:lukas[,!:]?\s+)?(?:bitte\s+)?(ruf(?:e)?\s+|(?:kannst|könntest|würdest)\s+du\s+)/iu.exec(plain);
  if (!head) return undefined;
  if (/\b(?:falls|wenn|sofern|durchwahl|extension|ext)\b|[#;]/iu.test(plain)) return undefined;
  const phones = [...plain.matchAll(new RegExp(PHONE, "gu"))];
  if (phones.length !== 1) return undefined;
  const phone = phones[0];
  const phoneIndex = phone.index!;
  if (phoneIndex < head[0].length) return undefined;
  const before = plain.slice(head[0].length, phoneIndex);
  if (before.length > 200 || /[.!?\n]/.test(before) || /\b(?:erkl\w*|übersetz\w*|formulier\w*|schreib\w*|beschreib\w*|beispiel|text|satz|zitat)\b/iu.test(before)) return undefined;
  const phoneEnd = phoneIndex + phone[0].length;
  const modal = !/^ruf/iu.test(head[1]);
  const ending = new RegExp(modal ? String.raw`\banrufen\b` : String.raw`\ban\b`, "iu").exec(plain.slice(phoneEnd));
  if (!ending || ending.index > 200) return undefined;
  if (/[.!?\n]/.test(plain.slice(phoneEnd, phoneEnd + ending.index))) return undefined;
  const end = phoneEnd + ending.index + ending[0].length;
  const directive = plain.slice(0, end), tail = plain.slice(end).trim();
  if (/\b(?:nicht|nie|niemals|keinesfalls|kein\w*|stopp?|warte|abbrechen|morgen|später|spaeter)\b/iu.test(directive)) return undefined;
  if (tail && !/^(?:[.!?](?:\s|$)|,?\s*(?:wegen|für|zum|und|aber|sag(?:e)?|frag(?:e)?|sprich|verhandle)\b)/iu.test(tail)) return undefined;
  if (/\b(?:stopp?|warte|abbrechen|abbruch)\b|\b(?:doch|lieber)\s+nicht\b|\b(?:nicht|nie|niemals)\b[^.!?\n]{0,40}\b(?:anrufen|wählen|telefonieren)\b|\baber\s+nicht[.!?\s]*$/iu.test(tail)) return undefined;
  const target = phone[0].replace(/[^0-9]/g, "").replace(/^00/, "");
  if (!/^[1-9][0-9]{6,14}$/.test(target)) return undefined;
  let used = false;
  return (nummer: string): boolean => {
    const normalized = nummer.replace(/[^0-9]/g, "").replace(/^00/, "");
    if (used || normalized !== target) return false;
    used = true;
    return true;
  };
}
