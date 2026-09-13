import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useGetLukasDashboard } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import {
  ArrowUp,
  AudioLines,
  BookOpen,
  Brain,
  Paperclip,
  Target,
  X,
  type LucideIcon,
} from "lucide-react";
import { Orb, type OrbZustand } from "@/components/orb";
import { WartetAufDich } from "@/components/wartet-auf-dich";
import { useSprachsitzung } from "@/hooks/use-sprachsitzung";
import { useAudioPegel } from "@/hooks/use-audio-pegel";

/*
 * Die Startseite.
 *
 * Der Aufbau ist bewusst in dieser Reihenfolge:
 *
 *   1. Der Orb, ganz oben. Er ist das Erste, was man sieht, und er sagt
 *      ohne ein Wort, ob gerade etwas läuft.
 *   2. Was Lukas beschäftigt — vier Kacheln mit dem, was er WIRKLICH gerade
 *      hat: Stimmung, Thema, Gedächtnis, Tagebuch. Nicht Zierde, sondern
 *      der Grund, warum man überhaupt hier landet.
 *   3. Die Frage, unten. Sie steht dort, weil man sie stellt, NACHDEM man
 *      gesehen hat, wie es ihm geht — nicht davor.
 *
 * Zwischen Orb und Begrüßung liegt der Platz, in dem die Kacheln stehen.
 * Ohne sie war die Seite hübsch und leer; alles, was Lukas über sich zu
 * sagen hat, lag einen Klick entfernt und wurde damit nie gesehen.
 */

/** Eine der vier großen Kacheln. Sie zeigt eine Sache, groß genug zum Lesen. */
function Kachel({
  icon: Icon,
  label,
  wert,
  zusatz,
  ziel,
  verzoegerung = 0,
  navigate,
}: {
  icon: LucideIcon;
  label: string;
  wert: string;
  zusatz?: string;
  ziel: string;
  verzoegerung?: number;
  navigate: (ziel: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => navigate(ziel)}
      style={{ animationDelay: `${verzoegerung}ms` }}
      className="card-soft rise flex min-h-[7.5rem] flex-col justify-between rounded-3xl p-4 text-left sm:min-h-[8.5rem] sm:p-5"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </span>
      </span>
      <span className="mt-2 block">
        {/*
          Zwei Zeilen, dann Schluss. Ein Tagebucheintrag ist ein Satz, keine
          Kennzahl — ohne Begrenzung sprengt er die Kachel und schiebt den
          Zusatz heraus. Genau das war im ersten Screenshot zu sehen.
        */}
        {/*
          KEIN `block` hinter `line-clamp-2`: die Begrenzung braucht
          `display:-webkit-box`, und `block` setzt das zurueck — dann laeuft
          der Text ueber vier Zeilen weiter, als waere nichts gesetzt. Genau
          so stand es im Screenshot.
          `break-words` fuer den zweiten Fall: ein langes Wort wie
          "Migrationskette" bricht sonst nicht und schiebt sich seitlich aus
          der Kachel heraus.
        */}
        <span className="line-clamp-2 break-words text-[1.02rem] font-semibold leading-snug tracking-tight sm:text-lg">
          {wert}
        </span>
        {zusatz && (
          <span className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">
            {zusatz}
          </span>
        )}
      </span>
    </button>
  );
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const eingabe = useRef<HTMLTextAreaElement>(null);
  const sprache = useSprachsitzung();
  const { data } = useGetLukasDashboard();

  const pegel = useAudioPegel({
    // Beim Sprechen zählt SEINE Stimme, beim Zuhören DEINE.
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
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  function absenden() {
    const frage = text.trim();
    if (!frage) return;
    sessionStorage.setItem("lukas_startfrage", frage);
    setText("");
    navigate("/chat");
  }

  const status = data?.status;
  const tagebuch = data?.recentDiary?.[0];
  const erinnerung = data?.recentMemories?.[0];
  const letzteZeile = sprache.zeilen[sprache.zeilen.length - 1];

  const seit = (d: Date | string | null | undefined) =>
    d ? formatDistanceToNow(new Date(d), { addSuffix: true, locale: de }) : undefined;

  return (
    <div className="relative">
      {/* Der Schein von unten. `fixed`, nicht `absolute`: die Seite scrollt
          jetzt, und ein mitscrollender Verlauf reißt beim Scrollen sichtbar
          ab — genau der schwarze Balken, der vorher unten auftauchte. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 h-[45vh] opacity-60"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 120%, color-mix(in oklch, var(--primary) 50%, transparent) 0%, transparent 70%)",
        }}
      />

      <div className="relative mx-auto flex w-full max-w-3xl flex-col px-5 pb-8 pt-6 sm:px-8">
        {/* ── 1. Der Orb, oben ──────────────────────────────────────────── */}
        <div className="flex justify-center">
          <Orb zustand={zustand} pegel={pegel} groesse={sprache.aktiv ? "gross" : "mittel"} />
        </div>

        {/* ── 2. Was ihn beschäftigt ────────────────────────────────────── */}
        <div className="mt-7 space-y-4 sm:mt-9">
          {/* Steht vor den Kacheln, weil es das Einzige auf dieser Seite ist,
              das eine Aufgabe ist statt einer Information. Ist nichts offen,
              zeigt die Komponente von sich aus nichts. */}
          <WartetAufDich />

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <Kachel
              navigate={navigate}
              icon={AudioLines}
              label="Stimmung"
              wert={status?.mood ?? "—"}
              zusatz={status?.note || (status ? `Energie: ${status.energy}` : "lädt…")}
              ziel="/diary"
            />
            <Kachel
              navigate={navigate}
              icon={Target}
              label="Thema"
              wert={status?.obsession || "Nichts Bestimmtes"}
              zusatz={
                status ? `${status.activeGoalsCount} aktive Ziele` : undefined
              }
              ziel="/goals"
              verzoegerung={60}
            />
            <Kachel
              navigate={navigate}
              icon={Brain}
              label="Gedächtnis"
              wert={status ? `${status.memoriesCount} Erinnerungen` : "—"}
              zusatz={
                erinnerung?.content
                  ? `Zuletzt: ${erinnerung.content}`
                  : undefined
              }
              ziel="/memory"
              verzoegerung={120}
            />
            <Kachel
              navigate={navigate}
              icon={BookOpen}
              label="Tagebuch"
              /* Nicht zusaetzlich per slice kuerzen: line-clamp schneidet an
                 der Zeile ab und laesst dadurch mehr Lesbares stehen. Beides
                 zusammen hat vom Eintrag nur "Der Umstieg auf…" uebrig
                 gelassen. */
              wert={tagebuch?.content || "Noch nichts geschrieben"}
              zusatz={seit(tagebuch?.createdAt) ?? seit(status?.lastActive)}
              ziel="/diary"
              verzoegerung={180}
            />
          </div>
        </div>

        {/* ── 3. Die Begrüßung, darunter ────────────────────────────────── */}
        {/*
          Der Abstand nach unten ist kein Geschmack, sondern Pflicht: die
          Eingabe klebt am unteren Rand und wuerde sonst genau ueber diesem
          Text liegen. Im ersten Anlauf tat sie das auch.
        */}
        <div className="mt-10 pb-24 text-center sm:mt-12">
          <p className="text-sm text-muted-foreground">Hey Issa</p>
          <h1 className="mt-1 text-[1.6rem] font-semibold leading-tight tracking-tight text-pretty sm:text-3xl">
            {sprache.aktiv ? "Ich höre." : "Wie kann ich dir heute helfen?"}
          </h1>

          {sprache.aktiv && letzteZeile && (
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
              <span className="opacity-60">{letzteZeile.role === "user" ? "Du: " : "Lukas: "}</span>
              {letzteZeile.text}
            </p>
          )}
          {sprache.fehler && (
            <p className="mt-3 text-sm text-destructive">{sprache.fehler}</p>
          )}
        </div>

        {/* ── 4. Die Eingabe ───────────────────────────────────────────── */}
        {/* Klebt unten, damit sie beim Scrollen erreichbar bleibt. Der
            Sicherheitsabstand unten ist die Home-Leiste des iPhones — ohne
            ihn liegt die Taste darunter. */}
        <div
          className="sticky bottom-0 z-10 mt-6 pt-3"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          <div className="glass flex items-end gap-2 rounded-[1.75rem] px-3 py-2 shadow-lg shadow-black/30">
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

            {/* Schreibst du, ist es Senden. Schreibst du nicht, die Stimme. */}
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
        </div>
      </div>
    </div>
  );
}
