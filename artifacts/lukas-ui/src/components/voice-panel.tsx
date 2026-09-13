import { useEffect, useRef, useState } from "react";
import { RealtimeAgent, RealtimeSession, OpenAIRealtimeWebRTC, type RealtimeItem } from "@openai/agents-realtime";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mic, MicOff, Loader2, Volume2, Ear } from "lucide-react";

// Echter privater Sprachkanal: OpenAIs Realtime API (Speech-to-Speech,
// vom Server geliefert). Der Browser verbindet per WebRTC DIREKT zu OpenAI mit
// einem kurzlebigen Client-Secret von /api/lukas/realtime-session -- kein
// Umweg mehr ueber unseren Server waehrend des Gespraechs (anders als beim
// ElevenLabs-Custom-LLM-Pfad des oeffentlichen Widgets). Lukas' volles
// privates Gedaechtnis (Erinnerungen, Ziele, Emotion) steckt bereits als
// Instructions im Client-Secret -- der Browser sieht diesen Text nie, nur
// das Secret selbst.

type VoiceStatus = "idle" | "connecting" | "connected" | "speaking" | "listening" | "error";

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

export function VoicePanel({ autoStart = false }: { autoStart?: boolean }) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const sessionRef = useRef<RealtimeSession | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  async function start() {
    setStatus("connecting");
    setErrorMsg(null);
    try {
      const token = localStorage.getItem("lukas_token");
      const res = await fetch("/api/lukas/realtime-session", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
      }
      // Das Modell liefert der Server mit (routes/lukas.ts). Hier stand es
      // als Zeichenkette — eine Stelle, die bei jedem Wechsel vergessen wird.
      const { value: apiKey, model } = (await res.json()) as { value: string; model?: string };

      // Eigener Stream mit expliziter Echo-/Rauschunterdrückung statt den
      // SDK-eigenen zu nutzen — ohne echoCancellation hört das Mikro (v.a.
      // am Laptop-/Handylautsprecher ohne Headset) Lukas' eigene Stimme mit,
      // was zu Phantom-"Antworten" und einer Selbstunterbrechungs-Schleife
      // führt.
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStreamRef.current = micStream;

      const agent = new RealtimeAgent({ name: "Lukas" });
      const session = new RealtimeSession(agent, {
        ...(model ? { model } : {}),
        transport: new OpenAIRealtimeWebRTC({ mediaStream: micStream }),
      });

      // WICHTIG: session.on("audio_start", ...) NICHT verwenden -- laut SDK-
      // Typdefinition (transportLayerEvents.d.ts) wird das "audio"-Event "might
      // not be triggered if the transport layer handles the audio internally
      // (WebRTC)" -- und genau das ist hier der Fall (OpenAIRealtimeWebRTC).
      // Dadurch feuerte session.mute(true) nie, das Mikro blieb während Lukas'
      // gesamter Antwort offen -> er hat sich selbst gehört, unterbrochen und
      // beantwortet. Stattdessen auf die rohen, WebRTC-spezifischen Server-
      // Events output_audio_buffer.started/stopped hören (kommen zuverlässig
      // über den Data-Channel, siehe public/widget.js für dieselbe Technik).
      session.on("transport_event", (event) => {
        if (event.type === "output_audio_buffer.started") {
          setStatus("speaking");
          session.mute(true);
        } else if (event.type === "output_audio_buffer.stopped") {
          setStatus("listening");
          session.mute(false);
        }
      });
      session.on("history_updated", (history: RealtimeItem[]) => {
        const lines: TranscriptEntry[] = [];
        for (const item of history) {
          if (item.type !== "message" || item.role === "system") continue;
          const text = item.content
            .map((c) => ("text" in c ? c.text : "transcript" in c ? c.transcript : ""))
            .filter((s): s is string => !!s)
            .join(" ");
          if (text) lines.push({ role: item.role === "user" ? "user" : "assistant", text });
        }
        if (lines.length) setTranscript(lines);
      });
      session.on("error", ({ error }) => {
        setStatus("error");
        setErrorMsg(error instanceof Error ? error.message : "Sprachverbindung fehlgeschlagen.");
        sessionRef.current = null;
        micStreamRef.current?.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      });

      await session.connect({ apiKey });
      sessionRef.current = session;
      setStatus("connected");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Unbekannter Fehler");
      sessionRef.current = null;
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
  }

  // Fuer den "Hey Siri, Lukas"-Weg: eine iOS-Kurzbefehl-Aktion oeffnet
  // /chat?voice=auto, das Gespraech startet dann ohne weiteren Klick. Echtes
  // Wake-Word im gesperrten Zustand ist ueber eine Website technisch nicht
  // moeglich -- das muss Siri selbst (per Kurzbefehl) uebernehmen.
  useEffect(() => {
    if (autoStart) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stop() {
    sessionRef.current?.close();
    sessionRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    setStatus("idle");
  }

  const isActive = status === "connected" || status === "speaking" || status === "listening";
  const isBusy = status === "connecting";

  const statusLabel: Record<VoiceStatus, string> = {
    idle: "Sprachchat aus",
    connecting: "Verbinde…",
    connected: "Verbunden — sprich einfach",
    speaking: "Lukas spricht…",
    listening: "Lukas hört zu…",
    error: "Fehler",
  };

  return (
    <div className="border-b border-white/[0.05]" data-testid="panel-voice">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Button
          size="sm"
          variant={isActive ? "destructive" : "default"}
          onClick={isActive ? stop : start}
          disabled={isBusy}
          className="gap-2 shrink-0"
          data-testid={isActive ? "button-voice-stop" : "button-voice-start"}
        >
          {isBusy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : isActive ? (
            <MicOff className="w-4 h-4" />
          ) : (
            <Mic className="w-4 h-4" />
          )}
          {isActive ? "Beenden" : "Sprechen"}
        </Button>

        <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
          {status === "speaking" && <Volume2 className="w-3.5 h-3.5 shrink-0 text-primary animate-pulse" />}
          {status === "listening" && <Ear className="w-3.5 h-3.5 shrink-0 text-primary animate-pulse" />}
          <span className="truncate">{errorMsg ?? statusLabel[status]}</span>
        </div>
      </div>

      {(isActive || transcript.length > 0) && (
        <ScrollArea className="max-h-32 px-4 pb-2">
          <div className="space-y-1.5 text-xs">
            {transcript.map((t, i) => (
              <div key={i} className={t.role === "user" ? "text-foreground" : "text-muted-foreground"}>
                <span className="opacity-60">{t.role === "user" ? "DU: " : "LUKAS: "}</span>
                {t.text}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
