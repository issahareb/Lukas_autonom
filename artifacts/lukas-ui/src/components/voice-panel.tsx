import { useEffect } from "react";
import { useSprachsitzung, type SprachStatus } from "@/hooks/use-sprachsitzung";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mic, MicOff, Loader2, Volume2, Ear } from "lucide-react";

export function VoicePanel({ autoStart = false }: { autoStart?: boolean }) {
  const { status, zeilen, fehler, aktiv, starten, beenden } = useSprachsitzung();
  useEffect(() => { if (autoStart) void starten(); }, [autoStart, starten]);
  const verbindet = status === "verbindet";
  const laeuft = aktiv || verbindet;
  const statusLabel: Record<SprachStatus, string> = {
    aus: "Sprachchat aus", verbindet: "Verbinde…", bereit: "Verbunden — sprich einfach",
    spricht: "Lukas spricht…", hoert: "Lukas hört zu…", fehler: "Fehler",
  };
  return (
    <div className="voice-panel border-b border-white/[0.05]" data-testid="panel-voice">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Button size="sm" variant={laeuft ? "destructive" : "default"}
          onClick={laeuft ? beenden : starten} className="gap-2 shrink-0"
          data-testid={laeuft ? "button-voice-stop" : "button-voice-start"}>
          {verbindet ? <Loader2 className="w-4 h-4 animate-spin" /> : aktiv ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          {verbindet ? "Abbrechen" : aktiv ? "Beenden" : "Sprechen"}
        </Button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0" role="status">
          {status === "spricht" && <Volume2 className="w-3.5 h-3.5 shrink-0 text-primary animate-pulse" />}
          {status === "hoert" && <Ear className="w-3.5 h-3.5 shrink-0 text-primary animate-pulse" />}
          <span className="truncate">{fehler ?? statusLabel[status]}</span>
        </div>
      </div>
      {(aktiv || zeilen.length > 0) && (
        <ScrollArea className="max-h-32 px-4 pb-2">
          <div className="space-y-1.5 text-xs">
            {zeilen.map((t, i) => (
              <div key={i} className={t.role === "user" ? "text-foreground" : "text-muted-foreground"}>
                <span className="opacity-60">{t.role === "user" ? "DU: " : "LUKAS: "}</span>{t.text}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
