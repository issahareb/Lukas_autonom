import { useCallback, useEffect, useRef, useState } from "react";

export type SprachStatus = "aus" | "verbindet" | "bereit" | "hoert" | "spricht" | "fehler";
export type Gespraechszeile = { role: "user" | "assistant"; text: string };
type Abschnitt = Gespraechszeile & { start: number; ende: number };
type Sitzung = {
  peer?: RTCPeerConnection; channel?: RTCDataChannel; mikro?: MediaStream;
  audio?: HTMLAudioElement; messung?: AudioContext;
  messTimer?: ReturnType<typeof setInterval>;
  startTimer?: ReturnType<typeof setTimeout>; netzTimer?: ReturnType<typeof setTimeout>;
  iceAbbrechen?: () => void; sessionId?: string; closeToken?: string;
  schliessenGesendet?: boolean; geschlossen: boolean; bereit: boolean;
  token: string | null; zeilen: Abschnitt[]; events: Set<string>;
};
const kopf = (token: string | null): Record<string, string> => ({
  "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}),
});
function serverSchliessen(s: Sitzung) {
  if (!s.sessionId || !s.closeToken || s.schliessenGesendet) return;
  s.schliessenGesendet = true;
  void fetch("/api/lukas/live-session/" + encodeURIComponent(s.sessionId) + "/close", {
    method: "POST", credentials: "same-origin", headers: kopf(s.token),
    body: JSON.stringify({ closeToken: s.closeToken }), keepalive: true,
  }).catch(() => { /* Der Server begrenzt auch verwaiste Sitzungen. */ });
}
function aufraeumen(s: Sitzung) {
  if (s.geschlossen) return;
  s.geschlossen = true;
  clearTimeout(s.startTimer); clearTimeout(s.netzTimer); clearInterval(s.messTimer);
  s.iceAbbrechen?.();
  try {
    if (s.bereit && s.channel?.readyState === "open") s.channel.send(JSON.stringify({ type: "session.close" }));
  } catch { /* Die HTTP-Schließung bleibt als zweiter Weg. */ }
  serverSchliessen(s);
  s.mikro?.getTracks().forEach((track) => track.stop());
  s.channel?.close(); s.peer?.close();
  if (s.audio) { s.audio.pause(); s.audio.srcObject = null; s.audio.remove(); }
  void s.messung?.close().catch(() => {});
}
function iceSammeln(s: Sitzung, peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const fertig = (err?: Error) => {
      clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", aenderung);
      s.iceAbbrechen = undefined;
      err ? reject(err) : resolve();
    };
    const aenderung = () => { if (peer.iceGatheringState === "complete") fertig(); };
    const timer = setTimeout(() => fertig(new Error("Die Sprachverbindung konnte nicht aufgebaut werden.")), 10_000);
    s.iceAbbrechen = () => fertig(new Error("Sprachaufbau abgebrochen."));
    peer.addEventListener("icegatheringstatechange", aenderung);
    aenderung();
  });
}
/** Live liefert Fragmente, keine fertigen Turns. Die Lücke gruppiert nur die Anzeige. */
function transkript(s: Sitzung, event: Record<string, unknown>): Gespraechszeile[] | null {
  if (typeof event.delta !== "string" || !event.delta) return null;
  if (typeof event.start_ms !== "number" || !Number.isFinite(event.start_ms) ||
      typeof event.end_ms !== "number" || !Number.isFinite(event.end_ms)) return null;
  if (typeof event.event_id === "string") {
    if (s.events.has(event.event_id)) return null;
    s.events.add(event.event_id);
    if (s.events.size > 5000) s.events.delete(s.events.values().next().value!);
  }
  const role = event.type === "session.input_transcript.delta" ? "user" : "assistant";
  const letzte = [...s.zeilen].reverse().find((z) => z.role === role);
  if (letzte && event.start_ms >= letzte.start && event.start_ms - letzte.ende <= 750) {
    letzte.text += event.delta;
    letzte.ende = Math.max(letzte.ende, event.end_ms);
  } else s.zeilen.push({ role, text: event.delta, start: event.start_ms, ende: event.end_ms });
  s.zeilen.sort((a, b) => a.start - b.start);
  if (s.zeilen.length > 200) s.zeilen.splice(0, s.zeilen.length - 200);
  return s.zeilen.map(({ role: r, text }) => ({ role: r, text }));
}
/** GPT Live: SDP über unsere geschützte API, Audio direkt per WebRTC. */
export function useSprachsitzung() {
  const [status, setStatus] = useState<SprachStatus>("aus");
  const [fehler, setFehler] = useState<string | null>(null);
  const [zeilen, setZeilen] = useState<Gespraechszeile[]>([]);
  const [mikro, setMikro] = useState<MediaStream | null>(null);
  const [ausgabe, setAusgabe] = useState<HTMLAudioElement | null>(null);
  const aktivRef = useRef<Sitzung | null>(null);
  const beenden = useCallback(() => {
    const s = aktivRef.current;
    aktivRef.current = null;
    if (s) aufraeumen(s);
    setMikro(null); setAusgabe(null); setStatus("aus");
  }, []);
  useEffect(() => {
    window.addEventListener("pagehide", beenden);
    return () => {
      window.removeEventListener("pagehide", beenden);
      const s = aktivRef.current;
      aktivRef.current = null;
      if (s) aufraeumen(s);
    };
  }, [beenden]);
  const starten = useCallback(async () => {
    if (aktivRef.current) return;
    const s: Sitzung = { geschlossen: false, bereit: false, token: localStorage.getItem("lukas_token"), zeilen: [], events: new Set() };
    aktivRef.current = s;
    const aktuell = () => aktivRef.current === s && !s.geschlossen;
    const fehlgeschlagen = (text: string) => {
      if (!aktuell()) return;
      aktivRef.current = null;
      aufraeumen(s);
      setMikro(null); setAusgabe(null); setStatus("fehler"); setFehler(text);
    };
    setStatus("verbindet"); setFehler(null); setZeilen([]);
    s.startTimer = setTimeout(() => fehlgeschlagen("Der Aufbau der Sprachverbindung dauert zu lange. Bitte erneut versuchen."), 45_000);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined")
        throw new Error("Dieser Browser unterstützt den Sprachchat nicht. Bitte einen aktuellen Browser mit Mikrofonzugriff verwenden.");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!aktuell()) { stream.getTracks().forEach((track) => track.stop()); return; }
      s.mikro = stream; setMikro(stream);
      const audio = document.createElement("audio");
      audio.autoplay = true; audio.setAttribute("playsinline", ""); audio.style.display = "none";
      document.body.appendChild(audio); s.audio = audio;
      const peer = s.peer = new RTCPeerConnection();
      for (const track of stream.getAudioTracks()) {
        // Offen lassen: GPT Live hört und spricht gleichzeitig.
        peer.addTrack(track, stream);
        track.addEventListener("ended", () => fehlgeschlagen("Der Mikrofonzugriff wurde beendet."));
      }
      peer.addEventListener("track", (event) => {
        if (!aktuell()) return;
        const remote = event.streams[0] ?? new MediaStream([event.track]);
        audio.srcObject = remote; setAusgabe(audio);
        void audio.play().catch(() => fehlgeschlagen("Die Audio-Wiedergabe wurde blockiert. Bitte den Sprachchat erneut über „Sprechen“ starten."));
        if (s.messung) return;
        try {
          const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!Ctor) return;
          const ctx = s.messung = new Ctor();
          const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
          ctx.createMediaStreamSource(remote).connect(analyser);
          const daten = new Uint8Array(analyser.fftSize);
          let zuletztLaut = -Infinity;
          if (ctx.state === "suspended") void ctx.resume().catch(() => {});
          s.messTimer = setInterval(() => {
            if (!aktuell() || !s.bereit) return;
            analyser.getByteTimeDomainData(daten);
            const rms = Math.sqrt(daten.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / daten.length);
            if (rms > 0.012) zuletztLaut = Date.now();
            setStatus(Date.now() - zuletztLaut < 300 ? "spricht" : "hoert");
          }, 100);
        } catch { /* Pegelmessung darf die Audioverbindung nicht unterbrechen. */ }
      });
      peer.addEventListener("connectionstatechange", () => {
        if (!aktuell()) return;
        clearTimeout(s.netzTimer);
        if (peer.connectionState === "failed" || peer.connectionState === "closed") fehlgeschlagen("Die Sprachverbindung wurde unterbrochen.");
        else if (peer.connectionState === "disconnected") s.netzTimer = setTimeout(() => fehlgeschlagen("Die Sprachverbindung wurde unterbrochen."), 5000);
      });
      const channel = s.channel = peer.createDataChannel("oai-events");
      channel.addEventListener("close", () => fehlgeschlagen("Die Sprachverbindung wurde beendet."));
      channel.addEventListener("error", () => fehlgeschlagen("Die Sprachverbindung ist fehlgeschlagen."));
      channel.addEventListener("message", ({ data }) => {
        if (!aktuell() || typeof data !== "string") return;
        let event: Record<string, unknown>;
        try { event = JSON.parse(data); } catch { return; }
        if (!event || typeof event !== "object") return;
        if (event.type === "session.started") {
          s.bereit = true; clearTimeout(s.startTimer); setStatus("hoert");
        } else if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
          const neu = transkript(s, event); if (neu) setZeilen(neu);
        } else if (event.type === "session.closed") beenden();
        else if (event.type === "error") {
          const detail = event.error as { message?: unknown } | undefined;
          fehlgeschlagen(typeof detail?.message === "string" ? detail.message.slice(0, 500) : "Die Sprachsitzung meldet einen Fehler.");
        }
      });
      await peer.setLocalDescription(await peer.createOffer());
      if (!aktuell()) return;
      await iceSammeln(s, peer);
      if (!aktuell()) return;
      const offer = peer.localDescription?.sdp;
      if (!offer) throw new Error("Die Sprachverbindung konnte kein Verbindungsangebot erstellen.");
      const response = await fetch("/api/lukas/live-session", {
        method: "POST", credentials: "same-origin", headers: kopf(s.token),
        body: JSON.stringify({ sdp: offer }), signal: AbortSignal.timeout(45_000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.detail || body?.error || ("HTTP " + response.status));
      if (typeof body?.sessionId === "string") s.sessionId = body.sessionId;
      if (typeof body?.closeToken === "string") s.closeToken = body.closeToken;
      if (!aktuell()) { serverSchliessen(s); return; }
      if (typeof body?.sdp !== "string" || !body.sdp || !s.sessionId || !s.closeToken)
        throw new Error("Der Server hat keine gültige Sprachverbindung geliefert.");
      await peer.setRemoteDescription({ type: "answer", sdp: body.sdp });
    } catch (err) { fehlgeschlagen(err instanceof Error ? err.message : "Die Sprachverbindung konnte nicht gestartet werden."); }
  }, [beenden]);
  const aktiv = status === "bereit" || status === "hoert" || status === "spricht";
  return { status, fehler, zeilen, mikro, ausgabe, aktiv, starten, beenden };
}
