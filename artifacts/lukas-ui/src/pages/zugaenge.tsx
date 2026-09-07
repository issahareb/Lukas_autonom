import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { KeyRound, Trash2, AlertTriangle, Plus, Eye } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Zugang = {
  sitzung: string;
  feld: string;
  host: string;
  notiz: string;
  zuletztBenutzt: string | null;
  createdAt: string;
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("lukas_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/*
 * Anmeldedaten, die Lukas benutzt und nie sieht.
 *
 * DIESE SEITE ZEIGT KEINE WERTE. Nicht ausgegraut, nicht als Punkte, nicht
 * hinter einem Klick — sie kennt sie schlicht nicht, weil die API sie nicht
 * herausgibt. Das ist der Zweck der ganzen Sache: wer den API-Token hat, kann
 * Zugänge anlegen und löschen, aber nicht auslesen. Sonst wäre der Token
 * nicht mehr der Schlüssel zu Lukas, sondern zu jedem Konto, das er benutzt.
 *
 * Deshalb gibt es auch kein "Bearbeiten", sondern nur Überschreiben: einen
 * Wert zu ändern, den man nicht sehen kann, ist ohnehin dasselbe wie ihn neu
 * zu setzen — und ein Feld, das den alten Wert vorlädt, gäbe es hier nicht
 * geschenkt.
 */
export default function Zugaenge() {
  const [rows, setRows] = useState<Zugang[]>([]);
  const [bereit, setBereit] = useState(true);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [sitzung, setSitzung] = useState("");
  const [feld, setFeld] = useState("");
  const [wert, setWert] = useState("");
  const [host, setHost] = useState("");
  const [notiz, setNotiz] = useState("");
  const [sendet, setSendet] = useState(false);

  const laden = useCallback(() => {
    fetch(`${BASE}/api/lukas/zugaenge`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setRows(Array.isArray(d?.zugaenge) ? d.zugaenge : []);
        setBereit(d?.bereit !== false);
      })
      .catch(() => setRows([]))
      .finally(() => setLaedt(false));
  }, []);

  useEffect(laden, [laden]);

  const speichern = async () => {
    setSendet(true);
    setFehler(null);
    try {
      const res = await fetch(`${BASE}/api/lukas/zugaenge`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ sitzung, feld, wert, host, notiz }),
      });
      if (!res.ok) {
        setFehler((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
        return;
      }
      /* Das Wertfeld wird SOFORT geleert — es soll nicht im Formular stehen
         bleiben, wo ein Screenshot oder ein Blick über die Schulter es
         mitnimmt. */
      setWert("");
      setNotiz("");
      laden();
    } finally {
      setSendet(false);
    }
  };

  const loeschen = async (z: Zugang) => {
    await fetch(`${BASE}/api/lukas/zugaenge/${encodeURIComponent(z.sitzung)}/${encodeURIComponent(z.feld)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).catch(() => {});
    laden();
  };

  const nachSitzung = rows.reduce<Record<string, Zugang[]>>((acc, z) => {
    (acc[z.sitzung] ??= []).push(z);
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        icon={KeyRound}
        title="Zugänge"
        subtitle="Anmeldedaten, die Lukas benutzt — und nie zu sehen bekommt"
      />

      <div className="max-w-3xl space-y-6 p-5 sm:p-6">
        {!bereit && (
          <div className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <div className="font-medium">Kein Schlüssel gesetzt</div>
              <div className="text-muted-foreground">
                Ohne <code>LUKAS_TRESOR_SCHLUESSEL</code> in der Umgebung des Servers wird
                nichts gespeichert — ein Passwort im Klartext in der Datenbank wäre
                schlimmer als keins. Setz eine lange, zufällige Passphrase.
              </div>
            </div>
          </div>
        )}

        {/* ── Wie es funktioniert ─────────────────────────────────────── */}
        <div className="flex gap-3 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            Der Wert wird verschlüsselt abgelegt und nur im Moment der Anmeldung in den
            Browser gegeben. Im Plan von Lukas steht nur{" "}
            <code>{"{{PASSWORT}}"}</code> — er kennt den echten Wert nie, und deshalb kann
            ihn auch keine präparierte Webseite danach fragen. Feldnamen sind frei:{" "}
            <code>BENUTZER</code>, <code>PASSWORT</code>, <code>PIN</code>,{" "}
            <code>API_KEY</code> — jeder wird zu <code>{"{{NAME}}"}</code>.{" "}
            <strong>Trag die Website ein</strong>: der Wert wird dann nur dort eingesetzt.
            Ohne diese Bindung könnte ein Schrittplan ihn auf einer fremden Seite eintippen.
          </div>
        </div>

        {/* ── Neuer Zugang ────────────────────────────────────────────── */}
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Zugang hinterlegen</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="z-sitzung">
                Sitzung (der Dienst)
              </label>
              <Input
                id="z-sitzung"
                value={sitzung}
                onChange={(e) => setSitzung(e.target.value)}
                placeholder="higgsfield"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="z-feld">
                Feld
              </label>
              <Input
                id="z-feld"
                value={feld}
                onChange={(e) => setFeld(e.target.value)}
                placeholder="PASSWORT"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="z-wert">
                Wert
              </label>
              <Input
                id="z-wert"
                type="password"
                value={wert}
                onChange={(e) => setWert(e.target.value)}
                autoComplete="new-password"
                placeholder="wird verschlüsselt gespeichert"
              />
            </div>
            <div className="space-y-1">
              {/* Der Host ist kein Beiwerk, sondern Teil des Geheimnisses: er
                  entscheidet, WO der Wert eingesetzt werden darf. Ohne ihn
                  könnte ein Schrittplan das Passwort auf einer fremden Seite
                  eintippen — Lukas müsste es dafür nicht einmal kennen. */}
              <label className="text-xs text-muted-foreground" htmlFor="z-host">
                Nur auf dieser Website
              </label>
              <Input
                id="z-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="higgsfield.ai"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="z-notiz">
                Notiz (optional)
              </label>
              <Input
                id="z-notiz"
                value={notiz}
                onChange={(e) => setNotiz(e.target.value)}
                placeholder="Studio-Login"
              />
            </div>
          </div>

          {fehler && <div className="text-sm text-destructive">{fehler}</div>}

          <div className="flex justify-end">
            <Button
              size="sm"
              className="gap-2"
              onClick={speichern}
              disabled={!sitzung.trim() || !feld.trim() || !wert || sendet}
            >
              <Plus className="h-4 w-4" /> Speichern
            </Button>
          </div>
        </section>

        {/* ── Was hinterlegt ist ──────────────────────────────────────── */}
        {laedt && <div className="text-sm text-muted-foreground">Lädt…</div>}

        {!laedt && rows.length === 0 && (
          <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            Noch nichts hinterlegt. Fehlt Lukas ein Zugang, meldet er sich — er rät nicht
            und tippt nichts Falsches ein.
          </div>
        )}

        {Object.entries(nachSitzung).map(([name, felder]) => (
          <section key={name} className="space-y-2">
            <h2 className="font-mono text-sm font-medium">{name}</h2>
            <div className="overflow-hidden rounded-lg border bg-card">
              {felder.map((z) => (
                <div
                  key={z.feld}
                  className="flex items-center justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-0"
                >
                  <div className="min-w-0">
                    <span className="font-mono">{`{{${z.feld}}}`}</span>
                    {z.host ? (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        nur auf {z.host}
                      </span>
                    ) : (
                      <span className="ml-2 text-xs text-amber-400">
                        ohne Website-Bindung — gilt überall
                      </span>
                    )}
                    {z.notiz && (
                      <span className="ml-2 text-muted-foreground">{z.notiz}</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {z.zuletztBenutzt
                        ? `benutzt ${new Date(z.zuletztBenutzt).toLocaleDateString("de-DE")}`
                        : "nie benutzt"}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${z.feld} löschen`}
                      onClick={() => loeschen(z)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
