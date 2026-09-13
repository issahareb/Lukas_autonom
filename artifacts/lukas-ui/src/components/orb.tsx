import { useEffect, useRef, type MutableRefObject } from "react";
import orbGif from "@/assets/orb.gif";

/*
 * Lukas' Gesicht.
 *
 * Vier Zustände, und jeder sagt etwas anderes:
 *   ruhe      — da, aber nichts los. Langsames Atmen.
 *   denkt     — er arbeitet an einer Antwort. Gleichmäßiges Kreisen.
 *   hoert     — das Mikro ist offen. Der Orb folgt DEINER Stimme.
 *   spricht   — er antwortet. Der Orb folgt SEINER Stimme.
 *
 * WARUM DER PEGEL NICHT DURCH REACT LÄUFT. Er ändert sich sechzig Mal pro
 * Sekunde. Als State wäre das sechzig Renders — hier wird stattdessen in
 * einer eigenen rAF-Schleife direkt am DOM-Knoten geschraubt. React
 * entscheidet, WELCHER Zustand gilt; die Schleife entscheidet, wie stark.
 *
 * WARUM CSS-Variablen UND NICHT style.transform. Größe, Leuchten und
 * Sättigung hängen am selben Wert, werden aber von verschiedenen Regeln
 * benutzt. Eine Variable am Wurzelknoten setzen ist ein Schreibvorgang statt
 * vier — und die Übergänge bleiben in der CSS-Datei, wo sie hingehören.
 */

export type OrbZustand = "ruhe" | "denkt" | "hoert" | "spricht";

export function Orb({
  zustand,
  pegel,
  groesse = "mittel",
}: {
  zustand: OrbZustand;
  /** Fortlaufend gemessener Lautstärkepegel 0…1, siehe use-audio-pegel. */
  pegel?: MutableRefObject<number>;
  groesse?: "klein" | "mittel" | "gross";
}) {
  const wurzel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wurzel.current;
    if (!el) return;

    // Im Ruhezustand und beim Denken gibt es keine Stimme, der es zu folgen
    // gälte — dann übernimmt eine ruhige Eigenbewegung.
    const folgtStimme = zustand === "hoert" || zustand === "spricht";
    let handle = 0;
    let geglättet = 0;

    const tick = () => {
      const roh = folgtStimme ? (pegel?.current ?? 0) : 0;
      /*
       * Nachlaufen statt springen. Der Rohpegel ist zappelig; ohne diese
       * Glättung wirkt der Orb nervös statt lebendig. Schnell hoch (0.35) und
       * langsam runter (0.12) — so wie ein Ausschlag sich anfühlt: sofort da,
       * klingt nach.
       */
      const faktor = roh > geglättet ? 0.35 : 0.12;
      geglättet += (roh - geglättet) * faktor;
      el.style.setProperty("--pegel", geglättet.toFixed(3));
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [zustand, pegel]);

  return (
    <div
      ref={wurzel}
      className={`orb orb--${groesse} orb--${zustand}`}
      data-testid={`orb-${zustand}`}
      role="img"
      aria-label={
        {
          ruhe: "Lukas wartet",
          denkt: "Lukas denkt nach",
          hoert: "Lukas hört zu",
          spricht: "Lukas spricht",
        }[zustand]
      }
    >
      {/*
       * Der Schein liegt UNTER dem Bild und ist eine eigene Ebene: er darf
       * über den Rand hinauswachsen, ohne das Bild selbst zu verzerren.
       */}
      <div className="orb__schein" aria-hidden="true" />
      <img className="orb__bild" src={orbGif} alt="" aria-hidden="true" draggable={false} />
    </div>
  );
}
