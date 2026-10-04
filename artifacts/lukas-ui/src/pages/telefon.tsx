import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Phone, PhoneIncoming, PhoneOutgoing, Plus, Trash2, ShieldAlert, MessageSquare, Send, Search, Settings2, ChevronRight, AudioLines } from "lucide-react";
import { LiveMithoeren } from "@/components/telefon-mithoeren";
import { Seite } from "@/components/seite";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Stufe = "privat" | "oeffentlich" | "gesperrt";

type Nummer = {
  id: number;
  nummer: string;
  name: string;
  stufe: Stufe;
  darfAngerufenWerden: boolean;
  mithoerenZustimmung: boolean;
  mithoerenQuelle: string;
  mithoerenBestaetigtAm: string | null;
  aufnahmeZustimmung: boolean;
  aufnahmeQuelle: string;
  aufnahmeBestaetigtAm: string | null;
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
  detail?: string;
  dauer?: number | null;
  mithoerenZustimmung?: boolean;
  aufnahmeStatus?: string;
  aufnahmeDauer?: number | null;
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
  anbieter?: "twilio" | "telnyx";
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

function AufnahmeZustimmung({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return <label className="mt-3 flex flex-col gap-1 text-sm">
    <span>Zustimmung zur Gesprächsaufzeichnung</span>
    <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)}
      className="h-10 w-full min-w-0 rounded-xl bg-secondary px-3 text-sm">
      <option value="">Keine Zustimmung hinterlegt</option>
      <option value="email">Ja, per E-Mail</option>
      <option value="homepage">Ja, über die Homepage</option>
      <option value="bestaetigt">Ja, anderweitig bestätigt</option>
    </select>
    <span className="text-xs text-muted-foreground">Bei vorliegender Zustimmung werden ausgehende Telnyx-Gespräche ohne erneute Ansage aufgezeichnet.</span>
  </label>;
}

function MithoerenZustimmung({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return <label className="mt-3 flex flex-col gap-1 text-sm">
    <span>Schriftliche Zustimmung zum Live-Mithören</span>
    <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)} className="h-10 w-full min-w-0 rounded-xl bg-secondary px-3 text-sm">
      <option value="">Keine Zustimmung hinterlegt</option>
      <option value="email">Ja, schriftlich per E-Mail</option>
      <option value="homepage">Ja, schriftlich über die Homepage</option>
      <option value="schriftlich">Ja, anderweitig schriftlich</option>
    </select>
    <span className="text-xs text-muted-foreground">Gilt für künftige ausgehende Telnyx-Anrufe. Beide Gesprächsseiten live hören, ohne Mikrofon. Unabhängig von der Aufzeichnung.</span>
  </label>;
}

function Aufnahme({ anruf }: { anruf: Anruf }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState("");
  useEffect(() => {
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  const laden = async () => {
    setBusy(true); setFehler("");
    try {
      const res = await fetch(`${BASE}/api/lukas/telefon/anrufe/${anruf.id}/aufnahme`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Aufnahme konnte nicht geladen werden.");
      setBlob(await res.blob());
    } catch (err) { setFehler(err instanceof Error ? err.message : "Fehler"); }
    finally { setBusy(false); }
  };
  if (!anruf.aufnahmeStatus || anruf.aufnahmeStatus === "aus") return null;
  if (anruf.aufnahmeStatus !== "completed") return <p className="text-xs text-muted-foreground">
    {{ angefordert: "Aufnahme angefordert – noch nicht bestätigt", "in-progress": "Aufzeichnung läuft", absent: "Keine Aufnahme verfügbar" }[anruf.aufnahmeStatus] ?? "Aufnahmestatus unbekannt"}
  </p>;
  return <div className="w-full space-y-2">
    {url ? <>
      <audio controls src={url} className="h-10 w-full" aria-label="Gesprächsaufzeichnung" />
      <a href={url} download={`anruf-${anruf.id}.${blob?.type.includes("wav") ? "wav" : "mp3"}`} className="text-xs text-primary underline">Aufnahme herunterladen</a>
    </> : <Button variant="secondary" size="sm" disabled={busy} onClick={laden}>{busy ? "Aufnahme lädt …" : "Aufnahme anhören"}{anruf.aufnahmeDauer != null ? ` · ${anruf.aufnahmeDauer}s` : ""}</Button>}
    {fehler && <p role="alert" className="text-xs text-red-400">{fehler}</p>}
  </div>;
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

  return <article className="card-soft rounded-2xl p-4">
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary">{(eintrag.name || "?").slice(0, 1).toLocaleUpperCase("de")}</span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-medium">{eintrag.name || "Ohne Namen"}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{zeigeNummer(eintrag.nummer)}</p>
      </div>
      {eintrag.darfAngerufenWerden && eintrag.stufe !== "gesperrt" && <Button size="sm" variant="secondary" disabled={busy} onClick={testanruf} className="h-11 shrink-0 gap-2" aria-label={`Testanruf bei ${eintrag.name || zeigeNummer(eintrag.nummer)}`}><PhoneOutgoing className="size-4" /><span className="hidden sm:inline">Testanruf</span></Button>}
    </div>
    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
      <span className={`rounded-full px-2 py-1 ${STUFE[eintrag.stufe].cls}`}>{({ privat: "Privat", oeffentlich: "Öffentlich", gesperrt: "Gesperrt" })[eintrag.stufe]}</span>
      {eintrag.aufnahmeZustimmung && <span className="rounded-full bg-secondary/60 px-2 py-1">Aufnahme erlaubt</span>}
      {eintrag.mithoerenZustimmung && <span className="rounded-full bg-secondary/60 px-2 py-1">Mithören erlaubt</span>}
    </div>
    <details className="group mt-1">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">Kontakt bearbeiten <ChevronRight className="size-4 transition-transform group-open:rotate-90" /></summary>
      {eintrag.notiz && <p className="break-words text-sm text-muted-foreground">{eintrag.notiz}</p>}
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
      <MithoerenZustimmung value={eintrag.mithoerenZustimmung ? eintrag.mithoerenQuelle || "schriftlich" : ""} disabled={busy}
        onChange={quelle => patch({ mithoerenZustimmung: Boolean(quelle), mithoerenQuelle: quelle })} />
      <AufnahmeZustimmung value={eintrag.aufnahmeZustimmung ? eintrag.aufnahmeQuelle || "bestaetigt" : ""} disabled={busy}
        onChange={quelle => patch({ aufnahmeZustimmung: Boolean(quelle), aufnahmeQuelle: quelle })} />
      {eintrag.aufnahmeZustimmung && eintrag.aufnahmeBestaetigtAm && <p className="mt-1 text-xs text-muted-foreground">
        Hinterlegt am {new Date(eintrag.aufnahmeBestaetigtAm).toLocaleDateString("de-DE")}
      </p>}


      <Button variant="ghost" size="sm" onClick={loeschen} disabled={busy} className="mt-3 gap-2 text-red-300"><Trash2 className="size-4" /> Kontakt entfernen</Button>
    </details>
    {meldung && <p role="status" className="mt-2 text-xs text-emerald-300">{meldung}</p>}
    {fehler && <p role="alert" className="mt-2 text-xs text-red-400">{fehler}</p>}
  </article>;
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
    const timer = setInterval(() => { if (document.visibilityState === "visible") void laden(); }, 4000);
    return () => clearInterval(timer);
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


type TelnyxStatus = {
  nummer: string; status: string; verbunden: boolean; konfiguriert: boolean;
  freigeschaltet: boolean; bereit: boolean; hinweis: string;
};

function TelnyxEinrichtung() {
  const [stand, setStand] = useState<TelnyxStatus | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const laden = useCallback(async () => {
    setBusy(true);
    try { setStand(await api("/telnyx")); setFehler(null); }
    catch (err) { setFehler(err instanceof Error ? err.message : "Telnyx nicht erreichbar"); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void laden(); }, [laden]);
  return <div className="card-soft rounded-3xl p-5 space-y-3">
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-medium"><Phone className="size-4" /> Telnyx · Ein- und ausgehende Anrufe</h2>
      <Button size="sm" variant="outline" disabled={busy} onClick={laden}>{busy ? "Prüft…" : "Status prüfen"}</Button>
    </div>
    {stand && <>
      <p className="font-mono text-sm">{stand.nummer}</p>
      <p className={stand.bereit ? "text-sm text-emerald-300" : "text-sm text-amber-300"}>{stand.hinweis}</p>
      <p className="text-sm text-muted-foreground">Technik: {stand.konfiguriert ? "eingerichtet" : "unvollständig"} · Rufnummer: {stand.freigeschaltet ? "aktiv" : "Freischaltung ausstehend"}</p>
      {!stand.freigeschaltet && <a className="inline-block text-sm underline" href="https://portal.telnyx.com/" target="_blank" rel="noreferrer">Rufnummer in Telnyx freischalten</a>}
    </>}
    {fehler && <p role="alert" className="text-sm text-red-400">{fehler}</p>}
  </div>;
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
  const leererKontakt = { nummer: "", name: "", stufe: "oeffentlich" as Stufe, darfAngerufenWerden: false, aufnahmeZustimmung: false, aufnahmeQuelle: "", mithoerenZustimmung: false, mithoerenQuelle: "" };
  const [neu, setNeu] = useState(leererKontakt);
  const [busy, setBusy] = useState(false);
  const [bereich, setBereich] = useState("kontakte");
  const [suche, setSuche] = useState("");
  const [sichtbar, setSichtbar] = useState(8);
  const [dialog, setDialog] = useState<"kontakt" | "sms" | "einrichtung" | null>(null);
  const navigation = useRef<HTMLDivElement>(null);

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
      setDaten({ ...antwort, nummern: Array.isArray(antwort.nummern) ? antwort.nummern : [], anrufe: Array.isArray(antwort.anrufe) ? antwort.anrufe : [] });
      setFehler(null);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Laden fehlgeschlagen");
    }
  }, []);

  useEffect(() => {
    void laden();
    const timer = window.setInterval(() => { if (!document.hidden) void laden(); }, 4000);
    return () => window.clearInterval(timer);
  }, [laden]);

  const hinzufuegen = async () => {
    if (!neu.nummer.trim()) return;
    setBusy(true);
    setFehler(null);
    try {
      await api("", { method: "POST", body: JSON.stringify(neu) });
      setNeu(leererKontakt);
      setDialog(null);
      setSuche("");
      setBereich("kontakte");
      await laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(false);
    }
  };

  const wechsel = (value: string) => {
    setBereich(value); setSuche(""); setSichtbar(8);
    navigation.current?.closest(".overflow-y-auto")?.scrollTo?.({ top: 0 });
  };
  const kontakte = daten?.nummern ?? [];
  const nameFuer = (a: Anruf) => kontakte.find(n => n.nummer === a.nummer)?.name || zeigeNummer(a.nummer);
  const passt = (name: string, nummer: string) => !suche.trim() || name.toLocaleLowerCase("de").includes(suche.trim().toLocaleLowerCase("de")) || nummer.includes(suche.replace(/[^0-9]/g, "")) && /[0-9]/.test(suche);
  const kontaktListe = kontakte.filter(n => passt(n.name, n.nummer));
  const aktiv = (a: Anruf) => ["gewaehlt", "klingelt", "angenommen", "verbunden"].includes(a.ergebnis);
  const laufend = (daten?.anrufe ?? []).filter(aktiv);
  const vergangen = (daten?.anrufe ?? []).filter(a => !aktiv(a) && passt(nameFuer(a), a.nummer));
  const aufnahmen = (daten?.anrufe ?? []).filter(a => a.aufnahmeStatus === "completed");
  const aufnahmeListe = aufnahmen.filter(a => passt(nameFuer(a), a.nummer));
  const anrufKarte = (a: Anruf, live = false, recordingOnly = false) => <article key={a.id} className={`card-soft space-y-3 rounded-2xl p-4 ${live ? "ring-1 ring-primary/35" : ""}`}>
    <div className="flex items-start gap-3">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${live ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}>
        {recordingOnly ? <AudioLines className="size-4" /> : a.richtung === "eingehend" ? <PhoneIncoming className="size-4" /> : <PhoneOutgoing className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-medium">{nameFuer(a)}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{({ gewaehlt: "Gestartet", klingelt: "Klingelt", angenommen: "Angenommen", verbunden: "Mit Lukas verbunden", beendet: "Beendet", besetzt: "Besetzt", keine_antwort: "Keine Antwort", fehlgeschlagen: "Fehlgeschlagen", abgebrochen: "Abgebrochen", verbindungsfehler: "Verbindung fehlgeschlagen" } as Record<string, string>)[a.ergebnis] ?? a.ergebnis}{a.dauer != null ? ` · ${a.dauer}s` : ""}</p>
      </div>
      <time className="shrink-0 text-right text-[11px] text-muted-foreground" dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}<br />{new Date(a.createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</time>
    </div>
    {a.anlass && <p className="line-clamp-2 break-words text-xs text-muted-foreground">{a.anlass}</p>}
    {live && daten?.anbieter === "telnyx" && <LiveMithoeren id={a.id} zustimmung={a.mithoerenZustimmung === true} aktiv={a.richtung === "ausgehend"} />}
    {a.detail && /^(Mailbox erkannt|Nach Verabschiedung)/.test(a.detail) && <p className="text-xs text-muted-foreground">{a.detail}</p>}
    <Aufnahme anruf={a} />
  </article>;
  const mehr = (gesamt: number) => gesamt > sichtbar && <Button variant="outline" className="h-11 w-full" onClick={() => setSichtbar(n => n + 8)}>Weitere anzeigen · {gesamt - sichtbar}</Button>;
  const leer = (text: string) => <p className="rounded-2xl bg-secondary/30 px-5 py-8 text-center text-sm text-muted-foreground">{text}</p>;

  return <Seite icon={Phone} titel="Telefon" unterzeile="Kontakte, Gespräche und Aufnahmen."
    aktionen={<><Button variant="ghost" size="sm" className="h-10 gap-2" onClick={() => setDialog("sms")}><MessageSquare className="size-4" /> SMS</Button><Button variant="ghost" size="sm" className="h-10 gap-2" onClick={() => setDialog("einrichtung")}><Settings2 className="size-4" /> Einrichtung</Button></>}>
    <Tabs value={bereich} onValueChange={wechsel} className="space-y-4">
      <div ref={navigation} className="sticky top-0 z-10 space-y-3 bg-background/95 pb-3 pt-1 backdrop-blur-xl">
        <TabsList aria-label="Telefonbereiche" className="grid h-auto w-full grid-cols-3 rounded-2xl p-1">
          <TabsTrigger value="kontakte" className="min-h-11 gap-1.5 rounded-xl px-1 text-xs sm:text-sm">Kontakte <span className="text-[10px] opacity-60">{kontakte.length}</span></TabsTrigger>
          <TabsTrigger value="anrufe" className="min-h-11 gap-1.5 rounded-xl px-1 text-xs sm:text-sm">Anrufe {laufend.length > 0 && <span className="size-1.5 rounded-full bg-emerald-400" />}</TabsTrigger>
          <TabsTrigger value="aufnahmen" className="min-h-11 gap-1.5 rounded-xl px-1 text-xs sm:text-sm">Aufnahmen <span className="text-[10px] opacity-60">{aufnahmen.length}</span></TabsTrigger>
        </TabsList>
        {laufend.length > 0 && bereich !== "anrufe" && <button onClick={() => wechsel("anrufe")} className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-primary/10 px-3 text-left text-xs text-primary"><span className="size-2 shrink-0 rounded-full bg-emerald-400" /><span className="min-w-0 flex-1 truncate">{laufend.length === 1 ? `${nameFuer(laufend[0])} · Anruf läuft` : `${laufend.length} Anrufe laufen`}</span><span className="shrink-0">Zum Gespräch →</span></button>}
        <label className="flex h-11 items-center gap-2 rounded-xl bg-secondary/60 px-3 text-muted-foreground">
          <Search className="size-4 shrink-0" /><input aria-label="Kontakte oder Anrufe suchen" type="search" value={suche} onChange={e => { setSuche(e.target.value); setSichtbar(8); }} placeholder={bereich === "kontakte" ? "Name oder Rufnummer suchen" : "Nach Kontakt suchen"} className="w-full min-w-0 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground" />
        </label>
      </div>
      {fehler && <p role="alert" className="text-sm text-red-400">{fehler}</p>}
      {!daten && !fehler && <p className="py-8 text-center text-sm text-muted-foreground">Telefon wird geladen …</p>}
      {daten && (!daten.bereit.webhook || !daten.bereit.anrufen) && <button onClick={() => setDialog("einrichtung")} className="flex w-full items-center gap-2 rounded-xl bg-amber-400/10 p-3 text-left text-sm text-amber-200"><ShieldAlert className="size-4 shrink-0" /> Telefonie noch nicht vollständig eingerichtet <ChevronRight className="ml-auto size-4 shrink-0" /></button>}
      <TabsContent value="kontakte" forceMount hidden={bereich !== "kontakte"} className="space-y-3">
        <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-medium">Deine Kontakte</h2><Button size="sm" className="h-11 gap-1.5" onClick={() => setDialog("kontakt")}><Plus className="size-4" /> Kontakt hinzufügen</Button></div>
        {kontaktListe.slice(0, sichtbar).map(n => <NummerZeile key={n.id} eintrag={n} onChange={laden} />)}
        {daten && !kontaktListe.length && leer(suche ? "Kein Kontakt passt zu deiner Suche." : "Noch keine Kontakte. Füge deinen ersten Kontakt hinzu.")}
        {mehr(kontaktListe.length)}
      </TabsContent>
      <TabsContent value="anrufe" forceMount hidden={bereich !== "anrufe"} className="space-y-4">
        {laufend.length > 0 && <section aria-label="Laufende Anrufe" className="space-y-3"><h2 className="text-sm font-medium">Jetzt im Gespräch</h2>{laufend.map(a => anrufKarte(a, true))}</section>}
        <section aria-label="Letzte Anrufe" className="space-y-3"><h2 className="text-sm font-medium">Letzte Anrufe</h2>{vergangen.slice(0, sichtbar).map(a => anrufKarte(a))}{daten && !vergangen.length && leer(suche ? "Kein Anruf passt zu deiner Suche." : "Hier erscheinen deine abgeschlossenen Anrufe.")}{mehr(vergangen.length)}</section>
      </TabsContent>
      <TabsContent value="aufnahmen" forceMount hidden={bereich !== "aufnahmen"} className="space-y-3">
        <h2 className="text-sm font-medium">Gesprächsaufnahmen</h2>
        {aufnahmeListe.slice(0, sichtbar).map(a => anrufKarte(a, false, true))}
        {daten && !aufnahmeListe.length && leer(suche ? "Keine Aufnahme passt zu deiner Suche." : "Noch keine fertigen Aufnahmen bei den letzten Anrufen.")}
        {mehr(aufnahmeListe.length)}
      </TabsContent>
    </Tabs>
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null); }}>
      <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-3xl p-5 sm:max-w-xl">
        <DialogHeader className="pr-6 text-left"><DialogTitle>{dialog === "kontakt" ? "Kontakt hinzufügen" : dialog === "sms" ? "Nachrichten" : "Telefon einrichten"}</DialogTitle><DialogDescription>{dialog === "kontakt" ? "Name, Rufnummer und Freigaben für diesen Kontakt." : dialog === "sms" ? "SMS schreiben und letzte Nachrichten sehen." : "Verbindung und Rufnummer verwalten."}</DialogDescription></DialogHeader>
        {dialog === "kontakt" && <div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                aria-label="Telefonnummer"
                value={neu.nummer}
                onChange={(e) => setNeu({ ...neu, nummer: e.target.value })}
                placeholder="+49 151 12345678"
                className="h-11 min-w-0 w-full rounded-full bg-white/[0.05] px-4 text-base outline-none transition-colors focus:bg-white/[0.08] sm:w-auto sm:flex-1"
              />
              <input
                aria-label="Kontaktname"
                value={neu.name}
                onChange={(e) => setNeu({ ...neu, name: e.target.value })}
                placeholder="Name"
                className="h-11 rounded-full bg-white/[0.05] px-4 text-base outline-none transition-colors focus:bg-white/[0.08] sm:w-40"
              />
              <select
                aria-label="Zugriff des neuen Kontakts"
                value={neu.stufe}
                onChange={(e) => setNeu({ ...neu, stufe: e.target.value as Stufe })}
                className="h-11 rounded-full bg-white/[0.05] px-4 text-base outline-none transition-colors focus:bg-white/[0.08]"
              >
                <option value="privat">Privat</option>
                <option value="oeffentlich">Öffentlich</option>
                <option value="gesperrt">Gesperrt</option>
              </select>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={neu.darfAngerufenWerden} disabled={busy}
                onChange={e => setNeu({ ...neu, darfAngerufenWerden: e.target.checked })} />
              Lukas darf diesen Kontakt anrufen
            </label>
            <MithoerenZustimmung value={neu.mithoerenQuelle} disabled={busy}
              onChange={quelle => setNeu({ ...neu, mithoerenZustimmung: Boolean(quelle), mithoerenQuelle: quelle })} />
            <AufnahmeZustimmung value={neu.aufnahmeQuelle} disabled={busy}
              onChange={quelle => setNeu({ ...neu, aufnahmeZustimmung: Boolean(quelle), aufnahmeQuelle: quelle })} />
            <Button className="mt-4" onClick={hinzufuegen} disabled={busy || !neu.nummer.trim()}>
              Hinzufügen
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Du kannst anschließend im Chat sagen: „Rufe {neu.name.trim() || "Kontaktname"} an.“
            </p>
          {fehler && <p role="alert" className="mt-3 text-sm text-red-400">{fehler}</p>}
        </div>}
        {dialog === "sms" && <SmsBereich nummern={kontakte} />}
        {dialog === "einrichtung" && <div className="space-y-4">
          {daten?.anbieter === "telnyx" ? <TelnyxEinrichtung /> : daten && <Einrichtung onChange={laden} />}
          <details className="rounded-2xl bg-secondary/40 p-4 text-sm"><summary className="cursor-pointer">Technische Hinweise</summary><p className="mt-3 break-words text-xs text-muted-foreground">Für GPT Live muss der OpenAI-Webhook das Ereignis <code>live.transport.incoming</code> an <code>/api/telefon/eingehend</code> zustellen. Ein hinterlegter Signaturschlüssel bestätigt noch nicht, dass das Ereignis aktiviert ist.</p>{daten && !daten.bereit.webhook && <p className="mt-2 text-amber-200">Der Signaturschlüssel für eingehende Anrufe fehlt.</p>}</details>
        </div>}
      </DialogContent>
    </Dialog>
  </Seite>;
}
