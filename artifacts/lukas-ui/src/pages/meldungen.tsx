import { useCallback, useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Inbox, AlertTriangle, Check, Loader2, Send } from "lucide-react";
import { Seite, Chip, Leer, Laedt, staffel } from "@/components/seite";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Meldung = {
  id: number;
  betreff: string;
  text: string;
  dringend: boolean;
  status: "offen" | "erledigt";
  antwort: string | null;
  createdAt: string;
  erledigtAt: string | null;
  geprueftAt?: string | null;
  veraltet?: boolean;
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("lukas_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/*
 * Was Lukas von Issa braucht.
 *
 * Bewusst eine eigene Seite und kein Chat-Verlauf: eine Meldung hat einen
 * Zustand. Sie ist OFFEN, bis Issa geantwortet hat — und genau das soll man
 * sehen, ohne zu suchen. Im Chat ginge sie zwischen den Nachrichten unter.
 *
 * Die Antwort ist Pflicht und nicht Zierde: sie geht an Lukas zurueck und ist
 * der Grund, warum er wieder weiterarbeiten kann. Deshalb steht das Feld direkt
 * an der offenen Meldung und nicht hinter einem Klick.
 */
export default function Meldungen() {
  const [rows, setRows] = useState<Meldung[]>([]);
  const [laedt, setLaedt] = useState(true);
  const [entwuerfe, setEntwuerfe] = useState<Record<number, string>>({});
  const [mergeZiele, setMergeZiele] = useState<Record<number, string>>({});
  const [fehler, setFehler] = useState("");
  const [alteZeigen, setAlteZeigen] = useState(false);
  const [sendet, setSendet] = useState<number | null>(null);

  const laden = useCallback(() => {
    fetch(`${BASE}/api/lukas/meldungen`, { headers: authHeaders() })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: Meldung[]) => { setRows(Array.isArray(d) ? d : []); setFehler(""); })
      .catch(() => setFehler("Meldungen konnten nicht aktualisiert werden."))
      .finally(() => setLaedt(false));
  }, []);

  useEffect(() => {
    laden();
    // Er meldet sich auch, während man hinsieht — alle 30 Sekunden nachfassen.
    const t = setInterval(laden, 30000);
    return () => clearInterval(t);
  }, [laden]);

  const antworten = async (id: number, erledigen = false) => {
    const antwort = erledigen ? "Von Issa als erledigt bestätigt." : (entwuerfe[id] ?? "").trim();
    if (!antwort) return;
    setSendet(id);
    try {
      const response = await fetch(`${BASE}/api/lukas/meldungen/${id}/antwort`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ antwort }),
      });
      if (!response.ok) throw new Error();
      setEntwuerfe((v) => ({ ...v, [id]: "" }));
      laden();
    } catch { setFehler("Antwort konnte nicht gespeichert werden. Dein Entwurf bleibt erhalten."); } finally {
      setSendet(null);
    }
  };

  const bestaetigen = async (id: number) => {
    setSendet(id);
    try {
      const r = await fetch(`${BASE}/api/lukas/meldungen/${id}/bestaetigen`, {method: "POST", headers: authHeaders()});
      if (!r.ok) throw new Error();
      laden();
    } catch { setFehler("Meldung konnte nicht bestätigt werden."); }
    finally { setSendet(null); }
  };
  const zusammenfassen = async (id: number) => {
    setSendet(id);
    try {
      const r = await fetch(`${BASE}/api/lukas/meldungen/${id}/zusammenfassen`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ zielId: Number(mergeZiele[id]) }) });
      if (!r.ok) throw new Error();
      laden();
    } catch { setFehler("Meldungen konnten nicht zusammengefasst werden."); }
    finally { setSendet(null); }
  };
  const offen = rows.filter((m) => m.status === "offen");
  const alt = offen.filter(m => m.veraltet);
  const sichtbar = offen.filter(m => !m.veraltet || alteZeigen);
  const erledigt = rows.filter((m) => m.status !== "offen");

  return (
    <Seite
      icon={Inbox}
      titel="Meldungen"
      unterzeile="Was Lukas von dir braucht, um weiterzuarbeiten."
      aktionen={
        <Chip ton={offen.length > 0 ? "warnung" : "neutral"}>
          {offen.length > 0 ? `${offen.length} offen` : "nichts offen"}
        </Chip>
      }
    >
      <div className="space-y-9">
        {laedt && <Laedt />}
        {fehler && <p role="alert" className="text-sm text-amber-400">{fehler}</p>}
        {alt.length > 0 && <div className="card-soft rounded-3xl p-4 text-sm space-y-2"><p>{alt.length} ältere Meldung(en) ohne aktuelle Bestätigung. Sie bleiben offen, gelten aber nicht automatisch als aktuelle Störung.</p><button onClick={() => setAlteZeigen(v => !v)} className="underline">{alteZeigen ? "Ältere Meldungen einklappen" : "Ältere Meldungen prüfen"}</button></div>}

        {!laedt && !fehler && rows.length === 0 && (
          <Leer
            icon={Inbox}
            titel="Lukas hat sich noch nicht gemeldet"
            hinweis="Hier landet, was er von dir braucht, um weiterzukommen — eine Entscheidung, ein Zugang, eine Antwort."
          />
        )}

        {offen.length > 0 && (
          <section className="space-y-3">
            <h2 className="px-1 text-[11px] tracking-wide text-muted-foreground">
              Wartet auf dich ({offen.length})
            </h2>
            {sichtbar.map((m, i) => (
              <div
                key={m.id}
                className={`card-soft rise space-y-3 rounded-3xl p-5 ${
                  m.dringend ? "ring-1 ring-amber-400/30" : ""
                }`}
                style={{ animationDelay: `${staffel(i)}ms` }}
              >
                <div className="space-y-1">
                  <div className="font-medium flex items-start gap-2">
                    {m.dringend && (
                      <AlertTriangle
                        className="w-4 h-4 text-amber-400 shrink-0 mt-1"
                        aria-label="dringend"
                      />
                    )}
                    {/* Kein truncate: der Betreff ist die wichtigste Zeile der
                        ganzen Seite und darf umbrechen statt zu verschwinden. */}
                    <span className="text-pretty">{m.betreff}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true, locale: de })}
                  </div>
                </div>

                {m.veraltet && <p className="text-xs text-amber-400">Aktualität ungeprüft</p>}
                {m.geprueftAt && <p className="text-xs text-muted-foreground">Von dir bestätigt: {new Date(m.geprueftAt).toLocaleString("de-DE")}</p>}
                <div className="flex flex-wrap gap-3 text-sm"><button disabled={sendet === m.id} onClick={() => bestaetigen(m.id)} className="rounded-full border px-3 py-2">Weiterhin aktuell</button><button disabled={sendet === m.id} onClick={() => antworten(m.id, true)} className="rounded-full border px-3 py-2">Als erledigt markieren</button></div>
                {offen.length > 1 && <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Doppelte Meldung zuordnen</summary><div className="mt-2 space-y-2"><p className="text-xs text-muted-foreground">Der Inhalt wird an die gewählte Meldung angehängt; das Anliegen bleibt dort offen.</p><select aria-label={`Zusammenführen: ${m.betreff}`} className="w-full rounded-xl border bg-background p-2" value={mergeZiele[m.id] ?? ""} onChange={e => setMergeZiele(v => ({ ...v, [m.id]: e.target.value }))}><option value="">Offene Zielmeldung wählen</option>{offen.filter(z => z.id !== m.id).map(z => <option value={z.id} key={z.id}>{z.betreff}</option>)}</select><button disabled={!mergeZiele[m.id] || sendet === m.id} onClick={() => zusammenfassen(m.id)} className="rounded-full border px-3 py-2 disabled:opacity-40">In gewählte Meldung zusammenführen</button></div></details>}
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-pretty">{m.text}</p>

                <div className="space-y-2 pt-1">
                  <Textarea
                    value={entwuerfe[m.id] ?? ""}
                    onChange={(e) => setEntwuerfe((v) => ({ ...v, [m.id]: e.target.value }))}
                    placeholder="Deine Antwort — ein Satz reicht meistens."
                    className="min-h-[80px] resize-none rounded-2xl border-0 bg-white/[0.05] text-sm"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => antworten(m.id)}
                      disabled={!(entwuerfe[m.id] ?? "").trim() || sendet === m.id}
                      className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100"
                    >
                      {sendet === m.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Antworten
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}

        {erledigt.length > 0 && (
          <section className="space-y-3">
            <h2 className="px-1 text-[11px] tracking-wide text-muted-foreground">Erledigt</h2>
            {erledigt.map((m) => (
              <div key={m.id} className="card-soft space-y-2 rounded-3xl p-4 opacity-80">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium flex items-start gap-2 min-w-0">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-1" />
                    <span className="text-pretty">{m.betreff}</span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {m.erledigtAt
                      ? formatDistanceToNow(new Date(m.erledigtAt), { addSuffix: true, locale: de })
                      : ""}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{m.text}</p>
                {m.antwort && (
                  <div className="rounded-2xl bg-primary/10 px-3.5 py-2.5 text-sm whitespace-pre-wrap">
                    <span className="text-xs text-muted-foreground block mb-0.5">{m.antwort.startsWith("Zusammengeführt in Meldung #") ? "Zusammenführung" : "Deine Antwort"}</span>
                    {m.antwort}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}
      </div>
    </Seite>
  );
}
