import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Copy, X } from "lucide-react";
import { ARTEN, BEREICHE, bereich, type Knoten } from "./modell";

type Verbindung = { knoten: Knoten; beziehung: string; key: string };
type Props = {
  knoten: Knoten;
  verbindungen: Verbindung[];
  zurueck: boolean;
  onZurueck: () => void;
  onSchliessen: () => void;
  onWaehlen: (id: string) => void;
  tiefe: number;
  onTiefe: (tiefe: number) => void;
  gefiltert: boolean;
};
const farbe = (k: Knoten) =>
  k.art === "identitaet" ? "#e8f2ff" : BEREICHE[bereich(k.art)].farbe;

/** Vollständiger Text und Beziehungen teilen dieselbe Navigation. */
export function GehirnEintrag(props: Props) {
  const { knoten, verbindungen } = props;
  const [ansicht, setAnsicht] = useState<"inhalt" | "verbindungen">("inhalt");
  const [kopiert, setKopiert] = useState(false);
  const [fehler, setFehler] = useState("");
  const [limit, setLimit] = useState(40);
  const body = useRef<HTMLDivElement>(null);
  const copySequence = useRef(0);

  useEffect(() => {
    ++copySequence.current;
    setAnsicht("inhalt");
    setKopiert(false);
    setFehler("");
    setLimit(40);
    if (body.current) body.current.scrollTop = 0;
  }, [knoten.id]);
  useEffect(
    () => () => {
      ++copySequence.current;
    },
    [],
  );

  async function kopieren() {
    const sequence = ++copySequence.current;
    try {
      await navigator.clipboard.writeText(knoten.text || knoten.titel);
      if (sequence === copySequence.current) {
        setKopiert(true);
        setFehler("");
      }
    } catch {
      if (sequence === copySequence.current)
        setFehler(
          "Kopieren ist hier nicht verfügbar. Du kannst den Text markieren und kopieren.",
        );
    }
  }

  return (
    <>
      <div className="gehirn-reader-header">
        <div className="gehirn-inspector-top">
          <button
            type="button"
            className="gehirn-reader-back"
            onClick={props.zurueck ? props.onZurueck : props.onSchliessen}
            aria-label={
              props.zurueck ? "Zum vorherigen Eintrag" : "Zur Gedächtniskarte"
            }
          >
            <ArrowLeft size={18} aria-hidden="true" />
            {props.zurueck ? "Zurück" : "Karte"}
          </button>
          <span className="gehirn-eyebrow" style={{ color: farbe(knoten) }}>
            {ARTEN[knoten.art] ?? knoten.art}
          </span>
          <button
            type="button"
            className="gehirn-icon-button"
            onClick={props.onSchliessen}
            aria-label="Auswahl schließen"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="gehirn-reader-tabs" aria-label="Eintragsansicht">
          <button
            type="button"
            aria-pressed={ansicht === "inhalt"}
            onClick={() => setAnsicht("inhalt")}
          >
            Inhalt
          </button>
          <button
            type="button"
            aria-pressed={ansicht === "verbindungen"}
            onClick={() => setAnsicht("verbindungen")}
          >
            Verbindungen <span>{verbindungen.length}</span>
          </button>
        </div>
      </div>
      <div className="gehirn-reader-body" ref={body}>
        <h2>{knoten.titel}</h2>
        {ansicht === "inhalt" ? (
          <>
            <button
              type="button"
              className="gehirn-button gehirn-copy"
              onClick={kopieren}
            >
              {kopiert ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Copy size={16} aria-hidden="true" />
              )}
              {kopiert ? "Kopiert" : "Text kopieren"}
            </button>
            <span className="gehirn-sr" role="status">
              {kopiert ? "Text kopiert." : ""}
            </span>
            {fehler && (
              <p className="gehirn-note" role="alert">
                {fehler}
              </p>
            )}
            {knoten.text ? (
              <p className="gehirn-content">{knoten.text}</p>
            ) : (
              <p className="gehirn-note">
                Zu diesem Knoten ist kein weiterer Text gespeichert.
              </p>
            )}
            {Object.keys(knoten.daten).length > 0 && (
              <details className="gehirn-reader-metadata">
                <summary>Details zum Eintrag</summary>
                <dl className="gehirn-metadata">
                  {Object.entries(knoten.daten).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </>
        ) : (
          <>
            <div className="gehirn-connections-heading">
              <h3>Direkte Verbindungen</h3>
              <label>
                Umfeld
                <select
                  aria-label="Verbindungstiefe"
                  value={props.tiefe}
                  onChange={(e) => props.onTiefe(Number(e.target.value))}
                >
                  <option value={1}>1 Ebene</option>
                  <option value={2}>2 Ebenen</option>
                </select>
              </label>
            </div>
            {props.gefiltert && (
              <p className="gehirn-note">
                Der Bereichsfilter begrenzt den Raum. Hier stehen alle direkten
                Beziehungen.
              </p>
            )}
            <div className="gehirn-connection-list">
              {verbindungen
                .slice(0, limit)
                .map(({ knoten: other, beziehung, key }) => (
                  <button
                    type="button"
                    className="gehirn-connection"
                    key={key}
                    onClick={() => props.onWaehlen(other.id)}
                  >
                    <span style={{ background: farbe(other) }} />
                    <span>
                      <small>{beziehung}</small>
                      <span>{other.titel}</span>
                    </span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                ))}
            </div>
            {!verbindungen.length && (
              <p className="gehirn-note">
                Für diesen Eintrag sind noch keine Beziehungen gespeichert.
              </p>
            )}
            {verbindungen.length > limit && (
              <button
                type="button"
                className="gehirn-button"
                onClick={() => setLimit((v) => v + 60)}
              >
                Weitere Verbindungen ({verbindungen.length - limit})
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}
