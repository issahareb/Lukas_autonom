import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Check, CheckCheck, Inbox, Send, ShieldCheck, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type WartendeMeldung = {
  id: number;
  betreff: string;
  text: string;
  dringend: boolean;
  createdAt: string;
};

type WartendeFreigabe = {
  id: number;
  tool: string;
  riskTier: string;
  argumentsPreview: string;
  expiresAt: string;
};

type Wartet = {
  meldungen: WartendeMeldung[];
  freigaben: WartendeFreigabe[];
  gesamt: { meldungen: number; freigaben: number };
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("lukas_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const TIER_STYLE: Record<string, string> = {
  R0: "bg-secondary text-muted-foreground",
  R1: "bg-secondary text-muted-foreground",
  R2: "bg-amber-500/15 text-amber-300 border border-amber-500/25",
  R3: "bg-red-500/15 text-red-300 border border-red-500/25",
};

/*
 * Was auf Issa wartet — ganz oben auf der Startseite.
 *
 * DER PUNKT IST, DASS MAN HIER HANDELN KANN. Eine Übersicht, die nur zählt
 * ("3 offen") und zum Weiterklicken auffordert, wird zum Zähler, der
 * wochenlang auf 3 steht: jeder einzelne Klick kostet mehr als die
 * Entscheidung wert scheint, und irgendwann sieht man die Zahl nicht mehr.
 * Deshalb steht das Antwortfeld direkt an der Meldung und die beiden Tasten
 * direkt an der Freigabe.
 *
 * Und deshalb ist LEER hier ein Ergebnis, kein fehlender Inhalt: "Nichts
 * offen" ist die Nachricht, dass Lukas gerade nicht auf einen wartet.
 */
export function WartetAufDich() {
  const [daten, setDaten] = useState<Wartet | null>(null);
  const [entwuerfe, setEntwuerfe] = useState<Record<number, string>>({});
  const [beschaeftigt, setBeschaeftigt] = useState<string | null>(null);

  const laden = useCallback(() => {
    fetch(`${BASE}/api/lukas/wartet`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Wartet | null) => setDaten(d))
      .catch(() => setDaten(null));
  }, []);

  useEffect(() => {
    laden();
    // Eine Freigabe entsteht, während Lukas arbeitet, und läuft nach Minuten
    // ab — sie muss von selbst auftauchen, nicht erst beim Neuladen.
    const t = setInterval(laden, 10_000);
    return () => clearInterval(t);
  }, [laden]);

  const antworten = async (id: number) => {
    const antwort = (entwuerfe[id] ?? "").trim();
    if (!antwort) return;
    setBeschaeftigt(`m${id}`);
    try {
      await fetch(`${BASE}/api/lukas/meldungen/${id}/antwort`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ antwort }),
      });
      setEntwuerfe((v) => ({ ...v, [id]: "" }));
      laden();
    } finally {
      setBeschaeftigt(null);
    }
  };

  const entscheide = async (id: number, was: "allow" | "deny" | "allow-auftrag") => {
    setBeschaeftigt(`f${id}`);
    try {
      await fetch(`${BASE}/api/lukas/approvals/${id}/${was}`, {
        method: "POST",
        headers: authHeaders(),
      }).catch(() => {});
      laden();
    } finally {
      setBeschaeftigt(null);
    }
  };

  if (!daten) return null;

  /*
   * Gegen eine Antwort, die nicht so aussieht wie erwartet.
   *
   * Vorher stand hier `daten.meldungen.length` direkt. Liefert die
   * Schnittstelle einmal etwas anderes — ein Fehlerobjekt, eine halbe
   * Antwort, ein Proxy dazwischen —, wirft das, und weil diese Komponente
   * auf der STARTSEITE steht, reisst sie die ganze Seite mit: schwarzer
   * Bildschirm statt einer fehlenden Kachel. Genau so ist es beim
   * Nachstellen passiert.
   */
  const meldungen = Array.isArray(daten.meldungen) ? daten.meldungen : [];
  const freigaben = Array.isArray(daten.freigaben) ? daten.freigaben : [];
  const nichtsOffen = meldungen.length === 0 && freigaben.length === 0;

  if (nichtsOffen) {
    return (
      <section className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
        Nichts offen — Lukas wartet gerade auf keine Antwort und auf keine Freigabe.
      </section>
    );
  }

  const mehr = (gezeigt: number, gesamt: number) =>
    gesamt > gezeigt ? ` · und ${gesamt - gezeigt} weitere` : "";

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <Inbox className="h-4 w-4" /> Wartet auf dich
      </h2>

      {/* ── Freigaben zuerst: sie laufen ab, Meldungen nicht ─────────── */}
      {freigaben.map((f) => (
        <div
          key={f.id}
          className="space-y-3 rounded-lg border border-amber-500/25 bg-card p-4"
          data-testid={`wartet-freigabe-${f.id}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-mono font-medium">{f.tool}</span>
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${TIER_STYLE[f.riskTier] ?? ""}`}
                >
                  {f.riskTier}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                läuft ab{" "}
                {new Date(f.expiresAt).toLocaleTimeString("de-DE", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                className="gap-1.5"
                disabled={beschaeftigt === `f${f.id}`}
                onClick={() => entscheide(f.id, "allow")}
              >
                <Check className="h-4 w-4" /> Erlauben
              </Button>
              {/* "Für die Aufgabe" ist die Entscheidung, die Issa meistens
                  meint: er hat einen Auftrag gegeben, nicht einen Aufruf
                  einzeln erlaubt. Bei R3 gibt es sie nicht — Geld,
                  Zugangsdaten und Unumkehrbares bleiben einzeln. */}
              {f.riskTier !== "R3" && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="gap-1.5"
                  disabled={beschaeftigt === `f${f.id}`}
                  onClick={() => entscheide(f.id, "allow-auftrag")}
                  title="Gilt für dieses Werkzeug in dieser Unterhaltung — 30 Minuten, höchstens 25 Aufrufe"
                >
                  <CheckCheck className="h-4 w-4" /> Für die Aufgabe
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={beschaeftigt === `f${f.id}`}
                onClick={() => entscheide(f.id, "deny")}
              >
                <X className="h-4 w-4" /> Ablehnen
              </Button>
            </div>
          </div>
          {/* Man gibt frei, was man SIEHT — nie nur einen Werkzeugnamen. */}
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border bg-background/60 p-3 text-xs">
            {f.argumentsPreview}
          </pre>
        </div>
      ))}

      {/* ── Meldungen mit Antwortfeld ────────────────────────────────── */}
      {meldungen.map((m) => (
        <div
          key={m.id}
          className={`space-y-3 rounded-lg border bg-card p-4 ${m.dringend ? "border-amber-400/40" : ""}`}
          data-testid={`wartet-meldung-${m.id}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2 font-medium">
              {m.dringend && (
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
                  aria-label="dringend"
                />
              )}
              <span className="text-pretty">{m.betreff}</span>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true, locale: de })}
            </span>
          </div>

          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {m.text}
          </p>

          <Textarea
            value={entwuerfe[m.id] ?? ""}
            onChange={(e) => setEntwuerfe((v) => ({ ...v, [m.id]: e.target.value }))}
            placeholder="Deine Antwort — ein Satz reicht meistens."
            className="min-h-[70px] resize-none text-sm"
            aria-label={`Antwort auf ${m.betreff}`}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              className="gap-2"
              disabled={!(entwuerfe[m.id] ?? "").trim() || beschaeftigt === `m${m.id}`}
              onClick={() => antworten(m.id)}
            >
              <Send className="h-4 w-4" /> Antworten
            </Button>
          </div>
        </div>
      ))}

      <div className="text-xs text-muted-foreground">
        {daten.gesamt.freigaben} Freigabe(n)
        {mehr(freigaben.length, daten.gesamt?.freigaben)} ·{" "}
        {daten.gesamt.meldungen} Meldung(en)
        {mehr(meldungen.length, daten.gesamt?.meldungen)}
      </div>
    </section>
  );
}
