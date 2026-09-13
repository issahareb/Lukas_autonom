/*
 * Prueft, dass eine Aktion mit Aussenwirkung nicht zweimal laeuft.
 *
 * Der Ablauf, gegen den das steht: die Mail geht raus, danach bricht die
 * Verbindung weg, der Werkzeugaufruf sieht aus wie gescheitert, der Agent
 * versucht es erneut. Der Empfaenger ist ein Dritter, und zurueckholen laesst
 * sich nichts.
 *
 * Vier Eigenschaften, und die letzte ist die, an der so etwas meistens
 * scheitert:
 *
 *  1. Zweimal dasselbe fuehrt EINMAL aus.
 *  2. Etwas anderes laeuft trotzdem — sonst waere der Schutz eine Sperre.
 *  3. Reserviert wird VOR der Arbeit, nicht danach. Faellt der Prozess mitten
 *     im Versand, darf der naechste Versuch nicht noch einmal schicken.
 *  4. Ohne Datenbank wird AUSGEFUEHRT statt blockiert. Eine doppelte Mail ist
 *     aergerlich; eine Mail, die wegen einer Datenbankstoerung gar nicht
 *     rausgeht, obwohl Issa sie freigegeben hat, ist schlimmer.
 *  5. NACH DEM FENSTER darf dieselbe Mail wieder raus.
 *
 * Punkt 5 fehlte hier, und genau deshalb rutschte ein Fehler durch: der
 * eindeutige Index geht ueber (art, fingerabdruck) OHNE Zeit. Der Lesepfad
 * beachtete das Fenster, der Schreibpfad konnte danach nie wieder einfuegen
 * — die Sperre galt nicht zehn Minuten, sondern fuer immer. Die Zusage
 * "zehn Minuten" bestand aus zwei Haelften, und nur die erste war geprueft.
 *
 * Die Attrappe unten bildet deshalb jetzt auch den FEHLERCODE nach (23505)
 * und `.returning()`. Ohne den Code wuerde hier ein anderer Fehler als
 * Konflikt durchgehen — und der Unterschied ist der ganze Punkt.
 *
 * Das Zusammenspiel mit dem echten Index, mit 23505 und mit der Frage, ob
 * ein bedingtes UPDATE wirklich genau einen Gewinner hat, steht in
 * bench/integration/postgres.mjs — gegen ein echtes Postgres. Hier unten
 * bestaetigt eine Attrappe meine Annahme; dort bestaetigt Postgres sie.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".versand-check-"));
const out = join(dir, "sperre.mjs");
const attrappe = join(dir, "db.mjs");

/*
 * Die Attrappe bildet den EINDEUTIGEN INDEX nach — darauf beruht der ganze
 * Mechanismus. Ohne ihn waere das hier ein Lesen-dann-Schreiben, und zwei
 * gleichzeitige Zuege wuerden beide durchkommen.
 */
writeFileSync(
  attrappe,
  `globalThis.__zeilen = [];
globalThis.__dbKaputt = false;
const t = (n) => new Proxy({ __name: n }, { get: (o, k) => (k === "__name" ? n : String(k)) });
export const versandTable = t("versand");
export const eq = (f, w) => (z) => z[f] === w;
export const gte = (f, w) => (z) => new Date(z[f]).getTime() >= new Date(w).getTime();
export const and = (...b) => (z) => b.filter(Boolean).every((fn) => fn(z));
export const db = {
  select: () => ({ from: () => ({ where: (b) => ({ limit: async () => {
    if (globalThis.__dbKaputt) throw new Error("DB weg");
    return globalThis.__zeilen.filter(b);
  } }) }) }),
  insert: () => ({ values: async (v) => {
    if (globalThis.__dbSchreibKaputt) {
      // Bewusst OHNE code: eine Stoerung ist kein Eindeutigkeitskonflikt.
      throw new Error("Verbindung weg");
    }
    if (globalThis.__zeilen.some((z) => z.art === v.art && z.fingerabdruck === v.fingerabdruck)) {
      // Genau der Fehler, den Postgres wirft — samt SQLSTATE.
      const e = new Error("duplicate key value violates unique constraint");
      e.code = "23505";
      throw e;
    }
    globalThis.__zeilen.push({ ...v, createdAt: new Date() });
  } }),
  update: () => ({ set: (w) => ({ where: (b) => {
    /*
     * GENAU EINMAL auswerten. Ein UPDATE mit einer Bedingung auf dem Feld,
     * das es selbst setzt (created_at), aendert beim ersten Durchlauf genau
     * die Zeilen, die beim zweiten nicht mehr passen wuerden. Eine Attrappe,
     * die zweimal filtert, meldet dann null Treffer — und der Test schlaegt
     * an, obwohl der Code stimmt. Genau das ist hier passiert.
     */
    const treffer = globalThis.__zeilen.filter(b);
    for (const z of treffer) Object.assign(z, w);
    const kette = Promise.resolve(treffer);
    kette.returning = () => Promise.resolve(treffer.map((z) => ({ id: z.id ?? 1 })));
    return kette;
  } }) }),
};
export const lt = (f, w) => (z) => new Date(z[f]).getTime() < new Date(w).getTime();
export const logger = { info(){}, warn(){}, error(){}, debug(){} };`,
);

await build({
  entryPoints: ["src/lib/versandsperre.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
  plugins: [
    { name: "a", setup(b) { b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: attrappe })); } },
  ],
  logLevel: "silent",
});

const { nurEinmal, fingerabdruck } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

const schluessel = (...t) => fingerabdruck(...t);

// ── 1. Zweimal dasselbe → einmal ausgeführt ──────────────────────────────
globalThis.__zeilen = [];
{
  let gelaufen = 0;
  const mail = schluessel("kunde@example.com", "Angebot", "Anbei.");
  const eins = await nurEinmal("email", mail, async () => {
    gelaufen++;
    return "akzeptiert";
  });
  const zwei = await nurEinmal("email", mail, async () => {
    gelaufen++;
    return "akzeptiert";
  });

  pruefe("die erste Mail geht raus", eins.wiederholung === false && eins.ergebnis === "akzeptiert");
  pruefe("die zweite wird als Wiederholung erkannt", zwei.wiederholung === true);
  pruefe("und der Versand lief nur EINMAL", gelaufen === 1);
  pruefe(
    "das Ergebnis von damals kommt zurück, nicht ein leeres 'ok'",
    zwei.ergebnis === "akzeptiert",
  );
}

// ── 2. Etwas anderes läuft weiterhin ─────────────────────────────────────
{
  let gelaufen = 0;
  const andere = await nurEinmal("email", schluessel("kunde@example.com", "Angebot", "Anderer Text."), async () => {
    gelaufen++;
    return "akzeptiert";
  });
  pruefe("eine andere Mail geht trotzdem raus", andere.wiederholung === false && gelaufen === 1);
}

// Und dieselbe Zeichenfolge unter anderer ART ist etwas anderes.
{
  let gelaufen = 0;
  const gleich = schluessel("a", "b", "c");
  await nurEinmal("email", gleich, async () => { gelaufen++; return "x"; });
  await nurEinmal("mcp", gleich, async () => { gelaufen++; return "x"; });
  pruefe("derselbe Fingerabdruck unter anderer Art läuft eigenständig", gelaufen === 2);
}

// ── 3. Reserviert wird VOR der Arbeit ────────────────────────────────────
/*
 * Der Fall: der Prozess fällt mitten im Versand. Die Reservierung muss dann
 * schon stehen — sonst schickt der nächste Versuch ein zweites Mal. Lieber
 * eine Mail, die vielleicht nicht ankam, als zwei, die ankamen.
 */
globalThis.__zeilen = [];
{
  const abbruch = schluessel("abbruch@example.com", "X", "Y");
  let geworfen = false;
  try {
    await nurEinmal("email", abbruch, async () => {
      throw new Error("Netz weg, mitten im Versand");
    });
  } catch {
    geworfen = true;
  }
  pruefe("ein Absturz im Versand wird durchgereicht", geworfen);
  pruefe("aber die Reservierung steht bereits", globalThis.__zeilen.length === 1);

  let nochmal = 0;
  const danach = await nurEinmal("email", abbruch, async () => {
    nochmal++;
    return "doch noch";
  });
  pruefe("und der nächste Versuch schickt NICHT ein zweites Mal", nochmal === 0);
  pruefe("er meldet es als Wiederholung", danach.wiederholung === true);
}

// ── 4. Ohne Datenbank wird ausgeführt, nicht blockiert ───────────────────
globalThis.__zeilen = [];
globalThis.__dbKaputt = true;
{
  let gelaufen = 0;
  const trotzdem = await nurEinmal("email", schluessel("x", "y", "z"), async () => {
    gelaufen++;
    return "akzeptiert";
  });
  pruefe("bei kaputter Datenbank geht die Mail trotzdem raus", gelaufen === 1);
  pruefe("und sie gilt nicht als Wiederholung", trotzdem.wiederholung === false);
}
globalThis.__dbKaputt = false;

// ── 5. Nach dem Fenster darf dieselbe Mail wieder raus ───────────────────
/*
 * DIE ZUSAGE lautet "zehn Minuten", und sie hat zwei Hälften: sperren, und
 * wieder aufmachen. Nur die erste war geprüft — deshalb fiel nicht auf, dass
 * die zweite gar nicht existierte. Der eindeutige Index geht über (art,
 * fingerabdruck) OHNE Zeit; der Lesepfad beachtete das Fenster, der
 * Schreibpfad konnte danach nie wieder einfügen. Die Sperre galt für immer.
 *
 * Vorgespult wird durch Zurückdatieren der Zeile, nicht durch Warten: das ist
 * derselbe Zustand, den elf echte Minuten erzeugen — und ein Test, der elf
 * Minuten dauert, wird abgeschaltet.
 */
globalThis.__zeilen = [];
{
  const spaeter = schluessel("kunde@example.com", "Rechnung", "Anbei.");
  let gelaufen = 0;

  const erste = await nurEinmal("email", spaeter, async () => {
    gelaufen++;
    return "erste";
  });
  pruefe("die erste geht raus", erste.wiederholung === false && gelaufen === 1);

  // Sofort noch einmal: muss blockiert bleiben.
  const sofort = await nurEinmal("email", spaeter, async () => {
    gelaufen++;
    return "zweite";
  });
  pruefe("sofort danach bleibt sie gesperrt", sofort.wiederholung === true && gelaufen === 1);

  // Elf Minuten vorspulen.
  for (const z of globalThis.__zeilen) z.createdAt = new Date(Date.now() - 11 * 60 * 1000);

  const danach = await nurEinmal("email", spaeter, async () => {
    gelaufen++;
    return "nach elf Minuten";
  });
  pruefe(
    "nach elf Minuten darf dieselbe Mail WIEDER raus — genau das ging vorher nicht",
    danach.wiederholung === false && danach.ergebnis === "nach elf Minuten" && gelaufen === 2,
  );
  pruefe(
    "und es entsteht keine zweite Zeile, die Sperre wird übernommen",
    globalThis.__zeilen.length === 1,
  );

  // Und die übernommene Sperre gilt jetzt wieder ab jetzt.
  const gleichDanach = await nurEinmal("email", spaeter, async () => {
    gelaufen++;
    return "drittes";
  });
  pruefe(
    "die übernommene Sperre greift sofort wieder",
    gleichDanach.wiederholung === true && gelaufen === 2,
  );
}

// ── 6. Ein Schreibfehler ist KEIN Konflikt ───────────────────────────────
/*
 * Der Konfliktzweig fing vorher JEDEN Fehler. Eine abgerissene Verbindung
 * ging damit als "schon erledigt" durch und verschluckte die Mail still —
 * im Widerspruch zu Punkt 4, der genau das Gegenteil zusagt. Unterschieden
 * wird jetzt am SQLSTATE 23505.
 */
globalThis.__zeilen = [];
globalThis.__dbSchreibKaputt = true;
{
  let gelaufen = 0;
  const trotzdem = await nurEinmal("email", schluessel("stoerung", "x", "y"), async () => {
    gelaufen++;
    return "akzeptiert";
  });
  pruefe(
    "eine Schreibstörung blockiert nicht, sie lässt durch",
    gelaufen === 1 && trotzdem.wiederholung === false,
  );
}
globalThis.__dbSchreibKaputt = false;

if (fehler > 0) process.exit(1);
console.log(
  "OK — Versandsperre: einmal ausgeführt, Anderes läuft weiter, reserviert vor der Arbeit, " +
    "ohne DB nicht blockiert, und nach dem Fenster wieder offen.",
);
