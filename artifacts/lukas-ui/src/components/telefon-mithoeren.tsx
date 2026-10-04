import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { aktiviereTelefonWiedergabe, TelefonAudio } from "@/lib/telefon-audio";
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
      const response = await fetch(`${BASE}/api/lukas/telefon/anrufe/${id}/live`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal,
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Live-Mithören konnte nicht verbunden werden.");
      if (!response.body) throw new Error("Kein Audiostream verfügbar.");
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let pending = "", ended = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (controller.signal.aborted) return;
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          if (pending.length > 131072) throw new Error("Audiostream unterbrochen. Bitte erneut verbinden.");
          const events = pending.split("\n\n"); pending = events.pop()!;
          for (const event of events) {
            if (!event.startsWith("data: ")) continue;
            const data = JSON.parse(event.slice(6));
            if (data.type === "format") player.format(data.codec, data.streamId);
            else if (data.type === "audio") {
              if (player.play(data)) setStatus("Gesprächsaudio empfangen · Mikrofon aus");
            } else if (data.type === "waiting") setStatus(data.message || "Warte auf Gesprächsaudio …");
            else if (data.type === "end") { setStatus(data.message); ended = true; break; }
          }
          if (ended) break;
        }
        if (!ended) throw new Error("Live-Verbindung unterbrochen. Bitte erneut starten.");
      } finally { await reader.cancel().catch(() => {}); }
    } catch (err) {
      if (!current?.controller.signal.aborted) setStatus(err instanceof Error ? err.message : "Mithören ist gerade nicht verfügbar.");
    } finally {
      if (session.current === current) { stop(); setLaeuft(false); }
      if (!current) freigeben();
    }
  };
  if (!zustimmung) return aktiv ? <p className="w-full text-xs text-muted-foreground">Für Live-Mithören die schriftliche Zustimmung beim Kontakt vor dem nächsten Anruf hinterlegen.</p> : null;
  if (!aktiv && !status) return null;
  return <div className="w-full space-y-2">
    {aktiv && <Button variant={laeuft ? "outline" : "secondary"} size="sm" onClick={laeuft
      ? () => { stop(); setLaeuft(false); setStatus("Mithören gestoppt. Das Telefonat läuft weiter."); }
      : starten}>{laeuft ? "Mithören stoppen" : "Live mithören"}</Button>}
    {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
    {laeuft && <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>Audiopegel</span><progress aria-label="Audiopegel" max={1} value={pegel} className="h-2 w-28 accent-primary" />
    </div>}
  </div>;
}
