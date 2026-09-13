import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Phone, PhoneIncoming, PhoneOutgoing, Plus, Trash2, ShieldAlert, MessageSquare, Send } from "lucide-react";
import { Seite } from "@/components/seite";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Stufe = "privat" | "oeffentlich" | "gesperrt";

type Nummer = {
  id: number;
  nummer: string;
  name: string;
  stufe: Stufe;
  darfAngerufenWerden: boolean;
  notiz: string;
  zuletztGesehen: string | null;
};

type Anruf = {
  id: number;
  richtung: "eingehend" | "ausgehend";
  nummer: string;
  ergebnis: string;
  stufe: string;
  anlass: string;
  createdAt: string;
};

type TwilioStand = {
  nummern: Array<{ nummer: string; name: string }>;
  trunk: string | null;
  origination: string[];
  amTrunk: string[];
  ziel: string | null;
};

type Antwort = {
  nummern: Nummer[];
  anrufe: Anruf[];
  bereit: { webhook: boolean; anrufen: boolean };
};

const STUFE: Record<Stufe, { label: string; cls: string; hilfe: string }> = {
  privat: {
    label: "PRIVAT",
    cls: "bg-emerald-500/15 text-emerald-300",
    hilfe: "Voller Lukas mit Gedächtnis, Zielen und Tagebuch. Nur für dich.",
  },
  oeffentlich: {
    label: "ÖFFENTLICH",
    cls: "bg-secondary text-muted-foreground",
    hilfe: "Derselbe Lukas wie auf der Webseite. Nichts Privates.",
  },
  gesperrt: {
    label: "GESPERRT",
    cls: "bg-red-500/15 text-red-300",
    hilfe: "Wird abgewiesen, bevor überhaupt eine Sitzung entsteht.",
  },
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("lukas_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api/lukas/telefon${path}`, {
    ...init,
    headers: { ...authHeaders(), "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

/** +49 151 12345678 — nur zur Anzeige, gespeichert sind reine Ziffern. */
function zeigeNummer(ziffern: string): string {
  if (ziffern.length < 7) return "+" + ziffern;
  return `+${ziffern.slice(0, 2)} ${ziffern.slice(2, 5)} ${ziffern.slice(5)}`;
}

function NummerZeile({ eintrag, onChange }: { eintrag: Nummer; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  const patch = async (werte: Partial<Nummer>) => {
    setBusy(true);
    setFehler(null);
    try {
      await api(`/${eintrag.id}`, { method: "PATCH", body: JSON.stringify(werte) });
      onChange();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(false);
    }
  };

  /*
   * Testanruf. Geht denselben Weg wie Lukas' ruf_an — inklusive der Pruefung,
   * ob die Nummer freigegeben ist. Ein Knopf, der die Sperre umgeht, die
   * dieselbe Seite verwaltet, waere keine Sperre.
   */
  const testanruf = async () => {
    setBusy(true);
    setFehler(null);
    setMeldung(null);
    try {
      const r = await api("/testanruf", {
        method: "POST",
        body: JSON.stringify({ nummer: eintrag.nummer }),
      });
      setMeldung(r.meldung ?? "Anruf ausgelöst.");
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(false);
    }
  };

  const loeschen = async () => {
    if (!confirm(`${eintrag.name || zeigeNummer(eintrag.nummer)} wirklich aus der Liste entfernen?`)) return;
    setBusy(true);
    try {
      await api(`/${eintrag.id}`, { method: "DELETE" });
      onChange();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Fehler");
      setBusy(false);
    }
  };

  return (
    <div className="card-soft rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{eintrag.name || "Ohne Namen"}</span>
            <span className={`rounded px-2 py-0.5 text-[0.65rem] tracking-wide ${STUFE[eintrag.stufe].cls}`}>
              {STUFE[eintrag.stufe].label}
            </span>
          </div>
          <div className="mt-1 font-mono text-sm text-muted-foreground">{zeigeNummer(eintrag.nummer)}</div>
          {eintrag.notiz && <div className="mt-1 text-sm text-muted-foreground">{eintrag.notiz}</div>}
        </div>
        <Button variant="ghost" size="icon" onClick={loeschen} disabled={busy} aria-label="Entfernen">
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(Object.keys(STUFE) as Stufe[]).map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => patch({ stufe: s })}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              eintrag.stufe === s ? STUFE[s].cls : "bg-secondary/50 text-muted-foreground hover:bg-secondary"
            }`}
          >
            {STUFE[s].label}
          </button>
        ))}

        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={eintrag.darfAngerufenWerden}
            disabled={busy}
            onChange={(e) => patch({ darfAngerufenWerden: e.target.checked })}
          />
          Lukas darf hier anrufen
        </label>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{STUFE[eintrag.stufe].hilfe}</p>

      {eintrag.darfAngerufenWerden && (
        <Button size="sm" variant="ghost" className="mt-3 px-0" disabled={busy} onClick={testanruf}>
          <PhoneOutgoing className="mr-2 size-4" /> Testanruf
        </Button>
      )}

      {meldung && <p className="mt-2 text-xs text-emerald-300">{meldung}</p>}
      {fehler && <p className="mt-2 text-xs text-red-400">{fehler}</p>}
    </div>
  );
}

/*
 * Twilio einrichten, ohne Kommandozeile.
 *
 * Die drei Schritte — Trunk, Origination, Nummer — macht der Server. Er hat
 * die Zugangsdaten als Umgebungsvariablen ohnehin; damit muessen sie weder in
 * ein Terminal noch in einen Chat.
 */
function Einrichtung({ onChange }: { onChange: () => void }) {
  const [stand, setStand] = useState<TwilioStand | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [schritte, setSchritte] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const laden = useCallback(async () => {
    try {
      setStand(await api("/twilio"));
      setFehler(null);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Twilio nicht erreichbar");
    }
  }, []);

  useEffect(() => {
    void laden();
  }, [laden]);

  const einrichten = async (nummer: string) => {
    setBusy(true);
    setFehler(null);
    setSchritte([]);
    try {
      const r = await api("/einrichten", { method: "POST", body: JSON.stringify({ nummer }) });
      setSchritte(r.schritte ?? []);
      await laden();
      onChange();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(false);
    }
  };

  if (fehler && !stand) {
    return (
      <div className="card-soft rounded-3xl p-5 text-sm">
        <p className="font-medium">Twilio</p>
        <p className="mt-1 text-muted-foreground">{fehler}</p>
      </div>
    );
  }
  if (!stand) return null;

  const fertig = stand.ziel !== null && stand.origination.includes(stand.ziel) && stand.amTrunk.length > 0;

  return (
    <div className="card-soft rounded-3xl p-5">
      <h2 className="flex items-center gap-2 font-medium">
        <PhoneIncoming className="size-4" /> Eingehende Anrufe
      </h2>

      {fertig ? (
        <p className="mt-2 text-sm text-emerald-300">
          Eingerichtet. Anrufe auf {stand.amTrunk.join(", ")} landen bei Lukas.
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Damit ein Anruf bei Lukas ankommt, muss die Nummer an einen Trunk hängen, der auf OpenAI
          zeigt. Ein Klick erledigt beides.
        </p>
      )}

      <div className="mt-4 space-y-2">
        {stand.nummern.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Im Twilio-Konto ist noch keine Nummer. Ohne Nummer kann dich niemand anrufen — Lukas
            kann dich aber trotzdem anrufen, sobald TWILIO_NUMMER gesetzt ist.
          </p>
        )}
        {stand.nummern.map((n) => {
          const dran = stand.amTrunk.includes(n.nummer);
          return (
            <div key={n.nummer} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-3.5 py-2.5">
              <span className="font-mono text-sm">{n.nummer}</span>
              {dran && <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[0.65rem] text-emerald-300">AM TRUNK</span>}
              <Button
                size="sm"
                variant={dran ? "ghost" : "default"}
                className="ml-auto"
                disabled={busy}
                onClick={() => einrichten(n.nummer)}
              >
                {dran ? "Erneut prüfen" : "Einrichten"}
              </Button>
            </div>
          );
        })}
      </div>

      {schritte.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {schritte.map((s) => (
            <li key={s}>· {s}</li>
          ))}
        </ul>
      )}
      {fehler && <p className="mt-3 text-sm text-red-400">{fehler}</p>}
      {stand.ziel && (
        <p className="mt-3 font-mono text-xs break-all text-muted-foreground">Ziel: {stand.ziel}</p>
      )}
    </div>
  );
}


type SmsZeile = {
  id: number;
  richtung: string;
  nummer: string;
  text: string;
  quelle: string;
  status: string;
  preis: string | null;
  createdAt: string;
};

/*
 * SMS.
 *
 * Steht hier und nicht auf einer eigenen Seite: es ist dieselbe Sache wie das
 * Telefon — eine Nummer, ein Kontakt, dieselbe Sperrliste. Wer hier tippt, ist
 * Issa selbst; was Lukas von sich aus schreibt, braucht eine Freigabe und
 * taucht danach in derselben Liste auf, erkennbar an der Quelle.
 */
function SmsBereich({ nummern }: { nummern: Nummer[] }) {
  const [an, setAn] = useState("");
  const [text, setText] = useState("");
  const [zeilen, setZeilen] = useState<SmsZeile[]>([]);
  const [bereit, setBereit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  const laden = useCallback(async () => {
    try {
      const antwort = await fetch(`${BASE}/api/lukas/sms`, { headers: authHeaders() });
      if (!antwort.ok) return;
      const daten = await antwort.json();
      setZeilen(daten.nachrichten ?? []);
      setBereit(Boolean(daten.bereit));
    } catch {
      /* Die Liste ist Beiwerk; ein Fehler hier darf das Feld nicht blockieren. */
    }
  }, []);

  useEffect(() => {
    void laden();
  }, [laden]);

  /*
   * Die Segmentzahl steht am Feld, nicht in einer Fußnote.
   *
   * 160 Zeichen sind eine SMS — aber ein einziges Emoji oder ein
   * typografischer Gedankenstrich schaltet auf Unicode, und dann sind es 70.
   * Wer das erst auf der Rechnung merkt, hat es zu spät gemerkt.
   */
  const GSM7 =
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà" +
    "^{}\\[~]|€";
  const unicode = [...text].some((z) => !GSM7.includes(z));
  const proTeil = unicode ? (text.length > 70 ? 67 : 70) : text.length > 160 ? 153 : 160;
  const teile = text.length === 0 ? 0 : Math.ceil(text.length / proTeil);

  const senden = async () => {
    if (!an.trim() || !text.trim()) return;
    setBusy(true);
    setFehler(null);
    setMeldung(null);
    try {
      const antwort = await fetch(`${BASE}/api/lukas/sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ an, text }),
      });
      const daten = await antwort.json();
      if (!antwort.ok) throw new Error(daten?.error ?? daten?.fehler ?? "SMS ging nicht raus");
      setMeldung(`Raus an ${daten.nummer}${daten.preis ? ` · ${daten.preis}` : ""}`);
      setText("");
      await laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "SMS ging nicht raus");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-soft p-4">
      <div className="mb-3 flex items-center gap-2">
        <MessageSquare className="size-4 text-primary" />
        <h2 className="font-medium">SMS schreiben</h2>
      </div>

      {!bereit && (
        <div className="mb-3 rounded-2xl bg-amber-400/10 p-3.5 text-sm ring-1 ring-amber-400/25">
          <p className="font-medium text-amber-200">Noch keine Zugangsdaten</p>
          <p className="mt-1 text-muted-foreground">
            Setz <code>CLICKSEND_USERNAME</code> und <code>CLICKSEND_API_KEY</code>, optional{" "}
            <code>CLICKSEND_ABSENDER</code> als sichtbaren Absender.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <input
          value={an}
          onChange={(e) => setAn(e.target.value)}
          list="bekannte-nummern"
          placeholder="+49…"
          className="h-10 w-full rounded-full bg-white/[0.05] px-4 font-mono text-sm outline-none transition-colors focus:bg-white/[0.08]"
        />
        {/* Die eingetragenen Kontakte als Vorschlag — Nummern tippt niemand gern ab. */}
        <datalist id="bekannte-nummern">
          {nummern.map((n) => (
            <option key={n.id} value={n.nummer}>
              {n.name || n.nummer}
            </option>
          ))}
        </datalist>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Kurz und direkt — eine SMS ist kein Brief."
          className="w-full resize-none rounded-2xl bg-white/[0.05] px-4 py-2.5 text-sm outline-none transition-colors focus:bg-white/[0.08]"
        />

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {text.length} Zeichen
            {teile > 0 && (
              <>
                {" · "}
                <span className={teile > 1 ? "text-amber-300" : ""}>
                  {teile} SMS
                </span>
                {unicode && <span className="text-amber-300"> · Unicode, nur 70 je Teil</span>}
              </>
            )}
          </span>
          <Button
            size="sm"
            className="ml-auto gap-2"
            disabled={busy || !an.trim() || !text.trim()}
            onClick={senden}
          >
            <Send className="size-4" />
            Senden
          </Button>
        </div>

        {fehler && <p className="text-sm text-red-400">{fehler}</p>}
        {meldung && <p className="text-sm text-emerald-400">{meldung}</p>}
      </div>

      {zeilen.length > 0 && (
        <div className="mt-4 space-y-1 border-t border-border pt-3">
          {zeilen.slice(0, 8).map((z) => (
            <div key={z.id} className="flex items-start gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-secondary/40">
              <span className="font-mono shrink-0">{zeigeNummer(z.nummer)}</span>
              <span className="truncate text-muted-foreground">{z.text}</span>
              <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {z.quelle === "lukas" && <span className="text-primary">von Lukas</span>}
                <span className={/success/i.test(z.status) ? "" : "text-amber-300"}>{z.status}</span>
                {new Date(z.createdAt).toLocaleString("de-DE")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Telefon() {
  const [daten, setDaten] = useState<Antwort | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neu, setNeu] = useState({ nummer: "", name: "", stufe: "privat" as Stufe });
  const [busy, setBusy] = useState(false);

  const laden = useCallback(async () => {
    try {
      const antwort = await api("");
      /*
       * `daten.bereit.webhook` und `daten.anrufe.length` greifen zwei Ebenen
       * tief. Fehlt eine davon — unerwartete Antwort, halbe Antwort, Proxy
       * dazwischen —, wirft der Zugriff und React raeumt die GANZE Seite ab:
       * schwarzer Bildschirm statt einer unvollstaendigen Liste. Beim
       * Durchsehen ist genau das passiert.
       */
      if (!antwort || typeof antwort !== "object" || !antwort.bereit) {
        throw new Error("unerwartete Antwort vom Server");
      }
      setDaten({ ...antwort, anrufe: Array.isArray(antwort.anrufe) ? antwort.anrufe : [] });
      setFehler(null);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Laden fehlgeschlagen");
    }
  }, []);

  useEffect(() => {
    void laden();
  }, [laden]);

  const hinzufuegen = async () => {
    if (!neu.nummer.trim()) return;
    setBusy(true);
    setFehler(null);
    try {
      await api("", { method: "POST", body: JSON.stringify(neu) });
      setNeu({ nummer: "", name: "", stufe: "privat" });
      await laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Seite
      icon={Phone}
      titel="Telefon"
      unterzeile="Wer mit Lukas sprechen darf — und wen er anrufen darf."
    >
      <div className="space-y-6">
          {/* Was noch fehlt, gehoert sichtbar hierher — sonst passiert schlicht nichts. */}
          {daten && !daten.bereit.webhook && (
            <div className="flex gap-3 rounded-3xl bg-amber-400/10 p-4 text-sm ring-1 ring-amber-400/25">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
              <div>
                <p className="font-medium text-amber-200">Anrufe kommen noch nicht an</p>
                <p className="mt-1 text-muted-foreground">
                  Es fehlt <code>OPENAI_WEBHOOK_SECRET</code>. Ohne geprüfte Signatur wird jeder
                  eingehende Anruf abgewiesen — das ist Absicht.
                </p>
              </div>
            </div>
          )}
          {daten && daten.bereit.webhook && !daten.bereit.anrufen && (
            <div className="card-soft rounded-3xl p-5 text-sm text-muted-foreground">
              Eingehende Anrufe funktionieren. Damit Lukas selbst anrufen kann, fehlen noch
              <code className="mx-1">TWILIO_ACCOUNT_SID</code>,<code className="mx-1">TWILIO_AUTH_TOKEN</code>,
              <code className="mx-1">TWILIO_NUMMER</code> und <code className="mx-1">OPENAI_PROJECT_ID</code>.
            </div>
          )}

          <Einrichtung onChange={laden} />

          <div className="card-soft rounded-3xl p-5">
            <h2 className="mb-3 flex items-center gap-2 font-medium">
              <Plus className="size-4" /> Nummer hinzufügen
            </h2>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={neu.nummer}
                onChange={(e) => setNeu({ ...neu, nummer: e.target.value })}
                placeholder="+49 151 12345678"
                className="h-10 flex-1 rounded-full bg-white/[0.05] px-4 text-sm outline-none transition-colors focus:bg-white/[0.08]"
              />
              <input
                value={neu.name}
                onChange={(e) => setNeu({ ...neu, name: e.target.value })}
                placeholder="Name"
                className="h-10 rounded-full bg-white/[0.05] px-4 text-sm outline-none transition-colors focus:bg-white/[0.08] sm:w-40"
              />
              <select
                value={neu.stufe}
                onChange={(e) => setNeu({ ...neu, stufe: e.target.value as Stufe })}
                className="h-10 rounded-full bg-white/[0.05] px-4 text-sm outline-none transition-colors focus:bg-white/[0.08]"
              >
                <option value="privat">Privat</option>
                <option value="oeffentlich">Öffentlich</option>
                <option value="gesperrt">Gesperrt</option>
              </select>
              <Button onClick={hinzufuegen} disabled={busy || !neu.nummer.trim()}>
                Hinzufügen
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Nicht eingetragene Nummern bekommen automatisch den öffentlichen Lukas — den von der
              Webseite, ohne alles Private.
            </p>
          </div>

          <SmsBereich nummern={daten?.nummern ?? []} />

          {fehler && <p className="text-sm text-red-400">{fehler}</p>}

          <div className="space-y-3">
            {daten?.nummern.map((n) => (
              <NummerZeile key={n.id} eintrag={n} onChange={laden} />
            ))}
            {daten?.nummern.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Noch keine Nummer eingetragen. Trag deine eigene als „Privat" ein, damit Lukas dich
                am Telefon erkennt.
              </p>
            )}
          </div>

          {daten && daten.anrufe.length > 0 && (
            <div>
              <h2 className="mb-3 font-medium">Letzte Anrufe</h2>
              <div className="space-y-1">
                {daten.anrufe.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-secondary/40">
                    {a.richtung === "eingehend" ? (
                      <PhoneIncoming className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <PhoneOutgoing className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="font-mono">{zeigeNummer(a.nummer)}</span>
                    <span className="text-muted-foreground">{a.ergebnis}</span>
                    {a.anlass && <span className="truncate text-muted-foreground">— {a.anlass}</span>}
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {new Date(a.createdAt).toLocaleString("de-DE")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
      </div>
    </Seite>
  );
}
