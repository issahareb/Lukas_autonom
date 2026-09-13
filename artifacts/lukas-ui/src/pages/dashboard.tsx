import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowUp, AudioLines, Image as BildIcon, Paperclip, Sparkles, FileText, X } from "lucide-react";
import { Orb, type OrbZustand } from "@/components/orb";
import { useSprachsitzung } from "@/hooks/use-sprachsitzung";
import { useAudioPegel } from "@/hooks/use-audio-pegel";

/*
 * Die Startseite.
 *
 * Eine Frage, eine Antwortmöglichkeit, sonst nichts. Alles andere hat seinen
 * eigenen Tab — hier steht Lukas selbst im Mittelpunkt, nicht seine
 * Verwaltung.
 *
 * DREI ZUSTÄNDE, DIE DER ORB ERZÄHLT:
 *   nichts los  -> er ist groß und atmet in der Mitte.
 *   du tippst   -> er rückt nach oben und wird kleiner. Der Platz gehört
 *                  jetzt dem, was du schreibst.
 *   ihr redet   -> er wird groß und folgt der Stimme, die gerade dran ist.
 *
 * Die Bewegung beim Tippen ist kein Effekt: sie beantwortet die Frage "hört
 * er mich gerade?" ohne ein einziges Wort. Und weil der Pegel aus der echten
 * Audiospur kommt (use-audio-pegel), stimmt sie auch dann, wenn jemand
 * mitten im Satz Luft holt.
 */

const VORSCHLAEGE = [
  { icon: Sparkles, titel: "Überrasch mich", text: "Was ist dir zuletzt aufgefallen?" },
  { icon: BildIcon, titel: "Bild erstellen", text: "Erstelle ein Bild von " },
  { icon: FileText, titel: "Zusammenfassen", text: "Fass mir kurz zusammen: " },
];

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const eingabe = useRef<HTMLTextAreaElement>(null);
  const sprache = useSprachsitzung();

  const pegel = useAudioPegel({
    // Beim Sprechen zählt SEINE Stimme, beim Zuhören DEINE. Beide Quellen
    // hängen dran; die lautere gewinnt, und still ist immer nur eine.
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

  // Groß im Gespräch, klein beim Tippen, sonst dazwischen.
  const groesse = sprache.aktiv ? "gross" : tippt ? "klein" : "mittel";

  // Das Textfeld wächst mit, bis zu einer Grenze — ein Feld, das endlos
  // wächst, schiebt die Eingabe irgendwann aus dem Bild.
  useEffect(() => {
    const el = eingabe.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  function absenden() {
    const frage = text.trim();
    if (!frage) return;
    /*
     * Die Frage wird im sessionStorage übergeben, nicht in der Adresszeile.
     * Zwei Gründe: sie kann beliebig lang sein, und sie hat in einem Link,
     * den jemand teilt oder der im Verlauf stehen bleibt, nichts verloren.
     */
    sessionStorage.setItem("lukas_startfrage", frage);
    setText("");
    navigate("/chat");
  }

  const letzteZeile = sprache.zeilen[sprache.zeilen.length - 1];

  return (
    <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden">
      {/* Der Schein von unten — er ist in den Vorlagen das, was die Seite aus
          dem reinen Schwarz heraushebt. Rein dekorativ, daher aria-hidden. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] opacity-70"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 115%, color-mix(in oklch, var(--primary) 55%, transparent) 0%, transparent 70%)",
        }}
      />

      <div className="relative flex min-h-[calc(100dvh-4rem)] flex-col items-center px-5 pb-6 pt-4 sm:px-8">
        {/* ── Orb + Begrüßung ─────────────────────────────────────────── */}
        {/*
          Beim Tippen rueckt der Orb nach OBEN, er schrumpft nicht bloss in der
          Mitte. Das ist der Unterschied zwischen "er macht Platz" und "er
          verschwindet": der Blick wandert mit ihm hoch, und darunter entsteht
          der Raum fuer das, was gleich kommt.
        */}
        <div
          className={`flex w-full flex-1 flex-col items-center transition-all duration-500 ${
            tippt ? "justify-start gap-3 pt-2" : "justify-center gap-6"
          }`}
        >
          <Orb zustand={zustand} pegel={pegel} groesse={groesse} />

          {/* Beim Tippen tritt die Begrüßung zurück — du weißt ja schon, was
              du willst. Sie verschwindet nicht, sie wird nur leise. */}
          <div
            className={`text-center transition-all duration-500 ${
              tippt ? "max-h-0 scale-95 opacity-0" : "max-h-40 opacity-100"
            }`}
          >
            <p className="text-sm text-muted-foreground sm:text-base">Hallo Issa</p>
            <h1 className="mt-1 text-[1.75rem] font-semibold leading-tight tracking-tight text-pretty sm:text-4xl">
              {sprache.aktiv ? "Ich höre." : "Wie kann ich dir helfen?"}
            </h1>
            {!sprache.aktiv && (
              <p className="mx-auto mt-3 hidden max-w-sm text-sm text-muted-foreground sm:block">
                Von der schnellen Frage bis zur Arbeit, die von allein weiterläuft.
              </p>
            )}
          </div>

          {/* Im Gespräch: die letzte Zeile, damit man mitlesen kann. */}
          {sprache.aktiv && letzteZeile && (
            <p className="mx-auto max-w-md text-center text-sm text-muted-foreground">
              <span className="opacity-60">{letzteZeile.role === "user" ? "Du: " : "Lukas: "}</span>
              {letzteZeile.text}
            </p>
          )}

          {sprache.fehler && (
            <p className="max-w-md text-center text-sm text-destructive">{sprache.fehler}</p>
          )}
        </div>

        {/* ── Eingabe ─────────────────────────────────────────────────── */}
        <div className="w-full max-w-2xl shrink-0">
          <div className="glass flex items-end gap-2 rounded-[1.75rem] px-3 py-2 shadow-lg shadow-black/20">
            <button
              type="button"
              onClick={() => navigate("/chat")}
              className="shrink-0 rounded-full p-2.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              aria-label="Datei anhängen (im Chat)"
            >
              <Paperclip className="h-[1.15rem] w-[1.15rem]" />
            </button>

            <textarea
              ref={eingabe}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  absenden();
                }
              }}
              rows={1}
              placeholder={sprache.aktiv ? "Oder schreib mir…" : "Frag mich alles…"}
              aria-label="Frage an Lukas"
              className="max-h-40 flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/60"
            />

            {/* Die Taste wechselt mit dem, was du tust: schreibst du, ist es
                Senden. Schreibst du nicht, ist es die Stimme. Zwei Tasten
                nebeneinander hätten hier nur die Frage gestellt, welche. */}
            {tippt ? (
              <button
                type="button"
                onClick={absenden}
                className="shrink-0 rounded-full bg-primary p-2.5 text-primary-foreground transition-transform hover:scale-105"
                aria-label="Senden"
              >
                <ArrowUp className="h-[1.15rem] w-[1.15rem]" />
              </button>
            ) : (
              <button
                type="button"
                onClick={sprache.aktiv ? sprache.beenden : sprache.starten}
                disabled={sprache.status === "verbindet"}
                className={`shrink-0 rounded-full p-2.5 transition-all disabled:opacity-50 ${
                  sprache.aktiv
                    ? "bg-destructive text-white"
                    : "bg-primary text-primary-foreground hover:scale-105"
                }`}
                aria-label={sprache.aktiv ? "Gespräch beenden" : "Mit Lukas sprechen"}
              >
                {sprache.aktiv ? (
                  <X className="h-[1.15rem] w-[1.15rem]" />
                ) : (
                  <AudioLines className="h-[1.15rem] w-[1.15rem]" />
                )}
              </button>
            )}
          </div>

          {/* ── Vorschläge ────────────────────────────────────────────── */}
          {/* Auf dem Handy nur, solange nichts los ist: dort ist der Platz
              knapp, und sie stehen sonst der Tastatur im Weg. */}
          <div
            className={`mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3 ${
              tippt || sprache.aktiv ? "hidden" : "hidden sm:grid"
            }`}
          >
            {VORSCHLAEGE.map(({ icon: Icon, titel, text: vorlage }) => (
              <button
                key={titel}
                type="button"
                onClick={() => {
                  setText(vorlage);
                  eingabe.current?.focus();
                }}
                className="card-soft rounded-2xl px-3.5 py-3 text-left"
              >
                <span className="flex items-center gap-2 text-[13px] font-medium">
                  <Icon className="h-4 w-4 text-primary" />
                  {titel}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
