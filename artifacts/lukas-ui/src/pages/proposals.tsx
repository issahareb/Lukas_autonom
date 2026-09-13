import { useEffect, useState, useCallback } from "react";
import {
  Lightbulb,
  RefreshCw,
  Check,
  X,
  Undo2,
  ChevronDown,
  ChevronRight,
  GitPullRequest,
} from "lucide-react";
import { Seite, Karte, Chip, Leer, Laedt, Fehler, staffel } from "@/components/seite";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ProposalFile = { path: string; content: string };

type Proposal = {
  id: number;
  repo: string;
  title: string;
  summary: string;
  reasoning: string;
  files: ProposalFile[];
  status: "pending" | "accepted" | "rejected" | "revision";
  comment: string | null;
  appliedResult: string | null;
  targetBranch: string | null;
  /*
   * Branch und Pull Request entstehen erst beim Annehmen. Sie stehen hier,
   * weil ein uebernommener Vorschlag sonst nur ein Haken waere: mit dem Link
   * kann man nachsehen, WAS tatsaechlich hinausgegangen ist.
   */
  branchName: string | null;
  pullRequestUrl: string | null;
  createdAt: string;
  decidedAt: string | null;
};

const STATUS_WORT: Record<Proposal["status"], string> = {
  pending: "offen",
  accepted: "übernommen",
  rejected: "abgelehnt",
  revision: "zurückgeschickt",
};

const STATUS_TON = {
  pending: "warnung",
  accepted: "gut",
  rejected: "schlecht",
  revision: "info",
} as const;

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("lukas_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Eine offene Karte: was passiert, welche Dateien, drei Knöpfe. */
function OpenProposal({
  proposal,
  onDone,
}: {
  proposal: Proposal;
  onDone: () => void;
}) {
  const [showFiles, setShowFiles] = useState(false);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (action: "accept" | "reject" | "revise") => {
    if (action === "revise" && !comment.trim()) {
      setError("Schreib kurz dazu, was Lukas anders machen soll.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/lukas/proposals/${proposal.id}/${action}`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(comment.trim() ? { comment: comment.trim() } : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="card-soft rise space-y-4 rounded-3xl p-5 ring-1 ring-amber-400/25"
      data-testid={`proposal-${proposal.id}`}
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Lightbulb className="h-4 w-4 shrink-0 text-amber-300" />
          <span className="text-[1.05rem] font-semibold tracking-tight">{proposal.title}</span>
          <span className="text-[11px] text-muted-foreground">#{proposal.id}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {proposal.repo} ·{" "}
          {new Date(proposal.createdAt).toLocaleString("de-DE", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-xs text-muted-foreground mb-1">Was passiert</h3>
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {proposal.summary}
          </p>
        </div>
        {proposal.reasoning && (
          <div>
            <h3 className="text-xs text-muted-foreground mb-1">Warum</h3>
            <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
              {proposal.reasoning}
            </p>
          </div>
        )}
      </div>

      <div>
        <button
          onClick={() => setShowFiles((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {showFiles ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          {proposal.files.length} {proposal.files.length === 1 ? "Datei" : "Dateien"}
          {!showFiles && " — ansehen"}
        </button>

        {showFiles && (
          <div className="mt-2 space-y-1.5">
            {proposal.files.map((f) => (
              <div key={f.path} className="overflow-hidden rounded-2xl bg-white/[0.04]">
                <button
                  onClick={() => setOpenFile(openFile === f.path ? null : f.path)}
                  className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-white/[0.04]"
                >
                  {/* Mono: das ist ein Dateipfad. */}
                  <span className="truncate font-mono">{f.path}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {f.content.split("\n").length} Zeilen
                  </span>
                </button>
                {openFile === f.path && (
                  <pre className="max-h-80 overflow-auto bg-black/30 p-3.5 text-[11px] leading-relaxed">
                    {f.content}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Kommentar (nötig zum Zurückschicken, sonst optional)…"
          rows={2}
          className="w-full resize-y rounded-2xl bg-white/[0.05] px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:bg-white/[0.08]"
          data-testid={`proposal-comment-${proposal.id}`}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => decide("accept")}
            className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100"
          >
            <Check className="h-4 w-4" /> Annehmen
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => decide("revise")}
            className="flex items-center gap-1.5 rounded-full bg-white/[0.08] px-4 py-2 text-sm transition-colors hover:bg-white/[0.12] disabled:opacity-40"
          >
            <Undo2 className="h-4 w-4" /> Mit Kommentar zurück
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => decide("reject")}
            className="flex items-center gap-1.5 rounded-full bg-destructive/12 px-4 py-2 text-sm text-red-300 transition-colors hover:bg-destructive/20 disabled:opacity-40"
          >
            <X className="h-4 w-4" /> Ablehnen
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {proposal.targetBranch ? (
            <>
              Beim Annehmen geht die Änderung direkt auf{" "}
              <span className="font-mono">{proposal.targetBranch}</span> — den Branch, den Railway
              baut. Sie ist damit ein paar Minuten später live. Vorher passiert nichts.
            </>
          ) : (
            <>
              Erst beim Annehmen wird die Änderung geschrieben. Achtung: es ist kein Deploy-Branch
              gesetzt, sie landet auf dem Default-Branch und wird nicht ausgeliefert.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export default function Proposals() {
  const [rows, setRows] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/lukas/proposals`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const daten = await res.json();
      // Geprueft statt blind uebernommen: eine unerwartete Antwort wuerde im
      // .filter() werfen und die ganze Seite schwarz machen.
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
    // Lukas kann jederzeit etwas vorschlagen, auch während man hier draufschaut.
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const open = rows.filter((r) => r.status === "pending");
  const rest = rows.filter((r) => r.status !== "pending");

  return (
    <Seite
      icon={Lightbulb}
      titel="Vorschläge"
      unterzeile="Änderungen, die Lukas an seinem eigenen Code vornehmen möchte."
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
      {loading && rows.length === 0 && <Laedt was="Vorschläge werden geladen…" />}
      {error && <Fehler text={`Die Vorschläge liessen sich nicht laden: ${error}`} />}

      {!loading && !error && open.length === 0 && (
        <Leer
          icon={Lightbulb}
          titel="Nichts offen"
          hinweis="Lukas hat gerade keinen Vorschlag für dich. Fällt ihm beim Arbeiten etwas an seinem Code auf, landet es hier."
        />
      )}

      <div className="space-y-5">
        {open.map((p) => (
          <OpenProposal key={p.id} proposal={p} onDone={load} />
        ))}
      </div>

      {rest.length > 0 && (
        <div className="mt-9">
          <h2 className="px-1 text-[11px] tracking-wide text-muted-foreground">Verlauf</h2>
          <div className="mt-2.5 space-y-2.5">
            {rest.map((r, idx) => (
              <Karte key={r.id} verzoegerung={staffel(idx)} className="!p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm">{r.title}</span>
                  <Chip ton={STATUS_TON[r.status] ?? "neutral"}>{STATUS_WORT[r.status]}</Chip>
                </div>
                {r.comment && (
                  <p className="mt-1.5 text-xs break-words text-muted-foreground">
                    Dein Kommentar: {r.comment}
                  </p>
                )}
                {r.appliedResult && (
                  <p className="mt-1.5 text-xs break-words text-muted-foreground">
                    {r.appliedResult}
                  </p>
                )}
                {/*
                  Der Link zum Pull Request. Ohne ihn waere ein uebernommener
                  Vorschlag nur ein Haken — hier kann man nachsehen, was
                  tatsaechlich hinausgegangen ist, Zeile fuer Zeile.
                */}
                {r.pullRequestUrl && (
                  <a
                    href={r.pullRequestUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-xs transition-colors hover:bg-white/[0.1]"
                  >
                    <GitPullRequest className="h-3.5 w-3.5" />
                    Pull Request ansehen
                  </a>
                )}
              </Karte>
            ))}
          </div>
        </div>
      )}
    </Seite>
  );
}
