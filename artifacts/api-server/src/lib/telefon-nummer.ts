/** Canonical telephone key. Domestic numbers use this German service's country code.
 * Do not extract digits from display names, extensions or SIP hosts.
 */
export function telefonNummer(value: string): string {
  const sip = value.match(/sips?:([^@;>]+)(?:;[^@>]*)?@/i);
  const raw = (sip?.[1] ?? value).trim().replace(/^tel:/i, "");
  if (!/^[+()\d\s./-]+$/.test(raw)) return "";
  let digits = raw.replace(/[^0-9]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (!raw.startsWith("+") && digits.startsWith("0")) digits = "49" + digits.slice(1);
  return /^[1-9]\d{5,14}$/.test(digits) ? digits : "";
}
