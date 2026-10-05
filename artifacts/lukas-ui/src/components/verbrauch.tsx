import { useCallback, useEffect, useState } from "react";

type Tokens = { aufrufe: number; eingabe: number; ausgabe: number; cacheLesen: number; cacheSchreiben: number; gesamt: number };
type Tag = Tokens & { tag: string; erfasst: boolean; liveSekunden: number; liveSitzungen: number; liveOhneMesswert: number; liveOffen: number };
type Bericht = {
  stand: string; tageswerte: Tag[];
  modelle: (Tokens & { provider: string; model: string; quelle: string })[];
  liveModelle: { model: string; quelle: string; sekunden: number; sitzungen: number; ohneMesswert: number; offen: number }[];
  guthaben: { usd: number; organisation: string; bestaetigtAt: string } | null;
};
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem("lukas_token") ?? ""}` });
const zahl = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 2 });
const quellen: Record<string, string> = { chat: "Chat", autonomie: "Autonome Arbeit", reflexion: "Reflexion", moltbook: "Moltbook", studio: "Studio", ausgabe: "Antwortpolitur", telefon: "Telefonie", sprache: "Sprachchat", portfolio: "Portfolio", sonstige: "Sonstige", unzugeordnet: "Ältere Daten ohne Zuordnung" };
export default function Verbrauch() {
  const [daten, setDaten] = useState<Bericht | null>(null);
  const [fehler, setFehler] = useState("");
  const [betrag, setBetrag] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [speichert, setSpeichert] = useState(false);
  const [meldung, setMeldung] = useState("");
  const laden = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/lukas/verbrauch`, { headers: headers() });
      if (!r.ok) throw new Error();
      const body = await r.json();
      if (!Array.isArray(body.tageswerte) || !Array.isArray(body.modelle) || !Array.isArray(body.liveModelle)) throw new Error();
      setDaten(body); setFehler("");
    } catch { setFehler("Verbrauch konnte nicht aktualisiert werden. Angezeigte Werte stammen vom letzten erfolgreichen Abruf."); }
  }, []);
  useEffect(() => { void laden(); const timer = setInterval(laden, 60000); return () => clearInterval(timer); }, [laden]);
  const speichern = async (e: React.FormEvent) => {
    e.preventDefault(); setMeldung("");
    const usd = Number(betrag.replace(",", "."));
    if (!betrag.trim() || !Number.isFinite(usd) || !organisation.trim()) { setMeldung("Bitte Betrag und Organisation angeben."); return; }
    setSpeichert(true);
    try {
      const r = await fetch(`${BASE}/api/lukas/openai-guthaben`, { method: "PUT", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ usd, organisation }) });
      if (!r.ok) throw new Error();
      setBetrag(""); setMeldung("Guthabenstand gespeichert."); await laden();
    } catch { setMeldung("Speichern fehlgeschlagen. Der bisherige Stand bleibt erhalten."); }
    finally { setSpeichert(false); }
  };
  const gesamt = daten?.tageswerte.reduce((s, t) => s + t.gesamt, 0) ?? 0;
  return <section className="space-y-4" aria-label="Verbrauch und OpenAI-Guthaben">
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Verbrauch im Detail</h2><button onClick={laden} className="rounded-full border px-4 py-2 text-sm">Aktualisieren</button></div>
    {fehler && <p role="alert" className="text-sm text-amber-400">{fehler}</p>}
    {!daten && !fehler && <p role="status">Verbrauch wird geladen …</p>}
    {daten && <>
      <div className="card-soft rounded-3xl p-5 space-y-2">
        <p className="text-sm text-muted-foreground">Erfasste Modell-Tokens · 14 UTC-Tage</p>
        <p className="text-3xl font-semibold tabular-nums">{zahl(gesamt)}</p>
        <p className="text-xs text-muted-foreground">Eingabe + Cache-Lesen + Cache-Schreiben + Ausgabe, jeweils einmal. Kein vollständiger Rechnungsabgleich. Stand: {new Date(daten.stand).toLocaleString("de-DE")}</p>
      </div>
      <div className="card-soft rounded-3xl p-5 space-y-3"><h3 className="font-medium">OpenAI-Guthaben</h3>
        <p className="text-2xl font-semibold">{daten.guthaben ? new Intl.NumberFormat("de-DE", {style:"currency",currency:"USD"}).format(daten.guthaben.usd) : "Noch kein bestätigter Stand"}</p>
        {daten.guthaben && <p className="text-xs text-muted-foreground">{daten.guthaben.organisation} · Manuell bestätigt am {new Date(daten.guthaben.bestaetigtAt).toLocaleString("de-DE")}</p>}
        <p className="text-sm text-muted-foreground">Gespeicherter Guthabenstand, keine Live-Abfrage. Nutzung, Aufladungen und abgelaufene Credits seit diesem Zeitpunkt sind nicht verrechnet.</p>
        <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer" className="inline-block text-sm underline">Aktuelles Guthaben bei OpenAI ansehen</a>
        <details><summary className="cursor-pointer text-sm">Guthabenstand übernehmen</summary><form onSubmit={speichern} className="mt-3 flex flex-col gap-3">
          <label className="text-sm">OpenAI-Organisation<input aria-label="OpenAI-Organisation" value={organisation} onChange={e=>setOrganisation(e.target.value)} maxLength={120} required className="mt-1 block w-full rounded-xl border bg-background p-3" /></label>
          <label className="text-sm">Guthaben in USD<input aria-label="Guthaben in USD" inputMode="decimal" value={betrag} onChange={e=>setBetrag(e.target.value)} required className="mt-1 block w-full rounded-xl border bg-background p-3" /></label>
          <button disabled={speichert} className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{speichert ? "Speichert …" : "Als aktuellen Stand speichern"}</button>
        </form></details>{meldung && <p role="status" className="text-sm">{meldung}</p>}
      </div>
      <details className="card-soft rounded-3xl p-5"><summary className="cursor-pointer font-medium">Verbrauch nach Tag</summary>
      <div className="grid gap-2 sm:grid-cols-2">
        {[...daten.tageswerte].reverse().map(t => <details key={t.tag} className="card-soft rounded-2xl p-4">
          <summary className="cursor-pointer text-sm"><span>{t.tag}</span><strong className="ml-3 tabular-nums">{t.erfasst ? `${zahl(t.gesamt)} Tokens` : "Keine Tokenmessung"}</strong></summary>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <dt>Modellaufrufe</dt><dd>{zahl(t.aufrufe)}</dd>
            <dt>Frische Eingabe</dt><dd>{t.erfasst ? zahl(t.eingabe) : "–"}</dd>
            <dt>Ausgabe inkl. Denken</dt><dd>{t.erfasst ? zahl(t.ausgabe) : "–"}</dd>
            <dt>Cache gelesen</dt><dd>{t.erfasst ? zahl(t.cacheLesen) : "–"}</dd>
            <dt>Cache geschrieben</dt><dd>{t.erfasst ? zahl(t.cacheSchreiben) : "–"}</dd>
            <dt>Live-Minuten gemeldet</dt><dd>{t.liveSitzungen ? zahl(t.liveSekunden / 60) : "–"}</dd>
          </dl>
          {!t.erfasst && <p className="mt-2 text-xs text-muted-foreground">Ohne Messdaten ist kein Nullverbrauch belegt.</p>}
          {(t.liveOhneMesswert > 0 || t.liveOffen > 0) && <p className="mt-2 text-xs text-amber-400">Live: {t.liveOhneMesswert} ohne Messwert, {t.liveOffen} ohne bestätigtes Ende. Werte können unvollständig sein.</p>}
        </details>)}
      </div>
      </details>
      <details className="card-soft rounded-3xl p-5" open><summary className="cursor-pointer font-medium">Nach Modell und Bereich</summary>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Modell / Bereich", "Aufrufe", "Eingabe", "Ausgabe", "Cache lesen", "Cache schreiben", "Gesamt"].map(h => <th key={h} className="p-2 whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>{daten.modelle.map(m => <tr key={`${m.provider}:${m.model}:${m.quelle}`} className="border-t border-white/10"><td className="p-2">{m.model}<div className="text-xs text-muted-foreground">{m.provider} · {quellen[m.quelle] ?? m.quelle}</div></td>{[m.aufrufe,m.eingabe,m.ausgabe,m.cacheLesen,m.cacheSchreiben,m.gesamt].map((v,i) => <td key={i} className="p-2 tabular-nums">{zahl(v)}</td>)}</tr>)}</tbody></table></div>
        {!daten.modelle.length && <p className="mt-2 text-sm text-muted-foreground">Keine Modellmessungen für diesen Zeitraum.</p>}
      </details>
      <div className="card-soft rounded-3xl p-5 space-y-2"><h3 className="font-medium">Sprache und Telefonie</h3>
        <p className="text-xs text-muted-foreground">GPT Live meldet Sekunden statt Tokens. Minuten werden dem UTC-Starttag der Sitzung zugeordnet. Backend-Delegationen stehen zusätzlich in der Modelltabelle. Telnyx-/ElevenLabs-Gebühren sind nicht enthalten; ältere Sitzungen wurden nicht nachträglich erfasst.</p>
        {daten.liveModelle.length ? daten.liveModelle.map(l => <p key={`${l.model}:${l.quelle}`} className="text-sm">{quellen[l.quelle] ?? l.quelle} · {l.model}: <strong>{zahl(l.sekunden / 60)} Minuten</strong> in {l.sitzungen} Sitzungen{l.ohneMesswert || l.offen ? ` (${l.ohneMesswert} ohne Messwert, ${l.offen} ohne bestätigtes Ende)` : ""}</p>) : <p className="text-sm text-muted-foreground">Noch keine Live-Sitzungen erfasst.</p>}
      </div>

    </>}
  </section>;
}
