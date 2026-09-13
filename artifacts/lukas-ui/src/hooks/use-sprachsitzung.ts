import { useCallback, useEffect, useRef, useState } from "react";
import { RealtimeAgent, RealtimeSession, OpenAIRealtimeWebRTC } from "@openai/agents-realtime";
import type { RealtimeItem } from "@openai/agents-realtime";

/*
 * Der Sprachkanal — als Hook, damit die Startseite ihn benutzen kann, ohne
 * das Panel mitzuschleppen.
 *
 * DER UNTERSCHIED ZUM ALTEN PANEL: die Verbindung bekommt ein EIGENES
 * <audio>-Element übergeben, statt sich selbst eines zu bauen. Nur so kommt
 * ein AnalyserNode an Lukas' Stimme — und nur so kann der Orb zu ihr tanzen
 * statt bloß zu pulsieren, während geredet wird.
 *
 * DAS MODELL KOMMT VOM SERVER. Vorher stand es hier im Browser als Zeichen-
 * kette: eine weitere Stelle, die bei jedem Wechsel vergessen wird. Der
 * Client soll nicht wissen müssen, womit er spricht.
 */

export type SprachStatus = "aus" | "verbindet" | "bereit" | "hoert" | "spricht" | "fehler";

export type Gespraechszeile = { role: "user" | "assistant"; text: string };

export function useSprachsitzung() {
  const [status, setStatus] = useState<SprachStatus>("aus");
  const [fehler, setFehler] = useState<string | null>(null);
  const [zeilen, setZeilen] = useState<Gespraechszeile[]>([]);
  // Für den Pegelmesser: beide Enden des Gesprächs.
  const [mikro, setMikro] = useState<MediaStream | null>(null);
  const [ausgabe, setAusgabe] = useState<HTMLAudioElement | null>(null);

  const sitzung = useRef<RealtimeSession | null>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);

  const beenden = useCallback(() => {
    try {
      sitzung.current?.close();
    } catch {
      /* eine bereits tote Verbindung zu schließen ist kein Fehler */
    }
    sitzung.current = null;
    mikro?.getTracks().forEach((t) => t.stop());
    setMikro(null);
    setAusgabe(null);
    setStatus("aus");
  }, [mikro]);

  // Beim Verlassen der Seite nicht das Mikro offen lassen.
  useEffect(() => () => {
    sitzung.current?.close();
    audioEl.current?.remove();
  }, []);

  const starten = useCallback(async () => {
    setStatus("verbindet");
    setFehler(null);
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
      const { value: apiKey, model } = (await res.json()) as { value: string; model?: string };

      /*
       * Eigener Mikrofon-Stream mit Echounterdrückung: ohne sie hört das
       * Mikro am Laptop-Lautsprecher Lukas' eigene Stimme mit, und er
       * unterbricht sich selbst. Das ist kein theoretischer Fall gewesen.
       */
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      setMikro(stream);

      // Das Element, an dem später der Analyser hängt. Unsichtbar, aber im
      // DOM — ein losgelöstes Element spielt in manchen Browsern nicht ab.
      let el = audioEl.current;
      if (!el) {
        el = document.createElement("audio");
        el.autoplay = true;
        el.style.display = "none";
        document.body.appendChild(el);
        audioEl.current = el;
      }
      setAusgabe(el);

      const agent = new RealtimeAgent({ name: "Lukas" });
      const s = new RealtimeSession(agent, {
        ...(model ? { model } : {}),
        transport: new OpenAIRealtimeWebRTC({ mediaStream: stream, audioElement: el }),
      });

      /*
       * Auf die rohen WebRTC-Ereignisse hören, NICHT auf session.on("audio").
       * Laut SDK wird das Audio-Ereignis "might not be triggered if the
       * transport layer handles the audio internally" — und genau das ist
       * hier der Fall. Dadurch feuerte das Stummschalten nie, das Mikro blieb
       * während der ganzen Antwort offen, und Lukas beantwortete sich selbst.
       */
      s.on("transport_event", (event) => {
        if (event.type === "output_audio_buffer.started") {
          setStatus("spricht");
          s.mute(true);
        } else if (event.type === "output_audio_buffer.stopped") {
          setStatus("hoert");
          s.mute(false);
        }
      });

      s.on("history_updated", (history: RealtimeItem[]) => {
        const neu: Gespraechszeile[] = [];
        for (const item of history) {
          if (item.type !== "message" || item.role === "system") continue;
          const text = item.content
            .map((c) => ("text" in c ? c.text : "transcript" in c ? c.transcript : ""))
            .filter((t): t is string => !!t)
            .join(" ");
          if (text) neu.push({ role: item.role === "user" ? "user" : "assistant", text });
        }
        if (neu.length) setZeilen(neu);
      });

      s.on("error", ({ error }) => {
        setStatus("fehler");
        setFehler(error instanceof Error ? error.message : "Sprachverbindung fehlgeschlagen.");
        sitzung.current = null;
        stream.getTracks().forEach((t) => t.stop());
        setMikro(null);
      });

      await s.connect({ apiKey });
      sitzung.current = s;
      setStatus("hoert");
    } catch (err) {
      setStatus("fehler");
      setFehler(err instanceof Error ? err.message : "Unbekannter Fehler");
      sitzung.current = null;
      setMikro(null);
    }
  }, []);

  const aktiv = status === "bereit" || status === "hoert" || status === "spricht";

  return { status, fehler, zeilen, mikro, ausgabe, aktiv, starten, beenden };
}
