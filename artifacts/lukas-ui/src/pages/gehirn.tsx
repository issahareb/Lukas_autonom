import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Layers3,
  List,
  Loader2,
  Minus,
  Maximize2,
  Minimize2,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  ARTEN,
  BEREICHE,
  bereich,
  normalisiere,
  umfeld,
  type Gehirn,
  type Knoten,
  type Raum,
} from "@/components/gehirn/modell";
import { erschaffeSzene, type Szene } from "@/components/gehirn/szene";
import "@/components/gehirn/gehirn.css";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("lukas_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
function zeit(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "Unbekannt"
    : new Intl.DateTimeFormat("de-DE", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(d);
}
const farbe = (k: Knoten) =>
  k.art === "identitaet" ? "#e8f2ff" : BEREICHE[bereich(k.art)].farbe;

export default function GehirnSeite() {
  const [daten, setDaten] = useState<Gehirn | null>(null);
  const [layout, setLayout] = useState<{ daten: Gehirn; raum: Raum } | null>(
    null,
  );
  const raum = layout?.daten === daten ? (layout?.raum ?? null) : null;
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [raumFehler, setRaumFehler] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [szeneRevision, setSzeneRevision] = useState(0);
  const [suche, setSuche] = useState("");
  const [region, setRegion] = useState<number | null>(null);
  const [auswahl, setAuswahl] = useState<string | null>(null);
  const [tiefe, setTiefe] = useState(1);
  const [bewegung, setBewegung] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [ansicht, setAnsicht] = useState<"raum" | "liste">("raum");
  const [exportiert, setExportiert] = useState(false);
  const [exportLaedt, setExportLaedt] = useState(false);
  const [hilfe, setHilfe] = useState(false);
  const [invertiert, setInvertiert] = useState(() => {
    try {
      return localStorage.getItem("lukas_gehirn_invertiert") !== "false";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("lukas_gehirn_invertiert", String(invertiert));
    } catch {
      /* Private browsing may disable storage. */
    }
  }, [invertiert]);
  const [gross, setGross] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stage.current,
      scroller = el?.closest(".app-scroll");
    if (gross && el && scroller)
      scroller.scrollTo({
        top:
          scroller.scrollTop +
          el.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top,
        behavior: "instant",
      });
  }, [gross]);
  const [limit, setLimit] = useState(40);
  const box = useRef<HTMLDivElement>(null),
    labels = useRef<HTMLDivElement>(null);
  const szene = useRef<Szene | null>(null);
  const workerSequence = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    setLaedt(true);
    setFehler(null);
    fetch(`${BASE}/api/lukas/gehirn`, {
      headers: authHeaders(),
      signal: abort.signal,
    })
      .then((r) => {
        if (!r.ok)
          throw new Error(
            `Gedächtnis konnte nicht geladen werden (HTTP ${r.status}).`,
          );
        return r.json();
      })
      .then((g) => {
        if (!abort.signal.aborted) {
          setDaten(normalisiere(g));
          setAuswahl(null);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setFehler(
            e instanceof Error ? e.message : "Gedächtnis nicht erreichbar.",
          );
      })
      .finally(() => {
        if (!abort.signal.aborted) setLaedt(false);
      });
    return () => abort.abort();
  }, [revision]);

  useEffect(() => {
    if (!daten?.knoten.length) {
      setLayout(null);
      return;
    }
    const sequence = ++workerSequence.current;
    let worker: Worker | null = null;
    setLayout(null);
    setRaumFehler(null);
    try {
      worker = new Worker(
        new URL("../components/gehirn/layout.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (
        e: MessageEvent<{ raum?: Raum; fehler?: string }>,
      ) => {
        if (sequence !== workerSequence.current) return;
        if (e.data.raum) setLayout({ daten, raum: e.data.raum });
        else
          setRaumFehler(
            e.data.fehler || "Die Raumansicht ist nicht verfügbar.",
          );
        worker?.terminate();
      };
      worker.onerror = () => {
        if (sequence === workerSequence.current)
          setRaumFehler(
            "Die Raumansicht ist nicht verfügbar. Alle Einträge findest du in der Liste.",
          );
        worker?.terminate();
      };
      worker.postMessage(daten);
    } catch {
      setRaumFehler(
        "Dieses Gerät kann die Raumansicht nicht öffnen. Alle Einträge findest du in der Liste.",
      );
    }
    return () => {
      ++workerSequence.current;
      worker?.terminate();
    };
  }, [daten, szeneRevision]);

  const knotenIndex = useMemo(
    () => new Map(daten?.knoten.map((k) => [k.id, k]) ?? []),
    [daten],
  );
  const gewaehlt = auswahl ? (knotenIndex.get(auswahl) ?? null) : null;
  const sichtbar = useMemo(
    () =>
      new Set(
        daten?.knoten
          .filter(
            (k) =>
              region === null ||
              k.art === "identitaet" ||
              bereich(k.art) === region,
          )
          .map((k) => k.id) ?? [],
      ),
    [daten, region],
  );
  const treffer = useMemo(() => {
    const q = suche.trim().toLocaleLowerCase("de");
    return q && daten
      ? new Set(
          daten.knoten
            .filter((k) =>
              `${k.titel} ${k.text} ${ARTEN[k.art] ?? k.art}`
                .toLocaleLowerCase("de")
                .includes(q),
            )
            .map((k) => k.id),
        )
      : null;
  }, [suche, daten]);
  const nachbarn = useMemo(
    () =>
      daten
        ? umfeld(daten, auswahl, sichtbar, tiefe)
        : new Map<string, number>(),
    [daten, auswahl, sichtbar, tiefe],
  );
  const counts = useMemo(
    () =>
      BEREICHE.map(
        (_, i) =>
          daten?.knoten.filter(
            (k) => k.art !== "identitaet" && bereich(k.art) === i,
          ).length ?? 0,
      ),
    [daten],
  );
  const grad = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of daten?.kanten ?? [])
      for (const id of [e.von, e.nach]) map.set(id, (map.get(id) ?? 0) + 1);
    return map;
  }, [daten]);
  const ergebnisse = useMemo(
    () =>
      (daten?.knoten ?? [])
        .filter((k) => sichtbar.has(k.id) && (!treffer || treffer.has(k.id)))
        .sort(
          (a, b) =>
            (grad.get(b.id) ?? 0) - (grad.get(a.id) ?? 0) ||
            b.gewicht - a.gewicht,
        ),
    [daten, sichtbar, treffer, grad],
  );
  const verbindungen = useMemo(
    () =>
      (daten?.kanten ?? []).filter(
        (e) => e.von === auswahl || e.nach === auswahl,
      ),
    [daten, auswahl],
  );
  const sichtbareKanten = useMemo(
    () =>
      daten?.kanten.filter((e) => sichtbar.has(e.von) && sichtbar.has(e.nach))
        .length ?? 0,
    [daten, sichtbar],
  );
  const waehle = useCallback((id: string | null) => {
    setAuswahl(id);
    if (id) setSuche("");
    setTiefe(1);
  }, []);

  useEffect(() => {
    if (
      !daten ||
      !raum ||
      !box.current ||
      !labels.current ||
      ansicht !== "raum"
    )
      return;
    let instance: Szene | null = null;
    try {
      instance = erschaffeSzene(
        box.current,
        labels.current,
        daten,
        raum,
        waehle,
        setRaumFehler,
      );
      szene.current = instance;
    } catch {
      setRaumFehler(
        "3D ist auf diesem Gerät gerade nicht verfügbar. Du kannst alle Einträge in der Liste öffnen.",
      );
    }
    return () => {
      instance?.dispose();
      if (szene.current === instance) szene.current = null;
    };
  }, [daten, raum, ansicht, waehle]);
  useEffect(() => {
    szene.current?.update({
      sichtbar,
      umfeld: nachbarn,
      treffer,
      auswahl,
      bewegung,
      invertiert,
    });
  }, [
    sichtbar,
    nachbarn,
    treffer,
    auswahl,
    bewegung,
    invertiert,
    raum,
    ansicht,
  ]);
  useEffect(() => {
    szene.current?.fokus(auswahl);
  }, [auswahl, raum, ansicht, region, tiefe]);
  useEffect(() => {
    setLimit(40);
  }, [suche, region, auswahl]);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => {
      if (motion.matches) setBewegung(false);
    };
    motion.addEventListener("change", changed);
    return () => motion.removeEventListener("change", changed);
  }, []);

  const reset = () => {
    setAuswahl(null);
    setSuche("");
    setRegion(null);
    setTiefe(1);
    szene.current?.fokus(null);
  };
  const wechseln = (r: number | null) => {
    setRegion(r);
    setAuswahl(null);
    szene.current?.fokus(null);
  };
  async function exportieren() {
    setExportLaedt(true);
    setFehler(null);
    setExportiert(false);
    try {
      const res = await fetch(`${BASE}/api/lukas/gehirn/vault.zip`, {
        headers: authHeaders(),
      });
      if (!res.ok)
        throw new Error(`Export fehlgeschlagen (HTTP ${res.status}).`);
      const url = URL.createObjectURL(await res.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = `lukas-gehirn-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportiert(true);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : "Export fehlgeschlagen.");
    } finally {
      setExportLaedt(false);
    }
  }
  function knotenZeile(k: Knoten) {
    return (
      <button
        type="button"
        key={k.id}
        className="gehirn-entry"
        onClick={() => waehle(k.id)}
        aria-pressed={auswahl === k.id}
      >
        <span className="gehirn-entry-dot" style={{ background: farbe(k) }} />
        <span className="gehirn-entry-text">
          <span>{k.titel}</span>
          <small>
            {ARTEN[k.art] ?? k.art} · {grad.get(k.id) ?? 0} Verbindungen
          </small>
        </span>
        <ArrowUpRight size={15} aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="gehirn-page">
      <header className="gehirn-heading">
        <div>
          <p className="gehirn-eyebrow">LUKAS / GEDÄCHTNIS</p>
          <h1>
            Gehirn<span>.</span>
          </h1>
          <p className="gehirn-subtitle">
            Erinnerungen. Beziehungen. Zusammenhänge.
          </p>
        </div>
        <div className="gehirn-heading-actions">
          <button
            type="button"
            className="gehirn-button"
            onClick={() => setRevision((v) => v + 1)}
            disabled={laedt}
          >
            <RefreshCw
              size={15}
              className={laedt ? "animate-spin" : ""}
              aria-hidden="true"
            />
            <span>Aktualisieren</span>
          </button>
          <button
            type="button"
            className="gehirn-button"
            onClick={exportieren}
            disabled={!daten || exportLaedt}
          >
            {exportLaedt ? (
              <Loader2 size={15} className="animate-spin" />
            ) : exportiert ? (
              <Check size={15} />
            ) : (
              <ArrowDownToLine size={15} />
            )}
            <span>Obsidian-Vault</span>
          </button>
        </div>
      </header>
      {fehler && (
        <div className="gehirn-error" role="alert">
          {fehler}
        </div>
      )}
      <div className="gehirn-workspace">
        <section className="gehirn-main" aria-label="Gedächtniskarte">
          <div className="gehirn-toolbar">
            <label className="gehirn-search">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={suche}
                onChange={(e) => {
                  setSuche(e.target.value);
                  setAuswahl(null);
                }}
                placeholder="Eine Erinnerung, ein Thema …"
                aria-label="Im Gehirn suchen"
              />
              {suche && (
                <button
                  type="button"
                  onClick={() => setSuche("")}
                  aria-label="Suche löschen"
                >
                  <X size={15} />
                </button>
              )}
            </label>
            <div className="gehirn-view-switch" aria-label="Darstellung">
              <button
                type="button"
                onClick={() => setAnsicht("raum")}
                aria-pressed={ansicht === "raum"}
              >
                <Layers3 size={15} aria-hidden="true" />
                Raum
              </button>
              <button
                type="button"
                onClick={() => setAnsicht("liste")}
                aria-pressed={ansicht === "liste"}
              >
                <List size={15} aria-hidden="true" />
                Liste
              </button>
            </div>
          </div>
          <div className="gehirn-regions" aria-label="Wissensbereiche">
            <button
              type="button"
              aria-pressed={region === null}
              onClick={() => wechseln(null)}
            >
              Alles
            </button>
            {BEREICHE.map((b, i) => (
              <button
                type="button"
                key={b.name}
                aria-label={`${b.name}, ${counts[i]} Einträge`}
                aria-pressed={region === i}
                onClick={() => wechseln(region === i ? null : i)}
                disabled={!counts[i]}
              >
                <span style={{ background: b.farbe }} />
                {b.name}
                <small>{counts[i]}</small>
              </button>
            ))}
          </div>
          {ansicht === "raum" ? (
            <div
              ref={stage}
              className={`gehirn-stage ${gross ? "is-expanded" : ""}`}
              data-testid="gehirn-stage"
            >
              <div className="gehirn-canvas" ref={box} />
              <div className="gehirn-labels" ref={labels} />
              <div className="gehirn-stage-top">
                <span className="gehirn-stage-caption">
                  {gewaehlt
                    ? "VERBINDUNGEN IM FOKUS"
                    : region === null
                      ? "DAS GANZE IM BLICK"
                      : BEREICHE[region].name.toLocaleUpperCase("de")}
                </span>
                <button
                  type="button"
                  className="gehirn-expand"
                  onClick={() => setGross((v) => !v)}
                  aria-label={
                    gross ? "Ansicht verkleinern" : "Ansicht vergrößern"
                  }
                  aria-pressed={gross}
                >
                  {gross ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
              </div>
              {((laedt && !daten) ||
                (daten && daten.knoten.length > 0 && !raum && !raumFehler)) && (
                <div className="gehirn-stage-message" role="status">
                  <Loader2 size={24} className="animate-spin" />
                  <span>
                    {laedt
                      ? "Gedächtnis wird geladen …"
                      : "Verbindungen nehmen Form an …"}
                  </span>
                </div>
              )}
              {raumFehler && (
                <div className="gehirn-stage-message" role="status">
                  <Network size={28} />
                  <p>{raumFehler}</p>
                  <div className="gehirn-inline">
                    <button
                      type="button"
                      className="gehirn-button"
                      onClick={() => setAnsicht("liste")}
                    >
                      Einträge anzeigen
                    </button>
                    <button
                      type="button"
                      className="gehirn-button"
                      onClick={() => setSzeneRevision((v) => v + 1)}
                    >
                      3D erneut laden
                    </button>
                  </div>
                </div>
              )}
              {!laedt && daten && !daten.knoten.length && (
                <div className="gehirn-stage-message">
                  <Network size={28} />
                  <span>Hier entsteht Lukas’ Gedächtniskarte.</span>
                  <small>Noch keine Einträge vorhanden.</small>
                </div>
              )}
              {gewaehlt && raum && !raumFehler && (
                <button
                  className="gehirn-dive"
                  type="button"
                  onClick={() => szene.current?.eintauchen(gewaehlt.id)}
                >
                  <ArrowUpRight size={18} /> Hineinfliegen: {gewaehlt.titel}
                </button>
              )}
              {raum && !raumFehler && (
                <div className="gehirn-stage-bottom">
                  <button
                    type="button"
                    className="gehirn-stage-reset"
                    onClick={reset}
                  >
                    <ArrowLeft size={15} aria-hidden="true" />
                    Überblick
                  </button>
                  <div className="gehirn-stage-tools">
                    <button
                      type="button"
                      onClick={() => szene.current?.zoom(1.2)}
                      aria-label="Herauszoomen"
                    >
                      <Minus size={17} />
                    </button>
                    <button
                      type="button"
                      onClick={() => szene.current?.zoom(0.8)}
                      aria-label="Hineinzoomen"
                    >
                      <Plus size={17} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setBewegung((v) => !v)}
                      aria-label={
                        bewegung ? "Bewegung pausieren" : "Bewegung starten"
                      }
                      aria-pressed={bewegung}
                    >
                      {bewegung ? <Pause size={15} /> : <Play size={15} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setHilfe((v) => !v)}
                      aria-label="Darstellung erklären"
                      aria-expanded={hilfe}
                    >
                      <CircleHelp size={17} />
                    </button>
                  </div>
                </div>
              )}
              {hilfe && (
                <div className="gehirn-help">
                  <button
                    type="button"
                    onClick={() => setHilfe(false)}
                    aria-label="Hilfe schließen"
                  >
                    <X size={15} />
                  </button>
                  <strong>Eine Karte seines Gedächtnisses</strong>
                  <label className="gehirn-direction">
                    <input
                      type="checkbox"
                      checked={invertiert}
                      onChange={(e) => setInvertiert(e.target.checked)}
                    />
                    Drehrichtung umkehren
                  </label>
                  <p>
                    Mit einem Finger das Modell drehen. Zwei Finger auseinander
                    zoomt hinein, zusammen zoomt heraus. Mit zwei Fingern
                    gemeinsam verschieben. Tippen wählt einen Eintrag.
                    „Hineinfliegen“ bringt dich an dieses Neuron und dreht
                    anschließend um dieses Neuron. „Überblick“ führt zurück zum
                    gesamten Netzwerk.
                  </p>
                  <p>
                    Die Impulse zeichnen ausgewählte Beziehungen nach. Sie
                    zeigen keine Live-Aktivität. Feine Verästelungen gehören zur
                    Gestaltung der Knoten.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div
              className="gehirn-list-view"
              aria-label="Alle sichtbaren Einträge"
            >
              {ergebnisse.slice(0, limit).map(knotenZeile)}
              {ergebnisse.length > limit && (
                <button
                  type="button"
                  className="gehirn-button"
                  onClick={() => setLimit((v) => v + 60)}
                >
                  Weitere Einträge ({ergebnisse.length - limit})
                </button>
              )}
              {!ergebnisse.length && (
                <p className="gehirn-empty">
                  {laedt
                    ? "Gedächtnis wird geladen …"
                    : "Keine passenden Einträge."}
                </p>
              )}
            </div>
          )}
          <footer className="gehirn-status">
            <span>
              <strong>{sichtbar.size.toLocaleString("de")}</strong> Knoten
              <span className="gehirn-status-dot">·</span>
              <strong>{sichtbareKanten.toLocaleString("de")}</strong>{" "}
              Verbindungen
            </span>
            <span>
              {daten
                ? `Stand ${zeit(daten.stand)}`
                : "Momentaufnahme wird geladen"}
            </span>
          </footer>
        </section>
        <aside
          className="gehirn-inspector"
          aria-label={gewaehlt ? "Ausgewählter Eintrag" : "Gedächtnis erkunden"}
        >
          {gewaehlt ? (
            <>
              <div className="gehirn-inspector-top">
                <span
                  className="gehirn-eyebrow"
                  style={{ color: farbe(gewaehlt) }}
                >
                  {ARTEN[gewaehlt.art] ?? gewaehlt.art}
                </span>
                <button
                  type="button"
                  className="gehirn-icon-button"
                  onClick={() => waehle(null)}
                  aria-label="Auswahl schließen"
                >
                  <X size={18} />
                </button>
              </div>
              <h2>{gewaehlt.titel}</h2>
              {gewaehlt.text && (
                <p className="gehirn-content">{gewaehlt.text}</p>
              )}
              {Object.keys(gewaehlt.daten).length > 0 && (
                <dl className="gehirn-metadata">
                  {Object.entries(gewaehlt.daten).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="gehirn-connections-heading">
                <h3>
                  Verbindungen <span>{verbindungen.length}</span>
                </h3>
                <label>
                  Umfeld
                  <select
                    aria-label="Verbindungstiefe"
                    value={tiefe}
                    onChange={(e) => setTiefe(Number(e.target.value))}
                  >
                    <option value={1}>1 Ebene</option>
                    <option value={2}>2 Ebenen</option>
                  </select>
                </label>
              </div>
              {region !== null && (
                <p className="gehirn-note">
                  Der Bereichsfilter begrenzt den Raum. Die Liste zeigt alle
                  direkten Beziehungen.
                </p>
              )}
              <div className="gehirn-connection-list">
                {verbindungen.slice(0, limit).map((e, i) => {
                  const other = knotenIndex.get(
                    e.von === auswahl ? e.nach : e.von,
                  );
                  if (!other) return null;
                  return (
                    <button
                      type="button"
                      className="gehirn-connection"
                      key={`${other.id}-${i}`}
                      onClick={() => {
                        if (!sichtbar.has(other.id)) setRegion(null);
                        waehle(other.id);
                      }}
                    >
                      <span style={{ background: farbe(other) }} />
                      <span>
                        <small>
                          {e.von === auswahl ? `→ ${e.art}` : `← ${e.art}`}
                        </small>
                        <span>{other.titel}</span>
                      </span>
                      <ChevronRight size={15} aria-hidden="true" />
                    </button>
                  );
                })}
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
          ) : (
            <>
              <p className="gehirn-eyebrow">
                {treffer ? "SUCHE" : "ENTDECKEN"}
              </p>
              <h2>
                {treffer
                  ? "Gefunden im Gedächtnis"
                  : "Wo möchtest du anfangen?"}
              </h2>
              <p className="gehirn-inspector-intro">
                {treffer
                  ? `${ergebnisse.length} passende Einträge im gewählten Bereich.`
                  : "Öffne einen Knoten und folge seinen Verbindungen."}
              </p>
              {!treffer && (
                <div
                  className="gehirn-distribution"
                  aria-label="Anteile der Wissensbereiche"
                >
                  {BEREICHE.map((b, i) =>
                    counts[i] ? (
                      <span
                        key={b.name}
                        style={{ flex: counts[i], background: b.farbe }}
                        title={`${b.name}: ${counts[i]}`}
                      />
                    ) : null,
                  )}
                </div>
              )}
              <div className="gehirn-discovery-list">
                {ergebnisse.slice(0, treffer ? limit : 8).map(knotenZeile)}
              </div>
              {treffer && ergebnisse.length > limit && (
                <button
                  type="button"
                  className="gehirn-button"
                  onClick={() => setLimit((v) => v + 40)}
                >
                  Weitere Treffer
                </button>
              )}
              {!treffer && ergebnisse.length > 8 && (
                <button
                  type="button"
                  className="gehirn-all"
                  onClick={() => setAnsicht("liste")}
                >
                  Alle {ergebnisse.length} Einträge ansehen
                  <ArrowUpRight size={16} aria-hidden="true" />
                </button>
              )}
              {!ergebnisse.length && !laedt && (
                <p className="gehirn-note">
                  Keine Einträge gefunden. Passe die Suche oder den Bereich an.
                </p>
              )}
            </>
          )}
        </aside>
      </div>
      <div className="gehirn-sr" role="status" aria-live="polite">
        {gewaehlt
          ? `${gewaehlt.titel} ausgewählt. ${verbindungen.length} direkte Verbindungen.`
          : treffer
            ? `${ergebnisse.length} Suchtreffer.`
            : ""}
      </div>
    </div>
  );
}
