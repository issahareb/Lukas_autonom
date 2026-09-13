import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Terminal,
  Users,
  Globe,
  Search,
  Brain,
  Mail,
  Image as ImageIcon,
  Heart,
  Check,
  AlertTriangle,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type ToolStep = {
  tool: string;
  input: string;
  result: string;
  ok: boolean;
  ms: number;
};

/*
 * Werkzeugnamen sind fuer Lukas gedacht, nicht fuer Issa.
 *
 * "execute_command" sagt einem Menschen wenig; "Befehl ausgeführt" sagt alles.
 * Was nicht in der Liste steht, behaelt seinen technischen Namen — lieber
 * ehrlich technisch als eine erfundene, womoeglich falsche Beschreibung.
 */
const NAMEN: Record<string, { label: string; icon: LucideIcon }> = {
  execute_command: { label: "Befehl ausgeführt", icon: Terminal },
  execute_on_host: { label: "Befehl auf dem Server", icon: Terminal },
  ask_subagent: { label: "Team gefragt", icon: Users },
  fetch_url: { label: "Seite gelesen", icon: Globe },
  web_search: { label: "Im Netz gesucht", icon: Search },
  query_memory: { label: "Im Gedächtnis gesucht", icon: Brain },
  remember: { label: "Gemerkt", icon: Brain },
  email_search: { label: "Postfach durchsucht", icon: Mail },
  email_read: { label: "Mail gelesen", icon: Mail },
  email_send: { label: "Mail vorbereitet", icon: Mail },
  generate_image: { label: "Bild erzeugt", icon: ImageIcon },
  generate_video: { label: "Video erzeugt", icon: ImageIcon },
  feel: { label: "Gefühlt", icon: Heart },
};

function beschrifte(tool: string) {
  return NAMEN[tool] ?? { label: tool.replace(/^mcp__/, "").replace(/_/g, " "), icon: Wrench };
}

function dauer(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60000)} min`;
}

/*
 * Die interessante Zeile aus den Argumenten.
 *
 * Bei einem Befehl ist das der Befehl, bei einer Frage an das Team die Frage.
 * Sie direkt auf dem Chip zu zeigen, spart in den meisten Faellen das
 * Aufklappen — man sieht auf einen Blick, WAS er getan hat, nicht nur DASS er
 * etwas getan hat.
 */
function kernAus(input: string): string | null {
  try {
    const werte = JSON.parse(input) as Record<string, unknown>;
    for (const schluessel of ["command", "cmd", "frage", "question", "task", "url", "query", "prompt"]) {
      const wert = werte[schluessel];
      if (typeof wert === "string" && wert.trim()) return wert.trim();
    }
  } catch {
    /* Kein JSON — dann eben nichts. */
  }
  return null;
}

function Block({ titel, text }: { titel: string; text: string }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">{titel}</div>
      <pre className="max-h-[40vh] overflow-auto rounded-2xl bg-black/25 p-3.5 text-xs leading-relaxed break-words whitespace-pre-wrap">
        {text || "—"}
      </pre>
    </div>
  );
}

/*
 * Argumente als Feld/Wert statt als rohes JSON.
 *
 * Geschweifte Klammern und Anfuehrungszeichen sind fuer eine Maschine
 * geschrieben. Was Issa wissen will, ist "An: Ideenprüfer" und darunter die
 * Frage. Verschachteltes bleibt JSON — dort etwas zu erfinden waere geraten.
 */
function Argumente({ input }: { input: string }) {
  let werte: Record<string, unknown> | null = null;
  try {
    const roh = JSON.parse(input);
    if (roh && typeof roh === "object" && !Array.isArray(roh)) werte = roh;
  } catch {
    /* kein JSON */
  }

  const eintraege = Object.entries(werte ?? {});
  if (!werte || eintraege.length === 0) return <Block titel="Womit" text={input} />;

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">Womit</div>
      <div className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl bg-white/[0.04]">
        {eintraege.map(([schluessel, wert]) => {
          const einfach = typeof wert !== "object" || wert === null;
          return (
            <div key={schluessel} className="p-3.5 space-y-1">
              <div className="text-[11px] tracking-wide text-muted-foreground/70">
                {schluessel}
              </div>
              <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                {einfach ? String(wert) : JSON.stringify(wert, null, 2)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Die Schritte hinter einer Antwort — anklickbar, Details fahren von unten ein.
 */
export function ToolSteps({ steps }: { steps: ToolStep[] }) {
  const [offen, setOffen] = useState<ToolStep | null>(null);
  if (steps.length === 0) return null;

  const info = offen ? beschrifte(offen.tool) : null;

  return (
    <>
      <div className="flex flex-wrap gap-1.5 mt-2.5">
        {steps.map((step, i) => {
          const { label, icon: Icon } = beschrifte(step.tool);
          const kern = kernAus(step.input);
          return (
            <button
              key={i}
              onClick={() => setOffen(step)}
              style={{ animationDelay: `${i * 60}ms` }}
              className={`group flex items-center gap-2 max-w-full rounded-full border pl-2.5 pr-3 py-1.5 text-xs
                transition-all duration-200 hover:-translate-y-px active:translate-y-0
                animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards
                ${
                  step.ok
                    ? "border-border/70 bg-secondary/50 hover:bg-secondary hover:border-primary/40"
                    : "border-destructive/40 bg-destructive/10 hover:border-destructive/70"
                }`}
            >
              <Icon
                className={`w-3.5 h-3.5 shrink-0 ${step.ok ? "text-primary" : "text-destructive"}`}
              />
              <span className="font-medium shrink-0">{label}</span>
              {kern && (
                <span className="text-muted-foreground truncate hidden sm:inline max-w-[22ch]">
                  {kern}
                </span>
              )}
              <span className="text-muted-foreground/60 shrink-0 tabular-nums">{dauer(step.ms)}</span>
            </button>
          );
        })}
      </div>

      <Sheet open={offen !== null} onOpenChange={(o) => !o && setOffen(null)}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl border-border max-h-[85vh] overflow-y-auto p-5 sm:p-6"
        >
          {/* Griff wie bei einem echten Bottom Sheet. */}
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
          {offen && info && (
            <>
              <SheetHeader className="text-left space-y-1.5">
                <SheetTitle className="flex items-center gap-2.5 text-base">
                  <span
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                      offen.ok ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"
                    }`}
                  >
                    <info.icon className="w-4 h-4" />
                  </span>
                  {info.label}
                </SheetTitle>
                <SheetDescription className="flex items-center gap-2 text-xs">
                  <span className="font-mono">{offen.tool}</span>
                  <span>·</span>
                  <span>{dauer(offen.ms)}</span>
                  <span>·</span>
                  <span
                    className={`inline-flex items-center gap-1 ${
                      offen.ok ? "text-emerald-400" : "text-destructive"
                    }`}
                  >
                    {offen.ok ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                    {offen.ok ? "erfolgreich" : "fehlgeschlagen"}
                  </span>
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-4 mt-5">
                <Argumente input={offen.input} />
                <Block titel="Was zurückkam" text={offen.result} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
