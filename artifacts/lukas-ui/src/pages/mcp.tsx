import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Plug, RefreshCw, Plus, Trash2, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { Seite, Leer, Laedt, Fehler } from "@/components/seite";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type McpTool = { name: string; description?: string };

type McpServer = {
  id: number;
  slug: string;
  name: string;
  url: string;
  status: "new" | "awaiting_auth" | "connected" | "error";
  lastError: string | null;
  tools: McpTool[];
  toolsUpdatedAt: string | null;
  selectedTools: string[];
  riskTier: "R1" | "R2" | "R3";
  enabled: boolean;
  authorized: boolean;
};

const STATUS: Record<McpServer["status"], { label: string; cls: string }> = {
  new: { label: "NICHT VERBUNDEN", cls: "bg-secondary text-muted-foreground" },
  awaiting_auth: { label: "WARTET AUF ANMELDUNG", cls: "bg-amber-500/15 text-amber-300" },
  connected: { label: "VERBUNDEN", cls: "bg-emerald-500/15 text-emerald-300" },
  error: { label: "FEHLER", cls: "bg-red-500/15 text-red-300" },
};

const RISK_HINT: Record<McpServer["riskTier"], string> = {
  R1: "Läuft ohne Rückfrage — nur für Server, denen du wirklich vertraust.",
  R2: "Jeder Aufruf braucht deine Freigabe unter „Freigaben“.",
  R3: "Wie R2, für besonders heikle Server.",
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("lukas_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api/lukas/mcp${path}`, {
    ...init,
    headers: { ...authHeaders(), "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

function ServerCard({ server, onChange }: { server: McpServer; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api(`/${server.id}/connect`, { method: "POST" });
      if (r.status === "authorize" && r.authorizationUrl) {
        // Anmeldung beim Anbieter passiert im Browser — danach kommt er über
        // den Callback zurück und die Seite zeigt den neuen Stand.
        window.location.href = r.authorizationUrl;
        return;
      }
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(false);
    }
  };

  const toggleTool = (name: string) => {
    const current = proposalSelection();
    const next = current.includes(name) ? current.filter((n) => n !== name) : [...current, name];
    patch({ selectedTools: next });
  };
  // Leere Auswahl = "die ersten paar automatisch". Fuer die Anzeige machen wir
  // daraus die tatsaechlich wirksame Liste, sonst sieht man keine Haken.
  const proposalSelection = () =>
    server.selectedTools.length ? server.selectedTools : server.tools.slice(0, 12).map((t) => t.name);

  const patch = async (values: Partial<Pick<McpServer, "riskTier" | "enabled" | "selectedTools">>) => {
    setBusy(true);
    try {
      await api(`/${server.id}`, { method: "PATCH", body: JSON.stringify(values) });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`„${server.name}“ wirklich entfernen? Die Anmeldung geht dabei verloren.`)) return;
    setBusy(true);
    try {
      await api(`/${server.id}`, { method: "DELETE" });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
      setBusy(false);
    }
  };

  const s = STATUS[server.status];

  return (
    <div className="card-soft rise space-y-3 rounded-3xl p-5" data-testid={`mcp-${server.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{server.name}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded ${s.cls}`}>{s.label}</span>
            {!server.enabled && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                AUS
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 break-all">{server.url}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" disabled={busy} onClick={connect} className="gap-1.5">
            <ExternalLink className="w-4 h-4" />
            {server.authorized ? "Neu verbinden" : "Verbinden"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={remove}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {server.lastError && server.status === "error" && (
        <pre className="rounded-2xl bg-destructive/10 p-3 text-xs break-words whitespace-pre-wrap text-red-300">
          {server.lastError}
        </pre>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {server.tools.length > 0 && (
        <div>
          <button
            onClick={() => setShowTools((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {showTools ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {proposalSelection().length} von {server.tools.length} Werkzeugen aktiv
          </button>
          {showTools && (
            <ul className="mt-2 space-y-1">
              {server.tools.map((t) => {
                const an = proposalSelection().includes(t.name);
                return (
                  <li key={t.name} className="rounded-xl bg-white/[0.04] px-2.5 py-1.5 text-xs">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={an}
                        disabled={busy}
                        onChange={() => toggleTool(t.name)}
                        className="mt-0.5 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className={`font-mono ${an ? "" : "text-muted-foreground"}`}>{t.name}</span>
                        {t.description && (
                          <p className="text-muted-foreground mt-0.5 break-words">{t.description}</p>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <label className="text-xs text-muted-foreground">
          Freigabe:{" "}
          <select
            value={server.riskTier}
            disabled={busy}
            onChange={(e) => patch({ riskTier: e.target.value as McpServer["riskTier"] })}
            className="ml-1 rounded-lg bg-white/[0.06] px-2 py-1 text-xs outline-none"
          >
            <option value="R1">R1 — ohne Rückfrage</option>
            <option value="R2">R2 — Freigabe nötig</option>
            <option value="R3">R3 — Freigabe nötig</option>
          </select>
        </label>
        <label className="text-xs text-muted-foreground flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={server.enabled}
            disabled={busy}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          aktiv
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground">{RISK_HINT[server.riskTier]}</p>
    </div>
  );
}

export default function Mcp() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [callback, setCallback] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api("");
      /*
       * Geprueft, statt blind uebernommen. `data.servers` war ungeprueft; kam
       * etwas anderes zurueck als erwartet — ein Fehlerobjekt mit 200, die
       * HTML-Seite eines Proxys —, warf `servers.length` weiter unten, und
       * React riss die GANZE Seite mit: schwarzer Bildschirm statt einer
       * leeren Liste. Beim Durchsehen der Seiten ist genau das passiert.
       */
      setServers(Array.isArray(data?.servers) ? data.servers : []);
      setCallback(typeof data?.callbackUrl === "string" ? data.callbackUrl : "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!name.trim() || !url.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await api("", { method: "POST", body: JSON.stringify({ name: name.trim(), url: url.trim() }) });
      setName("");
      setUrl("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Seite
      icon={Plug}
      titel="MCP"
      unterzeile="Fremde Werkzeuge, die Lukas mitbenutzen darf."
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
      <div className="space-y-5">
        <div className="card-soft space-y-3 rounded-3xl p-5">
          <h2 className="font-medium">Server hinzufügen</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name, z.B. Kalender"
              aria-label="Name des Servers"
              className="h-11 flex-1 rounded-full bg-white/[0.05] px-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:bg-white/[0.08]"
              data-testid="input-mcp-name"
            />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/mcp"
              aria-label="Adresse des Servers"
              className="h-11 flex-[2] rounded-full bg-white/[0.05] px-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:bg-white/[0.08]"
              data-testid="input-mcp-url"
            />
            <button
              type="button"
              onClick={add}
              disabled={adding || !name.trim() || !url.trim()}
              className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100"
            >
              <Plus className="h-4 w-4" /> Anlegen
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Nach dem Anlegen auf „Verbinden“ — du wirst zum Anbieter geschickt, meldest dich dort
            an, und landest wieder hier. Danach kennt Lukas dessen Werkzeuge.
          </p>
          {callback && (
            <p className="text-[11px] break-all text-muted-foreground">
              Falls ein Anbieter nach einer Redirect-URL fragt:{" "}
              <span className="font-mono">{callback}</span>
            </p>
          )}
        </div>

        {error && <Fehler text={error} />}
        {loading && servers.length === 0 && <Laedt />}

        {!loading && servers.length === 0 && (
          <Leer
            icon={Plug}
            titel="Noch kein MCP-Server eingetragen"
            hinweis="Über MCP kann Lukas Werkzeuge fremder Dienste mitbenutzen — einen Kalender etwa, oder eine Ablage."
          />
        )}

        {servers.map((s) => (
          <ServerCard key={s.id} server={s} onChange={load} />
        ))}
      </div>
    </Seite>
  );
}
