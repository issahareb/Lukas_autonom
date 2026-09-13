/*
 * Deutsche Beschriftungen fuer die Werte, die in der Datenbank stehen.
 *
 * WARUM. In der Oberflaeche standen bisher die Datenbankwerte selbst:
 * "curious", "preference", "completed", "high" — und an mehreren Stellen
 * zusaetzlich in Grossbuchstaben ("ALL", "ACTIVE", "ABGELAUFEN"). Das ist
 * der Blick des Entwicklers in seine eigene Tabelle, nicht eine Oberflaeche
 * fuer den, der sie benutzt.
 *
 * Die Werte selbst werden NICHT umbenannt. Sie sind die Schnittstelle
 * zwischen Server, Datenbank und Lukas' Werkzeugen; sie hier zu uebersetzen
 * und dort zu lassen, ist genau die richtige Trennung.
 *
 * `?? wert` als Rueckfall ist Absicht: kommt ein neuer Wert dazu, den hier
 * niemand nachgetragen hat, steht er roh da — sichtbar und damit
 * nachtragbar. Ein leeres Feld waere schlimmer, ein "unbekannt" eine Luege.
 */

const STIMMUNG: Record<string, string> = {
  curious: "neugierig",
  focused: "konzentriert",
  energized: "aufgedreht",
  frustrated: "gereizt",
  cold: "kühl",
  scattered: "zerstreut",
  suspicious: "misstrauisch",
  inspired: "inspiriert",
  neutral: "neutral",
  calm: "ruhig",
  tired: "müde",
};

const ENERGIE: Record<string, string> = {
  high: "hoch",
  normal: "normal",
  medium: "mittel",
  low: "niedrig",
};

const ZIELSTAND: Record<string, string> = {
  all: "Alle",
  active: "Aktiv",
  completed: "Erledigt",
  failed: "Gescheitert",
  paused: "Pausiert",
};

const PRIORITAET: Record<string, string> = {
  high: "wichtig",
  medium: "mittel",
  low: "nebenbei",
};

const KATEGORIE: Record<string, string> = {
  personal: "persönlich",
  preference: "Vorliebe",
  goal: "Ziel",
  project: "Projekt",
  finance: "Finanzen",
  gaming: "Gaming",
  health: "Gesundheit",
  learning: "Lernen",
  trading: "Trading",
  work: "Arbeit",
  conversation: "Gespräch",
  other: "Sonstiges",
};

const FREIGABE: Record<string, string> = {
  pending: "offen",
  allowed: "erlaubt",
  denied: "abgelehnt",
  expired: "abgelaufen",
};

const STUFE: Record<string, string> = {
  low: "harmlos",
  medium: "heikel",
  high: "riskant",
  niedrig: "harmlos",
  mittel: "heikel",
  hoch: "riskant",
};

const uebersetzer = (tabelle: Record<string, string>) => (wert: string | null | undefined) =>
  wert ? (tabelle[wert] ?? wert) : "—";

export const stimmung = uebersetzer(STIMMUNG);
export const energie = uebersetzer(ENERGIE);
export const zielstand = uebersetzer(ZIELSTAND);
export const prioritaet = uebersetzer(PRIORITAET);
export const kategorie = uebersetzer(KATEGORIE);
export const freigabe = uebersetzer(FREIGABE);
export const stufe = uebersetzer(STUFE);
