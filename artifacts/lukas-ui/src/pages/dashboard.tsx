import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useGetLukasDashboard } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import {
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  Brain,
  ChevronRight,
  Network,
  Paperclip,
  Target,
  X,
} from "lucide-react";
import { Orb, type OrbZustand } from "@/components/orb";
import { WartetAufDich } from "@/components/wartet-auf-dich";
import { useSprachsitzung } from "@/hooks/use-sprachsitzung";
import { useAudioPegel } from "@/hooks/use-audio-pegel";
import "./dashboard.css";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const eingabe = useRef<HTMLTextAreaElement>(null);
  const sprache = useSprachsitzung();
  const { data, isError, refetch } = useGetLukasDashboard();
  const pegel = useAudioPegel({
    stream: sprache.status === "hoert" ? sprache.mikro : null,
    element: sprache.aktiv ? sprache.ausgabe : null,
    aktiv: sprache.aktiv,
  });
  const tippt = text.trim().length > 0;
  const zustand: OrbZustand =
    sprache.status === "spricht"
      ? "spricht"
      : sprache.status === "hoert"
        ? "hoert"
        : sprache.status === "verbindet"
          ? "denkt"
          : "ruhe";
  useEffect(() => {
    const el = eingabe.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
    }
  }, [text]);
  function absenden() {
    const frage = text.trim();
    if (!frage) return;
    sessionStorage.setItem("lukas_startfrage", frage);
    setText("");
    navigate("/chat");
  }
  const status = data?.status,
    tagebuch = data?.recentDiary?.[0],
    erinnerung = data?.recentMemories?.[0];
  const letzteZeile = sprache.zeilen[sprache.zeilen.length - 1];
  const seit = (value: Date | string | null | undefined) => {
    if (!value) return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? undefined
      : formatDistanceToNow(d, { addSuffix: true, locale: de });
  };
  const sprachText =
    sprache.status === "spricht"
      ? "Lukas spricht"
      : sprache.status === "hoert"
        ? "Ich höre dir zu"
        : sprache.status === "verbindet"
          ? "Verbindung wird aufgebaut"
          : "Ein Gedanke reicht.";
  return (
    <div className="home-page">
      <header className="home-heading">
        <div>
          <p>DEIN PERSÖNLICHER RAUM</p>
          <h1>
            Hey Issa<span>.</span>
          </h1>
        </div>
        <button
          type="button"
          className="home-profile"
          onClick={() => navigate("/zugaenge")}
          aria-label="Zugänge verwalten"
        >
          IH
        </button>
      </header>
      <div className="home-pending">
        <WartetAufDich kompakt />
      </div>
      <div className="home-columns">
        <section
          className={`home-conversation ${sprache.aktiv ? "is-active" : ""}`}
          aria-label="Mit Lukas sprechen oder schreiben"
        >
          <div className="home-orb">
            <Orb zustand={zustand} pegel={pegel} groesse="mittel" />
          </div>
          <p className="home-voice-state" aria-live="polite">
            {sprachText}
          </p>
          <h2>
            {sprache.aktiv ? (
              "Ich bin ganz Ohr."
            ) : (
              <>
                Was machen
                <br />
                wir heute?
              </>
            )}
          </h2>
          {sprache.aktiv && letzteZeile && (
            <p className="home-transcript">
              <span>{letzteZeile.role === "user" ? "Du" : "Lukas"}</span>
              {letzteZeile.text}
            </p>
          )}
          {sprache.fehler && (
            <p className="home-voice-error" role="alert">
              {sprache.fehler}
            </p>
          )}
          <div className="home-composer">
            <textarea
              ref={eingabe}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  absenden();
                }
              }}
              rows={1}
              placeholder={
                sprache.aktiv ? "Oder schreib mir …" : "Frag mich etwas …"
              }
              aria-label="Frage an Lukas"
            />
            <div className="home-composer-actions">
              <button
                type="button"
                className="home-attach"
                onClick={() => navigate("/chat")}
                aria-label="Datei anhängen (im Chat)"
              >
                <Paperclip size={19} />
              </button>
              <span>Dein nächster Schritt beginnt hier.</span>
              {tippt ? (
                <button
                  type="button"
                  className="home-send"
                  onClick={absenden}
                  aria-label="Senden"
                >
                  <ArrowUp size={21} />
                </button>
              ) : (
                <button
                  type="button"
                  className={`home-speak ${sprache.aktiv ? "is-active" : ""}`}
                  onClick={sprache.aktiv ? sprache.beenden : sprache.starten}
                  disabled={sprache.status === "verbindet"}
                  aria-label={
                    sprache.aktiv ? "Gespräch beenden" : "Mit Lukas sprechen"
                  }
                >
                  {sprache.aktiv ? <X size={18} /> : <AudioLines size={18} />}
                  <span>{sprache.aktiv ? "Beenden" : "Sprechen"}</span>
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            className="home-brain-link"
            onClick={() => navigate("/gehirn")}
          >
            <Network size={16} aria-hidden="true" />
            Ein Blick in Lukas’ Gehirn
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </section>
        <div className="home-context">
          {isError && (
            <div className="home-fetch-error" role="alert">
              Der aktuelle Stand ist gerade nicht erreichbar.
              <button type="button" onClick={() => refetch()}>
                Erneut laden
              </button>
            </div>
          )}
          <div className="home-section-heading">
            <h2>Gerade bei Lukas</h2>
            <span>IM FOKUS</span>
          </div>
          <button
            type="button"
            className="home-focus"
            onClick={() => navigate("/goals")}
          >
            <div className="home-focus-top">
              <span>
                <Target size={15} aria-hidden="true" />
                Aktuelles Thema
              </span>
              <ArrowUpRight size={19} aria-hidden="true" />
            </div>
            <h3>
              {status?.obsession ||
                (status ? "Raum für neue Ideen" : "Wird geladen …")}
            </h3>
            <div className="home-mood">
              <span className="home-mood-dot" />
              <span>{status?.mood ?? "Stimmung lädt …"}</span>
              {status && <small>Energie: {status.energy}</small>}
            </div>
          </button>
          <div className="home-metrics">
            <button type="button" onClick={() => navigate("/memory")}>
              <Brain size={20} aria-hidden="true" />
              <span>
                {status
                  ? `${status.memoriesCount} Erinnerungen`
                  : "Gedächtnis lädt …"}
              </span>
              <small>Was bleibt</small>
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => navigate("/goals")}>
              <Target size={20} aria-hidden="true" />
              <span>
                {status
                  ? `${status.activeGoalsCount} aktive Ziele`
                  : "Ziele laden …"}
              </span>
              <small>Was als Nächstes kommt</small>
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="home-section-heading home-recent-heading">
            <h2>Zuletzt festgehalten</h2>
          </div>
          <div className="home-recent">
            <button type="button" onClick={() => navigate("/diary")}>
              <span className="home-recent-icon">
                <BookOpen size={18} aria-hidden="true" />
              </span>
              <span>
                <small>
                  Tagebuch
                  {tagebuch?.createdAt
                    ? ` · ${seit(tagebuch.createdAt) ?? ""}`
                    : ""}
                </small>
                <span>{tagebuch?.content || "Noch kein Eintrag"}</span>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => navigate("/memory")}>
              <span className="home-recent-icon">
                <Brain size={18} aria-hidden="true" />
              </span>
              <span>
                <small>Erinnerung</small>
                <span>{erinnerung?.content || "Noch nichts festgehalten"}</span>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          {status?.note && <p className="home-status-note">{status.note}</p>}
        </div>
      </div>
    </div>
  );
}
