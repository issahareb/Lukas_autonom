import { useEffect, useState, useCallback } from "react";
import { ShieldCheck, RefreshCw, Check, CheckCheck, X, Clock, Search, History } from "lucide-react";
import { Seite, Karte, Chip, Leer, Laedt, Fehler, staffel } from "@/components/seite";
import { freigabe } from "@/lib/worte";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Approval = {
  id: number;
  conversationId: number | null;
  tool: string;
  riskTier: string;
  argumentsPreview: string;
  status: "pending" | "allowed" | "denied" | "used" | "expired";
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string;
  expired: boolean;
};

/*
 * Die Risikostufe faerbt die Pille. R0/R1 bleiben grau: sie sind harmlos, und
 * alles einzufaerben nimmt der Farbe ihre Aussage.
 */
const TIER_TON = {
  R0: "neutral",
  R1: "neutral",
  R2: "warnung",
  R3: "schlecht",
} as const;

/** Was die Stufen bedeuten — sonst steht dort nur "R2" und niemand weiss es. */
const TIER_WORT: Record<string, string> = {
  R0: "harmlos",
  R1: "harmlos",
  R2: "heikel",
  R3: "riskant",
};

const STATUS_TON = {
  pending: "warnung",
  allowed: "gut",
  used: "gut",
  denied: "schlecht",
  expired: "neutral",
} as const;

export default function Approvals() {
  const [filter, setFilter] = useState<"offen" | "verlauf" | "alle">("offen");
  const [suche, setSuche] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [limit, setLimit] = useState(20);
  const [rows, setRows] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("lukas_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/lukas/approvals`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const daten = await res.json();
      /*
       * Geprueft, statt blind uebernommen. Antwortet etwas anderes als eine
       * Liste — ein Fehlerobjekt mit 200, die HTML-Seite eines Proxys —,
       * wirft der .filter() weiter unten, und React reisst die GANZE Seite
       * mit: schwarzer Bildschirm statt einer leeren Liste. Auf der
       * Startseite ist genau das schon einmal passiert.
       */
      if (!Array.isArray(daten)) throw new Error("unerwartete Antwort vom Server");
      setRows(daten);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Offene Freigaben sollen zeitnah auftauchen, während Lukas wartet.
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const decide = async (id: number, action: "allow" | "deny" | "allow-auftrag") => {
    if (busy !== null) return;
    setBusy(id);
    setDecisionError(null);
    try {
      const res = await fetch(`${BASE}/api/lukas/approvals/${id}/${action}`, { method: "POST", headers: authHeaders() });
      if (!res.ok) throw new Error(`Entscheidung nicht gespeichert (HTTP ${res.status}). Bitte erneut versuchen.`);
      await load();
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : "Entscheidung nicht gespeichert.");
    } finally {
      setBusy(null);
    }
  };

  const pending = rows.filter((r) => r.status === "pending" && !r.expired);
  const rest = rows.filter((r) => !(r.status === "pending" && !r.expired));
  const matches = (r: Approval) => `${r.tool} ${r.argumentsPreview}`.toLocaleLowerCase("de").includes(suche.trim().toLocaleLowerCase("de"));
  const shownPending = filter === "verlauf" ? [] : pending.filter(matches);
  const shownRest = filter === "offen" ? [] : rest.filter(matches);
  const changeFilter = (next: typeof filter) => { setFilter(next); setLimit(20); };

  return (
    <Seite
      breit
      icon={ShieldCheck}
      titel="Freigaben"
      unterzeile="Aktionen, die Lukas nur mit deiner ausdrücklichen Zustimmung ausführen darf."
      aktionen={
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 text-sm transition-colors hover:bg-white/[0.1]"
        >
          <RefreshCw className="h-4 w-4" /> Aktualisieren
        </button>
      }
    >
      <div className="workspace-stats" aria-label="Freigaben im Überblick">
        <div className="workspace-stat"><Clock /><div><strong>{(loading || error) && !rows.length ? "–" : pending.length}</strong><span>Warten auf dich</span></div></div>
        <div className="workspace-stat"><CheckCheck /><div><strong>{(loading || error) && !rows.length ? "–" : rows.filter(r => r.status === "allowed" || r.status === "used").length}</strong><span>Freigegeben</span></div></div>
        <div className="workspace-stat"><History /><div><strong>{(loading || error) && !rows.length ? "–" : rest.length}</strong><span>Im Verlauf</span></div></div>
      </div>
      <div className="workspace-filters" aria-label="Freigaben filtern">
        {([{ key: "offen", label: "Offen", count: pending.length }, { key: "verlauf", label: "Verlauf", count: rest.length }, { key: "alle", label: "Alle", count: rows.length }] as const).map(item => <button key={item.key} type="button" aria-pressed={filter === item.key} onClick={() => changeFilter(item.key)}>{item.label}<span>{item.count}</span></button>)}
        <label className="workspace-search"><Search size={17} /><input type="search" aria-label="Freigaben suchen" placeholder="Aktion oder Inhalt suchen" value={suche} onChange={e => { setSuche(e.target.value); setLimit(20); }} /></label>
      </div>
      {decisionError && <Fehler text={decisionError} />}
      {loading && rows.length === 0 && <Laedt was="Freigaben werden geladen…" />}
      {error && <Fehler text={`Die Freigaben liessen sich nicht laden: ${error}`} />}

      {pending.length === 0 && filter === "offen" && !suche && !loading && !error && (
        <Leer
          icon={ShieldCheck}
          titel="Nichts offen"
          hinweis="Lukas wartet gerade auf keine Freigabe. Sobald er etwas Heikles vorhat, steht es hier."
        />
      )}

      <div className="approval-queue">
        {shownPending.map((r, idx) => (
          <div key={r.id} data-testid={`approval-${r.id}`}>
            {/*
              Die offenen Freigaben tragen als Einzige einen farbigen Rand —
              hier ist es keine Zierde, sondern die Aussage: DAS wartet auf
              dich. Der Verlauf darunter bleibt ruhig.
            */}
            <Karte verzoegerung={staffel(idx)} className="ring-1 ring-amber-400/25">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Mono bleibt: das ist ein Werkzeugname aus dem Code,
                        kein Wort der Umgangssprache. */}
                    <span className="font-mono text-[15px] font-medium break-all">{r.tool}</span>
                    <Chip ton={TIER_TON[r.riskTier as keyof typeof TIER_TON] ?? "neutral"}>
                      {TIER_WORT[r.riskTier] ?? r.riskTier}
                    </Chip>
                  </div>
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    läuft ab um{" "}
                    {new Date(r.expiresAt).toLocaleTimeString("de-DE", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>

              <pre className="mt-3 overflow-x-auto rounded-2xl bg-black/30 p-3.5 text-xs leading-relaxed break-words whitespace-pre-wrap">
                {r.argumentsPreview}
              </pre>

              <div className="approval-actions mt-4">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => decide(r.id, "allow")}
                  className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03]"
                >
                  <Check className="h-4 w-4" /> Erlauben
                </button>
                {/* Bei R3 bewusst nicht: Geld, Zugangsdaten und
                    Unumkehrbares bleiben Einzelentscheidungen. */}
                {r.riskTier !== "R3" && (
                  <button
                    type="button"
                    disabled={busy !== null}
                  onClick={() => decide(r.id, "allow-auftrag")}
                    title="Gilt für dieses Werkzeug in dieser Unterhaltung — 30 Minuten, höchstens 25 Aufrufe"
                    className="flex items-center gap-1.5 rounded-full bg-white/[0.08] px-4 py-2 text-sm transition-colors hover:bg-white/[0.12]"
                  >
                    <CheckCheck className="h-4 w-4" /> Für die Aufgabe
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => decide(r.id, "deny")}
                  className="flex items-center gap-1.5 rounded-full bg-destructive/12 px-4 py-2 text-sm text-red-300 transition-colors hover:bg-destructive/20"
                >
                  <X className="h-4 w-4" /> Ablehnen
                </button>
              </div>

              <details className="approval-details"><summary>Geltungsbereich der Freigabe</summary><p className="mt-2 leading-relaxed">
                <strong className="font-medium text-foreground/80">Erlauben</strong> gilt nur für
                genau diese Argumente und nur einmal — ändert Lukas ein Zeichen, braucht es eine
                neue Freigabe.{" "}
                {r.riskTier !== "R3" && (
                  <>
                    <strong className="font-medium text-foreground/80">Für die Aufgabe</strong>{" "}
                    gilt für dieses Werkzeug in dieser Unterhaltung, 30 Minuten lang und höchstens
                    25 Aufrufe — für einen Auftrag, den du einmal erteilt hast und nicht sechsmal
                    bestätigen willst.
                  </>
                )}
              </p></details>
            </Karte>
          </div>
        ))}
      </div>

      {!loading && !error && (suche || filter !== "offen") && shownPending.length + shownRest.length === 0 && <Leer icon={Search} titel="Keine passenden Freigaben" hinweis="Ändere die Suche oder den ausgewählten Bereich." />}
      {shownRest.length > 0 && <section>
        <div className="workspace-subhead"><h2>Entscheidungsverlauf</h2><p>{shownRest.length} Einträge</p></div>
        <div className="approval-history">{shownRest.slice(0, limit).map(r => {
          const stand = r.expired && r.status === "pending" ? "expired" : r.status;
          return <div key={r.id} className="approval-history-row">
            <div><span className="font-mono text-[13px] break-all">{r.tool}</span><time dateTime={r.decidedAt ?? r.createdAt}>{new Date(r.decidedAt ?? r.createdAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></div>
            <div className="flex flex-wrap gap-2"><Chip ton={TIER_TON[r.riskTier as keyof typeof TIER_TON] ?? "neutral"}>{TIER_WORT[r.riskTier] ?? r.riskTier}</Chip><Chip ton={STATUS_TON[stand]}>{stand === "used" ? "benutzt" : freigabe(stand)}</Chip></div>
          </div>;
        })}</div>
        {shownRest.length > limit && <button type="button" className="mt-4 min-h-11 w-full rounded-xl bg-white/5 text-sm" onClick={() => setLimit(n => n + 20)}>Weitere Entscheidungen anzeigen</button>}
      </section>}

    </Seite>
  );
}
