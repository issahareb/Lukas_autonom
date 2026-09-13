import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Seite, Leer, Laedt } from "@/components/seite";
import { KeyRound, Trash2, AlertTriangle, Plus, Eye } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Zugang = {
  sitzung: string;
  feld: string;
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
        body: JSON.stringify({ sitzung, feld, wert, notiz }),
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
    <Seite
      icon={KeyRound}
      titel="Zugänge"
      unterzeile="Anmeldedaten, die Lukas benutzt — und nie zu sehen bekommt."
    >
      <div className="space-y-5">
        {!bereit && (
          <div className="flex gap-3 rounded-3xl bg-destructive/10 p-4 text-sm ring-1 ring-destructive/25">
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
        <div className="card-soft flex gap-3 rounded-3xl p-5 text-sm text-muted-foreground">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            Der Wert wird verschlüsselt abgelegt und nur im Moment der Anmeldung in den
            Browser gegeben. Im Plan von Lukas steht nur{" "}
            <code>{"{{PASSWORT}}"}</code> — er kennt den echten Wert nie, und deshalb kann
            ihn auch keine präparierte Webseite danach fragen. Feldnamen sind frei:{" "}
            <code>BENUTZER</code>, <code>PASSWORT</code>, <code>PIN</code>,{" "}
            <code>API_KEY</code> — jeder wird zu <code>{"{{NAME}}"}</code>.
          </div>
        </div>

        {/* ── Neuer Zugang ────────────────────────────────────────────── */}
        <section className="card-soft space-y-4 rounded-3xl p-5">
          <h2 className="font-medium">Zugang hinterlegen</h2>
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
            <button
              type="button"
              onClick={speichern}
              disabled={!sitzung.trim() || !feld.trim() || !wert || sendet}
              className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100"
            >
              <Plus className="h-4 w-4" /> Speichern
            </button>
          </div>
        </section>

        {/* ── Was hinterlegt ist ──────────────────────────────────────── */}
        {laedt && <Laedt />}

        {!laedt && rows.length === 0 && (
          <Leer
            icon={KeyRound}
            titel="Noch nichts hinterlegt"
            hinweis="Fehlt Lukas ein Zugang, meldet er sich — er rät nicht und tippt nichts Falsches ein."
          />
        )}

        {Object.entries(nachSitzung).map(([name, felder]) => (
          <section key={name} className="space-y-2">
            {/* Mono: der Sitzungsname ist ein Bezeichner, kein Wort. */}
            <h2 className="px-1 font-mono text-sm font-medium">{name}</h2>
            <div className="overflow-hidden rounded-3xl bg-white/[0.03]">
              {felder.map((z, i) => (
                <div
                  key={z.feld}
                  className={`flex items-center justify-between gap-3 px-4 py-3 text-sm ${
                    i > 0 ? "border-t border-white/[0.04]" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <span className="font-mono">{`{{${z.feld}}}`}</span>
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
                    <button
                      type="button"
                      aria-label={`${z.feld} löschen`}
                      onClick={() => loeschen(z)}
                      className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Seite>
  );
}
