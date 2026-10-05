import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { aktiviereTelefonWiedergabe, TelefonAudio } from "@/lib/telefon-audio";
import { TelefonHinweis } from "./telefon-hinweis";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function LiveMithoeren({ id, aktiv, zustimmung }: { id: number; aktiv: boolean; zustimmung: boolean }) {
  const session = useRef<{ controller: AbortController; player: TelefonAudio; freigeben: () => void } | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [status, setStatus] = useState("");
  const [pegel, setPegel] = useState(0);
  const stop = () => { const current = session.current; session.current = null; current?.controller.abort(); current?.player.close(); current?.freigeben(); };
  useEffect(() => () => stop(), []);
  useEffect(() => {
    if (!laeuft) { setPegel(0); return; }
    const timer = window.setInterval(() => setPegel(session.current?.player.pegel() ?? 0), 200);
    return () => window.clearInterval(timer);
  }, [laeuft]);
  useEffect(() => {
    if ((!aktiv || !zustimmung) && session.current) { stop(); setLaeuft(false); setStatus("Mithören beendet."); }
  }, [aktiv, zustimmung]);
  useEffect(() => {
    const changed = () => {
      if (document.hidden && session.current) { stop(); setLaeuft(false); setStatus("Mithören pausiert. Zum Fortsetzen erneut starten und diese Seite geöffnet lassen."); }
    };
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);

  const starten = async () => {
    stop(); setStatus("Warte auf Gesprächsaudio …"); setLaeuft(true);
    let current: typeof session.current = null;
    const freigeben = aktiviereTelefonWiedergabe();
    try {
      const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Audio) throw new Error("Dieser Browser unterstützt die Live-Wiedergabe nicht.");
      const context = new Audio();
      const player = new TelefonAudio(context), controller = new AbortController();
      current = { player, controller, freigeben }; session.current = current;
      // Resume synchronously from the tap, before fetch: required for iPhone Safari.
      const resumed = context.resume();
      const unlock = context.createBufferSource();
      unlock.buffer = context.createBuffer(1, 1, context.sampleRate); unlock.connect(context.destination);
      unlock.onended = () => unlock.disconnect(); unlock.start();
      await resumed;
      if (controller.signal.aborted) return;
      if (context.state !== "running") throw new Error("Wiedergabe nicht gestartet. Bitte erneut antippen.");
      context.onstatechange = () => {
        if (context.state !== "running" && session.current === current) {
          stop(); setLaeuft(false); setStatus("Wiedergabe unterbrochen. Bitte erneut starten.");
        }
      };
      const token = localStorage.getItem("lukas_token");
      const response = await fetch(`${BASE}/api/lukas/telefon/anrufe/${id}/live-ticket`, {
        method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Live-Mithören konnte nicht verbunden werden.");
      if (controller.signal.aborted) return;
      const url = new URL(`${BASE}/api/telefon/live-player`, window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("ticket", result.ticket);
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(url);
        let ended = false;
        const timeout = window.setTimeout(() => { socket.close(); reject(new Error("Audiostream antwortet nicht. Bitte erneut starten.")); }, 10000);
        // Waiting/heartbeat messages prove a connection, not arriving audio.
        // Only real playable frames renew the separate audio deadline.
        let audioDeadline = window.setTimeout(() => {
          cleanup(); socket.close(); reject(new Error("Verbunden, aber seit 15 Sekunden kein Gesprächsaudio empfangen. Bitte erneut verbinden. Das Telefonat läuft weiter."));
        }, 15000);
        const cleanup = () => { window.clearTimeout(timeout); window.clearTimeout(audioDeadline); controller.signal.removeEventListener("abort", abort); };
        const abort = () => { cleanup(); socket.close(); resolve(); };
        controller.signal.addEventListener("abort", abort, { once: true });
        socket.onmessage = event => {
          if (controller.signal.aborted) return;
          window.clearTimeout(timeout);
          try {
            const data = JSON.parse(event.data);
            if (data.type === "format") { player.format(data.codec, data.streamId); setStatus("Audiostream verbunden …"); }
            else if (data.type === "audio") {
              if (player.play(data)) {
                setStatus("Gesprächsaudio empfangen");
                window.clearTimeout(audioDeadline);
                audioDeadline = window.setTimeout(() => {
                  cleanup(); socket.close(); reject(new Error("Seit 15 Sekunden keine neuen Audiodaten. Bitte erneut verbinden. Das Telefonat läuft weiter."));
                }, 15000);
              }
            } else if (data.type === "waiting") setStatus(data.message || "Warte auf Gesprächsaudio …");
            else if (data.type === "end") { ended = true; setStatus(data.message); socket.close(); }
          } catch { cleanup(); socket.close(); reject(new Error("Ungültiger Audiostream.")); }
        };
        socket.onerror = () => { cleanup(); socket.close(); reject(new Error("Live-Verbindung fehlgeschlagen. Bitte erneut starten.")); };
        socket.onclose = () => { cleanup(); ended || controller.signal.aborted ? resolve() : reject(new Error("Live-Verbindung unterbrochen. Bitte erneut starten.")); };
      });
    } catch (err) {
      if (!current?.controller.signal.aborted) setStatus(err instanceof Error ? err.message : "Mithören ist gerade nicht verfügbar.");
    } finally {
      if (session.current === current) { stop(); setLaeuft(false); }
      if (!current) freigeben();
    }
  };
  if (!zustimmung) return aktiv ? <div className="w-full space-y-2"><p className="text-xs text-muted-foreground">Für Live-Mithören die schriftliche Zustimmung beim Kontakt vor dem nächsten Anruf hinterlegen.</p><TelefonHinweis id={id} onRecording={() => {}} /></div> : null;
  if (!aktiv && !status) return null;
  return <div className="w-full space-y-2">
    {aktiv && <Button variant={laeuft ? "outline" : "secondary"} size="sm" onClick={laeuft
      ? () => { stop(); setLaeuft(false); setStatus("Mithören gestoppt. Das Telefonat läuft weiter."); }
      : starten}>{laeuft ? "Mithören stoppen" : "Live mithören"}</Button>}
    {aktiv && <TelefonHinweis id={id} onRecording={active => session.current?.player.mute(active)} />}
    {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
    {laeuft && <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>Audiopegel</span><progress aria-label="Audiopegel" max={1} value={pegel} className="h-2 w-28 accent-primary" />
    </div>}
  </div>;
}
