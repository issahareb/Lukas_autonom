/*
 * Prueft die Kennzahlen — vor allem die Stellen, an denen eine Ueberwachung
 * normalerweise Unsinn meldet und danach niemand mehr hinsieht:
 *
 *  1. Eine Quote aus drei Aufrufen ist keine Quote. Ohne Untergrenze meldet
 *     so etwas an ruhigen Tagen am lautesten.
 *  2. Der Vergleich laeuft gegen den MEDIAN. Ein einziger katastrophaler Tag
 *     darf die Normalitaet nicht so verschieben, dass danach nichts mehr
 *     auffaellt — genau dann braucht man sie.
 *  3. Der angebrochene Tag ist kuerzer als die Vortage. Wer Mengen
 *     ungewichtet vergleicht, meldet jeden Vormittag "viel zu wenig los" und
 *     jeden Abend "viel zu viel".
 *  4. Gemeldet wird nur, was eine Warnung ist — und der Betreff traegt die
 *     Kennzahl, nicht den Messwert. Sonst waere jeder Prozentpunkt ein neuer
 *     Betreff und die Wiederholungssperre in melden.ts wirkungslos.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".kennzahl-check-"));
const out = join(dir, "k.mjs");
const attrappe = join(dir, "attrappe.mjs");

writeFileSync(
  attrappe,
  `const t = (n) => new Proxy({ __name: n }, { get: (o, k) => (k === "__name" ? n : String(k)) });
export const erfahrungenTable = t("erfahrungen");
export const tageskostenTable = t("kosten");
export const approvals = t("approvals");
export const meldungen = t("meldungen");
export const debugLogTable = t("debug");

export const eq = (feld, wert) => (z) => z[feld] === wert;
export const isNull = (f) => (z) => z[f] === null || z[f] === undefined;
export const isNotNull = (f) => (z) => z[f] !== null && z[f] !== undefined;
export const or = (...b) => (z) => b.filter(Boolean).some((fn) => fn(z));
export const not = (b) => (z) => !b(z);
export const ne = (f, w) => (z) => z[f] !== w;
export const lt = (f, w) => (z) => z[f] < w;
export const lte = (f, w) => (z) => z[f] <= w;
export const notInArray = (f, w) => (z) => !(w ?? []).includes(z[f]);
export const like = () => () => true;
export const asc = () => ({});
export const gte = (feld, wert) => (z) => {
  const a = z[feld], b = wert;
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() >= new Date(b).getTime();
  return a >= b;
};
export const logger = { info(){}, warn(){}, error(){}, debug(){} };

globalThis.__daten = { erfahrungen: [], kosten: [], approvals: [], meldungen: [], debug: [] };
globalThis.__dbKaputt = false;
globalThis.__gemeldet = [];

export const meldeDichBeiIssa = async (opts) => {
  globalThis.__gemeldet.push(opts);
  return "abgelegt";
};

export const db = {
  select: () => ({
    from: (tab) => {
      const alle = () => globalThis.__daten[tab.__name] ?? [];
      const bau = (bed) => ({
        where: (b) => bau(b),
        orderBy: () => bau(bed),
        limit: async () => alle().filter((z) => (bed ? bed(z) : true)),
        then: (r, j) => (globalThis.__dbKaputt
          ? Promise.reject(new Error("DB weg"))
          : Promise.resolve(alle().filter((z) => (bed ? bed(z) : true)))).then(r, j),
      });
      return bau(null);
    },
  }),
};
`,
);

await build({
  entryPoints: ["src/lib/kennzahlen.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
  plugins: [
    {
      name: "attrappen",
      setup(b) {
        b.onResolve({ filter: /(^|\/)(logger|melden)$/ }, () => ({ path: attrappe }));
      },
    },
  ],
  logLevel: "silent",
});

const { zeitreihe, auffaelligkeiten, kennzahlen, kennzahlenHinweis, meldeAuffaelligkeiten, anteilDesTages } =
  await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

const TAG = 24 * 3600 * 1000;
/** Ein Zeitpunkt vor n Tagen, mitten am Tag — damit die UTC-Grenze eindeutig ist. */
const vorTagen = (n) => new Date(Date.now() - n * TAG);
const leeren = () => {
  globalThis.__daten = { erfahrungen: [], kosten: [], approvals: [], meldungen: [], debug: [] };
  globalThis.__gemeldet = [];
};
const tagVon = (d) => d.toISOString().slice(0, 10);

// ── 1. Gezählt wird, was da ist ───────────────────────────────────────────
leeren();
{
  for (let i = 0; i < 12; i++) {
    globalThis.__daten.erfahrungen.push({
      werkzeug: "web_search", kontext: "", gelungen: i < 9, grund: "", createdAt: vorTagen(0),
    });
  }
  globalThis.__daten.kosten.push({
    tag: tagVon(new Date()), provider: "anthropic", model: "opus",
    aufrufe: 7, rein: 50_000, raus: 4_000, ausCache: 30_000, inCache: 0,
  });
  globalThis.__daten.approvals.push(
    { status: "allowed", createdAt: vorTagen(0) },
    { status: "pending", createdAt: vorTagen(0) },
  );
  globalThis.__daten.meldungen.push({ status: "offen", createdAt: vorTagen(0) });
  globalThis.__daten.debug.push({ scope: "x", createdAt: vorTagen(0) });

  const reihe = await zeitreihe(14);
  pruefe("vierzehn Tage, auch die leeren", reihe.length === 14);
  const heute = reihe.at(-1);
  pruefe("Werkzeugaufrufe gezählt", heute.werkzeugAufrufe === 12);
  pruefe("Fehlschläge gezählt", heute.werkzeugFehler === 3);
  pruefe("Quote gerechnet", Math.abs(heute.fehlerquote - 0.25) < 1e-9);
  pruefe("Modellaufrufe aus den Tageskosten", heute.modellAufrufe === 7);
  pruefe("Tokens summiert", heute.tokenRein === 50_000 && heute.tokenRaus === 4_000);
  /*
   * 30.000 aus dem Cache bei 50.000 frisch bezahlten heisst NICHT 60 %.
   * `rein` ist der frisch bezahlte Eingang OHNE Cache — der ganze Eingang ist
   * 50.000 + 30.000 = 80.000, die Quote also 37,5 %.
   *
   * Der erste Entwurf teilte durch `rein` und zeigte im Dashboard 104 % an.
   * Eine Quote ueber 100 % ist keine ungenaue Zahl, sondern eine unmoegliche.
   */
  pruefe(
    "Cache-Quote am GANZEN Eingang, nicht am frisch bezahlten",
    Math.abs(heute.cacheQuote - 30_000 / 80_000) < 1e-9,
  );
  pruefe("Freigaben gezählt", heute.freigabenGefragt === 2 && heute.freigabenErteilt === 1);
  pruefe("Meldungen gezählt", heute.meldungenNeu === 1);
  pruefe("Störungen gezählt", heute.stoerungen === 1);

  const k = await kennzahlen(14);
  pruefe("offene Freigaben stehen als Zustand daneben", k.jetzt.freigabenOffen === 1);
  pruefe("offene Meldungen auch", k.jetzt.meldungenOffen === 1);
}

// ── 1b. Eine Quote kann NIE über 100 % liegen ────────────────────────────
/*
 * Der Fall, der im Dashboard stand: mehr aus dem Cache gelesen als frisch
 * bezahlt. Das ist der Normalfall bei gutem Caching — und ergab mit der
 * falschen Rechnung 104 %.
 */
leeren();
{
  globalThis.__daten.kosten.push({
    tag: tagVon(new Date()), provider: "anthropic", model: "opus",
    aufrufe: 20, rein: 5_000, raus: 2_000, ausCache: 120_000, inCache: 0,
  });
  const reihe = await zeitreihe(14);
  const q = reihe.at(-1).cacheQuote;
  pruefe("die Quote bleibt bei oder unter 100 %", q !== null && q <= 1);
  pruefe("und ist hier sehr hoch, wie es sich gehört", q > 0.9);
  pruefe(
    "gerechnet wird 120.000 von 125.000",
    Math.abs(q - 120_000 / 125_000) < 1e-9,
  );
}

// ── 2. Eine Quote aus drei Aufrufen ist keine Quote ───────────────────────
leeren();
{
  for (let i = 0; i < 3; i++) {
    globalThis.__daten.erfahrungen.push({
      werkzeug: "x", kontext: "", gelungen: false, grund: "", createdAt: vorTagen(0),
    });
  }
  const reihe = await zeitreihe(14);
  pruefe(
    "unter zehn Aufrufen gibt es KEINE Quote, nicht 100 %",
    reihe.at(-1).fehlerquote === null,
  );
  pruefe("gemeldet wird deshalb nichts", auffaelligkeiten(reihe).length === 0);
}

// ── 3. Median, nicht Mittelwert ───────────────────────────────────────────
/*
 * Zwölf ruhige Tage mit 10 % Fehlern, ein einzelner Totalausfall mit 100 %,
 * und heute 30 %. Der Mittelwert der Vortage läge bei rund 17 % — dann wären
 * 30 % keine 15 Punkte darüber und der Befund käme NICHT. Der Median liegt
 * bei 10 %, und genau deshalb kommt er.
 */
{
  const bau = (quote, aufrufe = 20) => ({ fehlerquote: quote, werkzeugAufrufe: aufrufe, werkzeugFehler: Math.round(quote * aufrufe), cacheQuote: null, tokenRein: 0, tokenRaus: 0, stoerungen: 0, tag: "x" });
  const reihe = [
    ...Array.from({ length: 12 }, () => bau(0.1)),
    bau(1.0),
    bau(0.3),
  ];
  const b = auffaelligkeiten(reihe, new Date());
  const treffer = b.find((x) => x.kennzahl === "werkzeug-fehlerquote");
  pruefe("der Ausreißer verschiebt die Normalität nicht", Boolean(treffer));
  pruefe("das Übliche sind 10 %, nicht 17 %", treffer && Math.abs(treffer.ueblich - 0.1) < 1e-9);
  pruefe("der Satz nennt beide Zahlen", treffer && /30 %/.test(treffer.satz) && /10 %/.test(treffer.satz));
}

// ── 4. Kleine Ausschläge sind keine Befunde ───────────────────────────────
{
  const bau = (q) => ({ fehlerquote: q, werkzeugAufrufe: 20, werkzeugFehler: q * 20, cacheQuote: null, tokenRein: 0, tokenRaus: 0, stoerungen: 0, tag: "x" });
  const reihe = [...Array.from({ length: 10 }, () => bau(0.1)), bau(0.2)];
  pruefe(
    "von 10 % auf 20 % ist noch kein Befund",
    auffaelligkeiten(reihe, new Date()).every((x) => x.kennzahl !== "werkzeug-fehlerquote"),
  );
  const reihe2 = [...Array.from({ length: 10 }, () => bau(0.1)), bau(0.45)];
  const b2 = auffaelligkeiten(reihe2, new Date()).find((x) => x.kennzahl === "werkzeug-fehlerquote");
  pruefe("von 10 % auf 45 % ist eine Warnung", b2?.schwere === "warnung");
}

// ── 5. Der angebrochene Tag wird gewichtet ────────────────────────────────
/*
 * Ohne Gewichtung wäre jeder Vormittag ein Befund und jeder Abend keiner.
 * Dieselben Daten, zwei Uhrzeiten — der Befund darf nur einmal kommen.
 */
{
  const bau = (tokens, stoerungen = 0) => ({ fehlerquote: null, werkzeugAufrufe: 0, werkzeugFehler: 0, cacheQuote: null, tokenRein: tokens, tokenRaus: 0, stoerungen, tag: "x" });
  const reihe = [...Array.from({ length: 10 }, () => bau(1_000_000)), bau(600_000)];

  const morgens = new Date(Date.UTC(2026, 8, 2, 6, 0, 0));   // 25 % des Tages
  const abends = new Date(Date.UTC(2026, 8, 2, 22, 0, 0));   // 92 % des Tages
  pruefe("um 06:00 UTC ist ein Viertel des Tages vorbei", Math.abs(anteilDesTages(morgens) - 0.25) < 1e-9);

  const b1 = auffaelligkeiten(reihe, morgens).find((x) => x.kennzahl === "tokenverbrauch");
  const b2 = auffaelligkeiten(reihe, abends).find((x) => x.kennzahl === "tokenverbrauch");
  pruefe("600k bis 06:00 sind mehr als das Doppelte des Üblichen — Befund", Boolean(b1));
  pruefe("dieselben 600k bis 22:00 sind unauffällig — kein Befund", !b2);
}

// ── 6. Vor zwei Stunden UTC gibt es keine Mengen-Befunde ──────────────────
{
  const bau = (tokens) => ({ fehlerquote: null, werkzeugAufrufe: 0, werkzeugFehler: 0, cacheQuote: null, tokenRein: tokens, tokenRaus: 0, stoerungen: 0, tag: "x" });
  const reihe = [...Array.from({ length: 10 }, () => bau(1_000_000)), bau(900_000)];
  const nachts = new Date(Date.UTC(2026, 8, 2, 0, 30, 0));
  pruefe(
    "um 00:30 wird über Mengen nichts behauptet",
    auffaelligkeiten(reihe, nachts).every((x) => x.kennzahl !== "tokenverbrauch"),
  );

  // Quoten schon: die sind normiert und brauchen die Uhrzeit nicht.
  const q = (v) => ({ fehlerquote: v, werkzeugAufrufe: 20, werkzeugFehler: v * 20, cacheQuote: null, tokenRein: 0, tokenRaus: 0, stoerungen: 0, tag: "x" });
  const reiheQ = [...Array.from({ length: 10 }, () => q(0.05)), q(0.5)];
  pruefe(
    "eine Fehlerquote fällt auch nachts um 00:30 auf",
    auffaelligkeiten(reiheQ, nachts).some((x) => x.kennzahl === "werkzeug-fehlerquote"),
  );
}

// ── 7. Was heute scheitert, mit dem Grund ─────────────────────────────────
leeren();
{
  const heute = new Date();
  for (let i = 0; i < 20; i++) {
    globalThis.__daten.erfahrungen.push({
      werkzeug: "browser_do", kontext: "kunde.de", gelungen: false,
      grund: i < 4 ? "Zeitüberschreitung nach 30 s" : "Element nicht gefunden",
      createdAt: heute,
    });
  }
  globalThis.__daten.erfahrungen.push({
    werkzeug: "web_search", kontext: "", gelungen: false, grund: "einmalig", createdAt: heute,
  });

  const k = await kennzahlen(14);
  const schlimmstes = k.schlechtesteWerkzeuge[0];
  pruefe("Werkzeug und Kontext bilden den Schlüssel", schlimmstes?.schluessel === "browser_do@kunde.de");
  pruefe("die Fehlschläge sind gezählt", schlimmstes?.fehler === 20);
  pruefe("und der HÄUFIGSTE Grund steht dabei", schlimmstes?.grund === "Element nicht gefunden");
  pruefe(
    "ein einzelner Fehlschlag ist keine Auffälligkeit",
    k.schlechtesteWerkzeuge.every((w) => w.schluessel !== "web_search"),
  );
}

// ── 8. Lukas bekommt es gesagt — Issa nur bei einer Warnung ───────────────
leeren();
{
  const heute = new Date();
  // Zehn ruhige Vortage, heute ein Einbruch.
  for (let tag = 1; tag <= 10; tag++) {
    for (let i = 0; i < 20; i++) {
      globalThis.__daten.erfahrungen.push({
        werkzeug: "web_search", kontext: "", gelungen: i > 0, grund: "x", createdAt: vorTagen(tag),
      });
    }
  }
  for (let i = 0; i < 20; i++) {
    globalThis.__daten.erfahrungen.push({
      werkzeug: "browser_do", kontext: "kunde.de", gelungen: i < 6,
      grund: "Element nicht gefunden", createdAt: heute,
    });
  }

  const text = await kennzahlenHinweis();
  pruefe("der Hinweis kommt", text.length > 0);
  pruefe("und nennt das Werkzeug, nicht nur die Zahl", /browser_do@kunde\.de/.test(text));
  pruefe("mit dem Grund", /Element nicht gefunden/.test(text));

  const anzahl = await meldeAuffaelligkeiten();
  pruefe("Issa bekommt eine Meldung", anzahl === 1 && globalThis.__gemeldet.length === 1);
  pruefe(
    "der Betreff trägt die KENNZAHL, damit die Wiederholungssperre greift",
    globalThis.__gemeldet[0].betreff === "Auffällig: werkzeug-fehlerquote",
  );
  pruefe(
    "und kein Messwert im Betreff, der sich täglich ändert",
    !/%|\d\d/.test(globalThis.__gemeldet[0].betreff),
  );
}

// ── 9. Ein Hinweis allein weckt Issa NICHT ────────────────────────────────
leeren();
{
  const heute = new Date();
  for (let tag = 1; tag <= 10; tag++) {
    for (let i = 0; i < 20; i++) {
      globalThis.__daten.erfahrungen.push({
        werkzeug: "web_search", kontext: "", gelungen: i > 1, grund: "x", createdAt: vorTagen(tag),
      });
    }
  }
  // heute 30 % statt 10 % — zwanzig Punkte darüber: Hinweis, keine Warnung.
  for (let i = 0; i < 20; i++) {
    globalThis.__daten.erfahrungen.push({
      werkzeug: "web_search", kontext: "", gelungen: i >= 6, grund: "x", createdAt: heute,
    });
  }
  const k = await kennzahlen(14);
  pruefe("der Befund ist ein Hinweis", k.auffaelligkeiten.some((a) => a.schwere === "hinweis"));
  pruefe("Lukas liest ihn", (await kennzahlenHinweis()).length > 0);
  pruefe("Issa wird dafür NICHT geweckt", (await meldeAuffaelligkeiten()) === 0);
}

// ── 10. Ohne Datenbank kippt der Lauf nicht ───────────────────────────────
globalThis.__dbKaputt = true;
{
  pruefe("der Hinweis bleibt leer statt zu werfen", (await kennzahlenHinweis()) === "");
  pruefe("und gemeldet wird nichts", (await meldeAuffaelligkeiten()) === 0);
}
globalThis.__dbKaputt = false;

if (fehler > 0) process.exit(1);
console.log(
  "OK — Kennzahlen: Median statt Mittelwert, angebrochener Tag gewichtet, kleine Mengen schweigen, Issa nur bei Warnungen.",
);
