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
  MessageSquare,
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
          : "Dein direkter Draht zu Lukas";
  const ziele = data?.activeGoals?.slice(0, 3) ?? [];
  const nichtVerfuegbar = isError && !data;
  const zuletztAktiv = seit(status?.lastActive);

  return (
    <div className="home-page">
      <header className="home-heading">
        <div>
          <p className="home-eyebrow">Dein persönlicher Arbeitsraum</p>
          <h1>Hey Issa<span>.</span></h1>
          <p className="home-intro">Deine Ziele. Lukas’ Gedanken. Alles im Blick.</p>
        </div>
        <button type="button" className="home-header-action" onClick={() => navigate("/chat")}>
          <MessageSquare size={18} aria-hidden="true" />
          Zum Chat
          <ArrowUpRight size={16} aria-hidden="true" />
        </button>
      </header>

      {isError && (
        <div className="home-fetch-error" role="alert">
          <span>Der aktuelle Stand ist gerade nicht erreichbar.</span>
          <button type="button" onClick={() => refetch()}>Erneut laden</button>
        </div>
      )}

      <div className="home-pending">
        <WartetAufDich kompakt />
      </div>

      <div className="home-columns">
        <section className="home-context" aria-labelledby="home-focus-heading">
          <div className="home-section-heading">
            <h2 id="home-focus-heading">Im Fokus</h2>
            {zuletztAktiv && <span>Zuletzt aktiv {zuletztAktiv}</span>}
          </div>
          <button type="button" className="home-focus" onClick={() => navigate("/goals")}>
            <span className="home-focus-top">
              <span><Target size={17} aria-hidden="true" /> Lukas’ aktuelles Thema</span>
              <ArrowUpRight size={20} aria-hidden="true" />
            </span>
            <h3>{status?.obsession || (status ? "Raum für neue Ideen" : nichtVerfuegbar ? "Stand nicht verfügbar" : "Wird geladen …")}</h3>
            <span className="home-focus-bottom">
              <span className="home-mood">
                <span className="home-mood-dot" aria-hidden="true" />
                <span>{status?.mood ?? (nichtVerfuegbar ? "Nicht verfügbar" : "Stimmung lädt …")}</span>
                {status && <small>Energie: {status.energy}</small>}
              </span>
              <span className="home-focus-cta">Ziele ansehen <ChevronRight size={16} aria-hidden="true" /></span>
            </span>
          </button>

          <div className="home-goals">
            <div className="home-section-heading">
              <h2>Woran Lukas arbeitet</h2>
              <button type="button" className="home-text-link" onClick={() => navigate("/goals")}>
                Alle Ziele <ArrowUpRight size={15} aria-hidden="true" />
              </button>
            </div>
            {ziele.length > 0 ? (
              <ol className="home-goal-list">
                {ziele.map((ziel, index) => (
                  <li key={ziel.id}>
                    <button type="button" className="home-goal" onClick={() => navigate("/goals")}>
                      <span className="home-goal-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                      <span className="home-goal-copy">
                        <span>{ziel.title}</span>
                        <small>{ziel.progress || ziel.description}</small>
                      </span>
                      <ChevronRight size={17} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="home-empty">
                {data ? "Noch keine aktiven Ziele. Gib Lukas eine Richtung." : nichtVerfuegbar ? "Deine Ziele sind gerade nicht erreichbar." : "Deine Ziele werden geladen …"}
              </p>
            )}
          </div>

          <div className="home-metrics">
            <button type="button" onClick={() => navigate("/goals")}>
              <Target size={20} aria-hidden="true" />
              <span>{status ? status.activeGoalsCount + " aktive Ziele" : nichtVerfuegbar ? "Ziele nicht verfügbar" : "Ziele laden …"}</span>
              <small>Gemeinsam vorankommen</small>
              <ArrowUpRight size={15} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => navigate("/memory")}>
              <Brain size={20} aria-hidden="true" />
              <span>{status ? status.memoriesCount + " Erinnerungen" : nichtVerfuegbar ? "Gedächtnis nicht verfügbar" : "Gedächtnis lädt …"}</span>
              <small>Wissen, das bleibt</small>
              <ArrowUpRight size={15} aria-hidden="true" />
            </button>
          </div>
          {status?.note && <p className="home-status-note">{status.note}</p>}
        </section>

        <section className={"home-conversation " + (sprache.aktiv ? "is-active" : "")} aria-label="Mit Lukas sprechen oder schreiben">
          <div className="home-conversation-top">
            <span className="home-eyebrow">Ein Gedanke genügt</span>
            <span className="home-conversation-mark" aria-hidden="true">L</span>
          </div>
          <div className="home-orb"><Orb zustand={zustand} pegel={pegel} groesse="mittel" /></div>
          <p className="home-voice-state" aria-live="polite">{sprachText}</p>
          <h2>{sprache.aktiv ? "Ich bin ganz Ohr." : <>Was bewegen<br />wir heute?</>}</h2>
          <p className="home-conversation-description">Ein Ziel, eine Frage oder eine neue Idee.<br />Lass uns anfangen.</p>
          {sprache.aktiv && letzteZeile && (
            <p className="home-transcript">
              <span>{letzteZeile.role === "user" ? "Du" : "Lukas"}</span>
              {letzteZeile.text}
            </p>
          )}
          {sprache.fehler && <p className="home-voice-error" role="alert">{sprache.fehler}</p>}
          <div className="home-composer">
            <textarea
              ref={eingabe}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  absenden();
                }
              }}
              rows={1}
              placeholder={sprache.aktiv ? "Oder schreib mir …" : "Was geht dir durch den Kopf?"}
              aria-label="Frage an Lukas"
            />
            <div className="home-composer-actions">
              <button type="button" className="home-attach" onClick={() => navigate("/chat")} aria-label="Datei anhängen (im Chat)">
                <Paperclip size={19} aria-hidden="true" />
              </button>
              <span>Mit Lukas weiterdenken</span>
              {tippt ? (
                <button type="button" className="home-send" onClick={absenden} aria-label="Senden"><ArrowUp size={21} aria-hidden="true" /></button>
              ) : (
                <button
                  type="button"
                  className={"home-speak " + (sprache.aktiv ? "is-active" : "")}
                  onClick={sprache.aktiv || sprache.status === "verbindet" ? sprache.beenden : sprache.starten}
                  
                  aria-label={sprache.status === "verbindet" ? "Verbindungsaufbau abbrechen" : sprache.aktiv ? "Gespräch beenden" : "Mit Lukas sprechen"}
                >
                  {sprache.aktiv ? <X size={18} aria-hidden="true" /> : <AudioLines size={18} aria-hidden="true" />}
                  <span>{sprache.status === "verbindet" ? "Abbrechen" : sprache.aktiv ? "Beenden" : "Sprechen"}</span>
                </button>
              )}
            </div>
          </div>
          <button type="button" className="home-brain-link" onClick={() => navigate("/gehirn")}>
            <Network size={17} aria-hidden="true" /> Ein Blick in Lukas’ Gehirn <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </section>
      </div>

      <section className="home-recent-section" aria-labelledby="home-recent-heading">
        <div className="home-section-heading">
          <h2 id="home-recent-heading">Zuletzt festgehalten</h2>
          <span>Gedanken mit Bestand</span>
        </div>
        <div className="home-recent">
          <button type="button" onClick={() => navigate("/diary")}>
            <span className="home-recent-icon"><BookOpen size={21} aria-hidden="true" /></span>
            <span className="home-recent-copy">
              <small>Tagebuch{tagebuch?.createdAt && seit(tagebuch.createdAt) ? " · " + seit(tagebuch.createdAt) : ""}</small>
              <span>{tagebuch?.content || (data ? "Noch kein Eintrag" : nichtVerfuegbar ? "Nicht verfügbar" : "Tagebuch lädt …")}</span>
            </span>
            <ArrowUpRight size={18} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => navigate("/memory")}>
            <span className="home-recent-icon"><Brain size={21} aria-hidden="true" /></span>
            <span className="home-recent-copy">
              <small>Erinnerung</small>
              <span>{erinnerung?.content || (data ? "Noch nichts festgehalten" : nichtVerfuegbar ? "Nicht verfügbar" : "Erinnerungen laden …")}</span>
            </span>
            <ArrowUpRight size={18} aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
}
