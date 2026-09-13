import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Seite, Karte, Chip, Leer, Laedt, Fehler, staffel } from "@/components/seite";

interface DebugLogEntry {
  time: string;
  scope: string;
  message: string;
}

async function fetchDebugLog(): Promise<DebugLogEntry[]> {
  const token = localStorage.getItem("lukas_token");
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch("/api/lukas/debug-log", { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const daten = await res.json();
  /*
   * Nicht ungeprueft weiterreichen. Antwortet etwas anderes als erwartet —
   * ein Fehlerobjekt mit 200, eine HTML-Seite eines Proxys —, wirft der
   * .map() weiter unten, und React reisst die GANZE Seite mit: schwarzer
   * Bildschirm statt einer leeren Liste. Genau so ist es auf der Startseite
   * schon einmal passiert.
   */
  return Array.isArray(daten) ? daten : [];
}

export default function Diagnostics() {
  const [entries, setEntries] = useState<DebugLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchDebugLog()
      .then((data) => {
        setEntries(data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <Seite
      icon={AlertTriangle}
      titel="Diagnose"
      unterzeile="Was zuletzt schiefgegangen ist — aus Chat, Widget und der ElevenLabs-Anbindung. Aktualisiert sich alle fünf Sekunden von selbst."
      aktionen={
        <button
          type="button"
          onClick={load}
          data-testid="button-refresh-debug-log"
          className="flex items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 text-sm transition-colors hover:bg-white/[0.1]"
        >
          <RefreshCw className="h-4 w-4" /> Aktualisieren
        </button>
      }
    >
      {loading && <Laedt />}
      {error && <Fehler text={`Die Liste liess sich nicht laden: ${error}`} />}

      <div className="space-y-3">
        {entries.map((entry, idx) => (
          <Karte key={`${entry.time}-${idx}`} verzoegerung={staffel(idx)}>
            <div className="flex gap-3" data-testid={`debug-entry-${idx}`}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip ton="schlecht">{entry.scope}</Chip>
                  <span className="text-[11px] text-muted-foreground">
                    {format(new Date(entry.time), "d. MMMM, HH:mm:ss", { locale: de })}
                  </span>
                </div>
                {/*
                  Mono bleibt hier absichtlich: das ist eine Fehlermeldung aus
                  dem Server, oft mit Pfaden und Codes. Sie zu proportionaler
                  Schrift zu machen, macht sie huebscher und schlechter lesbar.
                */}
                <p className="mt-2 font-mono text-[13px] leading-relaxed break-words text-foreground/90">
                  {entry.message}
                </p>
              </div>
            </div>
          </Karte>
        ))}
      </div>

      {!loading && !error && entries.length === 0 && (
        <Leer
          icon={ShieldCheck}
          titel="Nichts fehlgeschlagen"
          hinweis="Seit dem letzten Neustart des Servers ist kein Fehler aufgelaufen."
        />
      )}
    </Seite>
  );
}
