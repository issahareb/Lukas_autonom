import { useCallback, useEffect, useState } from "react";
import { Seite, Fehler } from "@/components/seite";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertTriangle, Info, Inbox, ShieldCheck, Wrench } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Tageswert = {
  tag: string;
  werkzeugAufrufe: number;
  werkzeugFehler: number;
  fehlerquote: number | null;
  modellAufrufe: number;
  tokenRein: number;
  tokenRaus: number;
  cacheQuote: number | null;
  freigabenGefragt: number;
  freigabenErteilt: number;
  meldungenNeu: number;
  stoerungen: number;
};

type Auffaelligkeit = {
  kennzahl: string;
  heute: number;
  ueblich: number;
  schwere: "hinweis" | "warnung";
  satz: string;
};

type Kennzahlen = {
  reihe: Tageswert[];
  auffaelligkeiten: Auffaelligkeit[];
  jetzt: { freigabenOffen: number; meldungenOffen: number };
  schlechtesteWerkzeuge: Array<{ schluessel: string; fehler: number; grund: string }>;
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("lukas_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/*
 * Eine Kennzahl über vierzehn Tage.
 *
 * BEWUSST EIN EIGENES BILD JE GRÖSSE und nicht ein Diagramm mit sechs Linien.
 * Eine Fehlerquote läuft von 0 bis 1, Tokens gehen in die Millionen — beides
 * auf eine Achse zu legen, macht die eine Kurve zu einer Linie am Boden. Zwei
 * Achsen wären die naheliegende und falsche Rettung: dann bestimmt die Wahl
 * der Skalen, welche Kurve dramatisch aussieht, und das ist keine Aussage
 * über die Daten mehr.
 *
 * Eine Reihe je Bild heißt außerdem: keine Legende nötig, die Überschrift
 * benennt sie. Farbe trägt hier keine Bedeutung, sie ist nur Tinte.
 */
function Verlauf({
  titel,
  reihe,
  wert,
  zeige,
  einheit,
}: {
  titel: string;
  reihe: Tageswert[];
  wert: (t: Tageswert) => number | null;
  zeige: (v: number | null) => string;
  einheit?: string;
}) {
  const [ueber, setUeber] = useState<number | null>(null);
  const werte = reihe.map(wert);
  const max = Math.max(...werte.map((v) => v ?? 0), 0);
  const heute = werte[werte.length - 1];
  const gezeigt = ueber === null ? heute : werte[ueber];

  const H = 44;
  const BREITE = 12;
  const LUECKE = 2; // Der Spalt lässt benachbarte Balken zwei Balken bleiben.
  const R = 3;

  return (
    <div
      className="card-soft rounded-3xl p-4"
      onMouseLeave={() => setUeber(null)}
    >
      <div className="text-xs font-medium text-muted-foreground">{titel}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums">{zeige(gezeigt)}</span>
        {/* Ohne Wert auch keine Einheit: "– %" behauptet eine Messung, die es
            nicht gab. */}
        {einheit && gezeigt !== null && (
          <span className="text-xs text-muted-foreground">{einheit}</span>
        )}
      </div>
      <div className="mt-0.5 h-4 text-[11px] text-muted-foreground">
        {ueber === null
          ? "heute"
          : new Date(reihe[ueber].tag).toLocaleDateString("de-DE", {
              day: "2-digit",
              month: "2-digit",
            })}
      </div>

      <svg
        className="mt-2 w-full"
        viewBox={`0 0 ${reihe.length * (BREITE + LUECKE)} ${H}`}
        height={H}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${titel}, Verlauf über ${reihe.length} Tage`}
      >
        {werte.map((v, i) => {
          /*
           * Ein leerer Tag ist etwas anderes als ein Tag mit dem Wert null —
           * "keine Aufrufe, also keine Quote" darf nicht wie "Quote 0"
           * aussehen. Deshalb bleibt er ein flacher Strich auf der Grundlinie.
           */
          const hoehe = v === null || max === 0 ? 1 : Math.max(1, (v / max) * (H - 2));
          const x = i * (BREITE + LUECKE);
          const y = H - hoehe;
          const r = Math.min(R, hoehe / 2);
          // Runde Enden oben, fest auf der Grundlinie sitzend.
          const d =
            `M${x} ${H} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} ` +
            `L${x + BREITE - r} ${y} Q${x + BREITE} ${y} ${x + BREITE} ${y + r} L${x + BREITE} ${H} Z`;
          const letzter = i === werte.length - 1;
          return (
            <path
              key={reihe[i].tag}
              d={d}
              className={
                v === null
                  ? "fill-muted"
                  : letzter
                    ? "fill-primary"
                    : "fill-primary/35"
              }
              opacity={ueber !== null && ueber !== i ? 0.4 : 1}
              onMouseEnter={() => setUeber(i)}
            />
          );
        })}
      </svg>
    </div>
  );
}

/*
 * Kennzahlen.
 *
 * Der Punkt dieser Seite steht ganz oben und ist Text, kein Diagramm: WAS
 * HEUTE ANDERS LÄUFT. Die Verläufe darunter sind die Belege dafür. Andersherum
 * wäre es eine Ansicht, in der man selbst suchen muss — und genau das ist
 * vorher niemand gewesen.
 *
 * Leer ist deshalb ein gutes Ergebnis und wird auch so beschriftet, nicht als
 * fehlender Inhalt.
 */
export default function KennzahlenSeite() {
  const [daten, setDaten] = useState<Kennzahlen | null>(null);
  const [laedt, setLaedt] = useState(true);

  const laden = useCallback(() => {
    fetch(`${BASE}/api/lukas/kennzahlen`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Kennzahlen | null) => setDaten(d))
      .catch(() => setDaten(null))
      .finally(() => setLaedt(false));
  }, []);

  useEffect(() => {
    laden();
    const t = setInterval(laden, 60_000);
    return () => clearInterval(t);
  }, [laden]);

  const prozent = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}`);
  const zahl = (v: number | null) => (v === null ? "–" : v.toLocaleString("de-DE"));
  const kurz = (v: number | null) =>
    v === null ? "–" : v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)} M` : v.toLocaleString("de-DE");

  return (
    <Seite
      icon={Activity}
      titel="Kennzahlen"
      breit
      unterzeile="Vierzehn Tage, verglichen gegen den Median der Vortage."
    >
      <div className="space-y-6">
      {laedt && <Skeleton className="h-24 w-full" />}

      {!laedt && !daten && (
        <Fehler text="Die Kennzahlen konnten nicht geladen werden." />
      )}

      {daten && (
        <>
          {/* ── Was heute anders läuft ────────────────────────────────── */}
          <section className="space-y-2">
            {daten.auffaelligkeiten.length === 0 ? (
              <div className="card-soft rounded-3xl p-5 text-sm text-muted-foreground">
                Nichts Auffälliges. Alle Größen liegen im Rahmen der letzten
                vierzehn Tage — das ist der Normalfall und keine leere Seite.
              </div>
            ) : (
              daten.auffaelligkeiten.map((a) => (
                <div
                  key={a.kennzahl}
                  className={
                    "card-soft flex gap-3 rounded-3xl p-4 text-sm " +
                    (a.schwere === "warnung" ? "ring-1 ring-destructive/30" : "")
                  }
                >
                  {a.schwere === "warnung" ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  ) : (
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div>
                    {/* Nie nur die Farbe: das Wort steht daneben. */}
                    <div className="font-medium">
                      {a.schwere === "warnung" ? "Warnung" : "Hinweis"} · {a.kennzahl}
                    </div>
                    <div className="text-muted-foreground">{a.satz}</div>
                  </div>
                </div>
              ))
            )}
          </section>

          {/* ── Was gerade offen ist ──────────────────────────────────── */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card-soft rounded-3xl p-5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" /> Freigaben offen
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {daten.jetzt.freigabenOffen}
              </div>
            </div>
            <div className="card-soft rounded-3xl p-5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Inbox className="h-3.5 w-3.5" /> Meldungen offen
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {daten.jetzt.meldungenOffen}
              </div>
            </div>
          </section>

          {/* ── Die Verläufe ──────────────────────────────────────────── */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Verlauf
              titel="Werkzeuge gescheitert"
              reihe={daten.reihe}
              wert={(t) => t.fehlerquote}
              zeige={prozent}
              einheit="%"
            />
            <Verlauf
              titel="Werkzeugaufrufe"
              reihe={daten.reihe}
              wert={(t) => t.werkzeugAufrufe}
              zeige={zahl}
            />
            <Verlauf
              titel="Tokens"
              reihe={daten.reihe}
              wert={(t) => t.tokenRein + t.tokenRaus}
              zeige={kurz}
            />
            <Verlauf
              titel="Aus dem Cache"
              reihe={daten.reihe}
              wert={(t) => t.cacheQuote}
              zeige={prozent}
              einheit="%"
            />
            <Verlauf
              titel="Störungen"
              reihe={daten.reihe}
              wert={(t) => t.stoerungen}
              zeige={zahl}
            />
            <Verlauf
              titel="Freigaben angefragt"
              reihe={daten.reihe}
              wert={(t) => t.freigabenGefragt}
              zeige={zahl}
            />
          </section>

          {/* ── Was heute scheitert ───────────────────────────────────── */}
          {daten.schlechtesteWerkzeuge.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 px-1 text-[11px] tracking-wide text-muted-foreground">
                <Wrench className="h-4 w-4" /> Was heute am häufigsten scheitert
              </h2>
              <div className="card-soft overflow-x-auto rounded-3xl">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] text-muted-foreground">
                      <th className="px-4 pb-1 pt-3.5 font-normal">Werkzeug</th>
                      <th className="px-4 pb-1 pt-3.5 font-normal tabular-nums">Fehler</th>
                      <th className="px-4 pb-1 pt-3.5 font-normal">Häufigster Grund</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daten.schlechtesteWerkzeuge.map((w) => (
                      <tr key={w.schluessel} className="border-t border-white/[0.04]">
                        <td className="px-4 py-2 font-mono text-xs">{w.schluessel}</td>
                        <td className="px-4 py-2 tabular-nums">{w.fehler}</td>
                        <td className="px-4 py-2 text-muted-foreground">{w.grund}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
      </div>
    </Seite>
  );
}
