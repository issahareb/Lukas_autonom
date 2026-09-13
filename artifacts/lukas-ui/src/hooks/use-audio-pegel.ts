import { useEffect, useRef } from "react";

/*
 * Der Lautstärkepegel, zu dem der Orb tanzt.
 *
 * WARUM ECHT GEMESSEN UND NICHT NACHGEAHMT. Eine Animation, die einfach
 * pulsiert, während geredet wird, sieht beim ersten Blick gleich aus — und
 * fällt in der Sekunde auseinander, in der jemand eine Pause macht oder ein
 * Wort betont. Was den Eindruck erzeugt, ist genau diese Kopplung: laut =
 * groß, leise = klein, Pause = Ruhe. Deshalb hängt hier ein echter
 * AnalyserNode an der echten Audiospur.
 *
 * ZWEI QUELLEN, DIESELBE MECHANIK:
 *   - Zuhören: der Mikrofon-Stream (MediaStream).
 *   - Sprechen: das <audio>-Element, in das die Realtime-Verbindung Lukas'
 *     Stimme schreibt (HTMLAudioElement).
 *
 * WARUM EIN ref UND KEIN state. Der Pegel ändert sich sechzig Mal pro
 * Sekunde. Als React-State wäre das sechzig Renders pro Sekunde für den
 * ganzen Teilbaum. Stattdessen schreibt der Messschleifen-Tick in ein ref,
 * und wer ihn braucht, liest ihn in seiner eigenen rAF-Schleife und fasst
 * direkt den DOM-Knoten an.
 */

/** Was gemessen werden soll. Beides zugleich ist erlaubt (lauteres gewinnt). */
export type PegelQuelle = {
  stream?: MediaStream | null;
  element?: HTMLAudioElement | null;
  /** Ohne das wird nicht gemessen — spart Audio-Kontext und rAF im Leerlauf. */
  aktiv: boolean;
};

/**
 * Misst den aktuellen Pegel (0…1) und schreibt ihn fortlaufend in das
 * zurückgegebene ref.
 */
export function useAudioPegel({ stream, element, aktiv }: PegelQuelle) {
  const pegel = useRef(0);

  useEffect(() => {
    if (!aktiv || (!stream && !element)) {
      pegel.current = 0;
      return;
    }

    type AudioCtor = typeof AudioContext;
    const Ctor: AudioCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctor) return; // Kein Web-Audio: der Orb bleibt ruhig, nichts bricht.

    const ctx = new Ctor();
    const analysers: AnalyserNode[] = [];
    let abgebrochen = false;

    const neuerAnalyser = () => {
      const a = ctx.createAnalyser();
      // Klein genug für schnelle Reaktion, groß genug um nicht zu flackern.
      a.fftSize = 512;
      a.smoothingTimeConstant = 0.75;
      analysers.push(a);
      return a;
    };

    try {
      if (stream) {
        ctx.createMediaStreamSource(stream).connect(neuerAnalyser());
      }
      if (element) {
        /*
         * ACHTUNG, eine Falle: createMediaElementSource leitet den Ton des
         * Elements in den Audio-Graphen UM. Wird er dort nicht wieder zum
         * Ausgang geführt, ist Lukas schlagartig stumm — man misst dann eine
         * Stimme, die niemand mehr hört.
         *
         * Und es geht nur EINMAL pro Element: ein zweiter Aufruf wirft. Die
         * Quelle wird deshalb am Element selbst vermerkt und wiederverwendet.
         */
        const merker = element as HTMLAudioElement & { __quelle?: MediaElementAudioSourceNode };
        const quelle = merker.__quelle ?? ctx.createMediaElementSource(element);
        merker.__quelle = quelle;
        const a = neuerAnalyser();
        quelle.connect(a);
        quelle.connect(ctx.destination);
      }
    } catch {
      // Ein nicht analysierbarer Stream darf das Gespräch nicht kosten.
      void ctx.close();
      return;
    }

    // Manche Browser starten den Kontext angehalten; ohne das bleibt der
    // Pegel stur auf null und der Orb steht still.
    if (ctx.state === "suspended") void ctx.resume();

    const puffer = new Uint8Array(analysers[0]?.frequencyBinCount ?? 0);
    let handle = 0;

    const messen = () => {
      if (abgebrochen) return;
      let lauteste = 0;
      for (const a of analysers) {
        a.getByteTimeDomainData(puffer);
        // Effektivwert statt Spitzenwert: der folgt der empfundenen
        // Lautstärke, statt bei jedem Knacken auszuschlagen.
        let summe = 0;
        for (let i = 0; i < puffer.length; i++) {
          const v = (puffer[i] - 128) / 128;
          summe += v * v;
        }
        lauteste = Math.max(lauteste, Math.sqrt(summe / puffer.length));
      }
      // Sprache liegt praktisch nie über ~0.4 RMS — ohne das Anheben bliebe
      // der Orb selbst bei normaler Lautstärke fast regungslos.
      pegel.current = Math.min(1, lauteste * 2.8);
      handle = requestAnimationFrame(messen);
    };
    handle = requestAnimationFrame(messen);

    return () => {
      abgebrochen = true;
      cancelAnimationFrame(handle);
      pegel.current = 0;
      void ctx.close();
    };
  }, [stream, element, aktiv]);

  return pegel;
}
