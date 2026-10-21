import { useEffect, useState } from "react";

type Metrics = {
  fetchedAt: string;
  rangeDays: number;
  summary: { sessions: number; pageviews: number; avgScrollDepth: number; avgActiveSecondsPerSession: number };
  clicks: { target: string; clicks: number; sessions: number }[];
  forms?: { kind: string; starts: number; attempts: number; successes: number; errors: number; startedSessions: number; successSessions: number }[];
  funnel: { formStartSessions: number; formSubmitSessions: number; bookings: number };
};
const actions: Record<string, string> = { phone: "Anruf", email: "E-Mail", whatsapp: "WhatsApp", google_maps: "Google Maps" };
const positions: Record<string, string> = { hero: "Hero", header: "Header", menu: "Menü", footer: "Footer", content: "Seiteninhalt", contact: "Kontaktformular" };
const formLabels: Record<string, string> = { text: "Hero-Textanfrage", ride: "Fahrtanfrage", contact: "Unteres Kontaktformular", legacy: "Ältere Messung ohne Zuordnung" };
const buttons: Record<string, string> = { menu_open: "Menü öffnen", menu_close: "Menü schließen", booking_cta: "Fahrt buchen", services_nav: "Leistungen", faq_menu: "FAQ im Menü" };
export function clickLabel(target: string): string {
  if (buttons[target]) return buttons[target];
  if (actions[target]) return `${actions[target]} · Position unbekannt`;
  for (const key of Object.keys(actions)) {
    if (target.startsWith(key + "_")) return `${actions[key]} · ${positions[target.slice(key.length + 1)] ?? "Seiteninhalt"}`;
  }
  return target;
}
export default function TaxiWebsiteStats() {
  const [days, setDays] = useState(30);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {const timer=setInterval(()=>{if(document.visibilityState==='visible')setRefresh(v=>v+1)},15000);return()=>clearInterval(timer)}, []);
  useEffect(() => setData(null), [days]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    const token = localStorage.getItem("lukas_token");
    fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/lukas/taxibb/analytics?days=${days}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw Error("unavailable");
      const value = await response.json();
      if (!value.summary || !value.funnel || !Array.isArray(value.clicks) || !value.fetchedAt) throw Error("invalid data");
      if (!controller.signal.aborted) setData(value);
    }).catch(() => { if (!controller.signal.aborted) setError("TaxiBB-Messwerte konnten nicht geladen werden. Bitte erneut versuchen."); });
    return () => controller.abort();
  }, [days, refresh]);
  return <section className="card-soft rounded-3xl p-5" aria-labelledby="taxi-stats-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="taxi-stats-heading" className="font-semibold">TaxiBB Website</h2><p className="text-xs text-muted-foreground mt-1">Gespeicherte Anfragen und Website-Tracking</p></div>
      <div className="flex items-center gap-2">
        <select aria-label="TaxiBB Messzeitraum" value={days} onChange={e => setDays(Number(e.target.value))} className="rounded-xl border bg-background px-3 py-2 text-sm">
          {[7, 30, 90, 180].map(day => <option key={day} value={day}>Letzte {day} Tage</option>)}
        </select>
        <button onClick={() => setRefresh(v => v + 1)} className="rounded-xl border px-3 py-2 text-sm">Aktualisieren</button>
      </div>
    </div>
    {error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : !data ? <p role="status" className="mt-4 text-sm text-muted-foreground">Messwerte werden geladen …</p> : <>
      <div className="rounded-2xl border border-border/60 p-4 mt-5" aria-label="Gespeicherte Anfragen">
        <h3 className="text-sm font-medium">Eingegangene Hero-Anfragen</h3>
        <p className="text-3xl font-semibold tabular-nums mt-1">{data.funnel.bookings.toLocaleString("de-DE")}</p>
        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">Gespeicherte Fahrt- und Textanfragen aus dem Hero-Formular, unabhängig von der Tracking-Einwilligung. Testanfragen sind ausgeschlossen. Das untere Kontaktformular und direkt eingegangene E-Mails sind hier nicht enthalten. Diese Zahl bestätigt keine E-Mail-Zustellung.</p>
      </div>
      <h3 className="font-medium mt-6">Website-Tracking mit Einwilligung</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 my-5">
        {[["Erfasste Besuche", data.summary.sessions], ["Seitenaufrufe", data.summary.pageviews], ["Besuche mit Formularbeginn", data.funnel.formStartSessions], ["Besuche mit erfolgreicher Sendung", data.funnel.formSubmitSessions]].map(([label, value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-semibold tabular-nums">{Number(value).toLocaleString("de-DE")}</p></div>)}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">Ein Besuch mit mehreren Sendungen zählt oben einmal. Ohne Einwilligung, bei Do-Not-Track oder blockiertem Tracking fehlen die Ereignisse. Deshalb sind diese Zahlen keine vollständige Anzahl eingegangener Anfragen.</p>
      <h3 className="font-medium mt-6 mb-2">Erfasste Formularereignisse</h3>
      {data.forms?.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-muted-foreground text-xs"><th className="text-left py-2 pr-3 font-medium">Formular</th><th className="text-right px-2 font-medium">Begonnen</th><th className="text-right px-2 font-medium">Versuche</th><th className="text-right px-2 font-medium">Erfolgreich</th><th className="text-right font-medium">Fehler</th></tr></thead><tbody>{data.forms.map(row => <tr key={row.kind} className="border-t border-border/50"><td className="py-3 pr-3 min-w-36">{formLabels[row.kind] ?? row.kind}</td>{[row.starts, row.kind === "legacy" ? null : row.attempts, row.successes, row.kind === "legacy" ? null : row.errors].map((value, index) => <td key={index} className="text-right px-2 tabular-nums">{value === null ? "–" : value.toLocaleString("de-DE")}</td>)}</tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">Noch keine Formularereignisse im gewählten Zeitraum.</p>}
      <p className="text-xs text-muted-foreground mt-2 mb-6 leading-relaxed">Versuche und Ergebnisse zählen hier einzeln, nur mit Tracking-Einwilligung. „Erfolgreich“ bedeutet, dass der Server die Anfrage bestätigt hat; es ist weder eine Zusage für die Fahrt noch ein Nachweis der E-Mail-Zustellung. Fehler zählen fehlgeschlagene Übermittlungen. Ältere Messungen enthalten keine Versuche oder Fehler.</p>
      {data.clicks.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="text-left font-medium mb-2">Welche Buttons werden geklickt?</caption><thead><tr className="text-muted-foreground text-xs"><th className="text-left py-2 font-medium">Button / Position</th><th className="text-right px-2 font-medium">Klicks</th><th className="text-right font-medium">Besuche</th></tr></thead><tbody>{data.clicks.map(row => <tr key={row.target} className="border-t border-border/50"><td className="py-3 pr-2">{clickLabel(row.target)}</td><td className="text-right px-2 tabular-nums">{row.clicks.toLocaleString("de-DE")}</td><td className="text-right tabular-nums">{row.sessions.toLocaleString("de-DE")}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">Im gewählten Zeitraum wurden noch keine Buttonklicks erfasst.</p>}
      <p className="text-xs text-muted-foreground mt-4">Abruf: {new Date(data.fetchedAt).toLocaleString("de-DE")} · Zeitraum: letzte {data.rangeDays} Tage bis zum Abruf, kein Kalendermonat.</p>
    </>}
    <p className="text-xs text-muted-foreground mt-3 leading-relaxed">Besuche und Klicks werden nur nach Zustimmung erfasst. Anrufklicks sind keine bestätigten Telefonate. Mehrere Klicks eines Besuchs zählen einzeln; „Besuche“ zählt die zugehörigen Sitzungen. Ältere Klicks lassen sich nachträglich keiner Button-Position zuordnen.</p>
  </section>;
}
