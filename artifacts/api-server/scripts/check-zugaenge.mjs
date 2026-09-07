/*
 * Prueft den Tresor für Anmeldedaten.
 *
 * Die Sache hat genau EINE Eigenschaft, die sie ueberhaupt rechtfertigt: der
 * Wert geht hinein und kommt nur an einer einzigen Stelle wieder heraus — im
 * Browser-Container, im Moment der Anmeldung. Ueberall sonst darf er nicht
 * auftauchen: nicht in der Liste, nicht im Protokoll, nicht in einer
 * Fehlermeldung, nicht in der Datenbankzeile.
 *
 * Waere er auslesbar, waere der API-Token nicht mehr der Schluessel zu Lukas,
 * sondern zu jedem Konto, das Lukas benutzt. Das ist der ganze Unterschied.
 *
 * Fuenf Dinge, und das dritte ist das, an dem so etwas praktisch immer
 * scheitert:
 *
 *  1. Was gespeichert wird, ist nicht der Klartext.
 *  2. Falscher Schluessel oder veraenderter Kryptotext WERFEN, statt Muell
 *     zu liefern — Muell im Anmeldeformular sperrt nach fuenf Versuchen das
 *     Konto.
 *  3. Die Liste gibt NIE einen Wert zurueck. Ein einziges `...row` beim
 *     Erweitern, und der Kryptotext steht in der API-Antwort.
 *  4. Ohne Schluessel wird NICHT gespeichert. Kein Rueckfall auf Klartext.
 *  5. Zweimal dasselbe Passwort ergibt zwei verschiedene Kryptotexte — sonst
 *     sieht man ohne jeden Schluessel, wo Issa dasselbe Passwort benutzt.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".zugang-check-"));
const out = join(dir, "z.mjs");
const attrappe = join(dir, "attrappe.mjs");

writeFileSync(
  attrappe,
  `const t = (n) => new Proxy({ __name: n }, { get: (o, k) => (k === "__name" ? n : String(k)) });
export const zugaenge = t("zugaenge");
export const eq = (f, w) => (z) => z[f] === w;
export const isNull = (f) => (z) => z[f] === null || z[f] === undefined;
export const isNotNull = (f) => (z) => z[f] !== null && z[f] !== undefined;
export const or = (...b) => (z) => b.filter(Boolean).some((fn) => fn(z));
export const not = (b) => (z) => !b(z);
export const ne = (f, w) => (z) => z[f] !== w;
export const lt = (f, w) => (z) => z[f] < w;
export const lte = (f, w) => (z) => z[f] <= w;
export const notInArray = (f, w) => (z) => !(w ?? []).includes(z[f]);
export const like = () => () => true;
export const and = (...b) => (z) => b.filter(Boolean).every((fn) => fn(z));
export const asc = () => ({});

globalThis.__zeilen = [];
globalThis.__protokoll = [];
export const logger = {
  info(d, m) { globalThis.__protokoll.push(JSON.stringify(d) + " " + (m ?? "")); },
  warn(d, m) { globalThis.__protokoll.push(JSON.stringify(d) + " " + (m ?? "")); },
  error(d, m) { globalThis.__protokoll.push(JSON.stringify(d) + " " + (m ?? "")); },
  debug() {},
};

let id = 0;
export const db = {
  select: () => ({ from: () => {
    const bau = (bed) => ({
      where: (b) => bau(b),
      orderBy: () => bau(bed),
      limit: async () => globalThis.__zeilen.filter((z) => (bed ? bed(z) : true)),
      then: (r, j) => Promise.resolve(globalThis.__zeilen.filter((z) => (bed ? bed(z) : true))).then(r, j),
    });
    return bau(null);
  } }),
  insert: () => ({ values: (v) => ({
    onConflictDoUpdate: ({ set }) => ({ returning: async () => {
      const da = globalThis.__zeilen.find((z) => z.sitzung === v.sitzung && z.feld === v.feld);
      if (da) { Object.assign(da, set); return [da]; }
      const zeile = { id: ++id, createdAt: new Date(), updatedAt: new Date(), zuletztBenutzt: null, ...v };
      globalThis.__zeilen.push(zeile);
      return [zeile];
    } }),
  }) }),
  update: () => ({ set: (w) => ({ where: (b) => {
    const treffer = globalThis.__zeilen.filter(b);
    for (const z of treffer) Object.assign(z, w);
    return Object.assign(Promise.resolve(treffer), { catch: () => Promise.resolve(treffer) });
  } }) }),
  delete: () => ({ where: (b) => ({ returning: async () => {
    const treffer = globalThis.__zeilen.filter(b);
    globalThis.__zeilen = globalThis.__zeilen.filter((z) => !treffer.includes(z));
    return treffer;
  } }) }),
};`,
);

await build({
  entryPoints: ["src/lib/zugaenge.ts"],
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

process.env.LUKAS_TRESOR_SCHLUESSEL = "eine-lange-zufaellige-passphrase-fuer-den-test";
const { setzeZugang, listeZugaenge, loescheZugang, zugangFuer, verfuegbareFelder } =
  await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) { console.error(`FEHLER: ${was}`); fehler++; }
};
const wirft = async (fn, was, muster) => {
  try { await fn(); pruefe(was, false); }
  catch (err) {
    pruefe(was, muster ? muster.test(err.message) : true);
    if (muster && !muster.test(err.message)) console.error(`   (Meldung war: ${err.message})`);
  }
};

const GEHEIM = "S3hr-Geheim-Passwort!";

// ── 1. Gespeichert wird NICHT der Klartext ────────────────────────────────
globalThis.__zeilen = [];
globalThis.__protokoll = [];
{
  await setzeZugang({ sitzung: "Higgsfield", feld: "passwort", wert: GEHEIM, notiz: "Studio-Login" });
  const zeile = globalThis.__zeilen[0];

  pruefe("die Sitzung wird normalisiert", zeile.sitzung === "higgsfield");
  pruefe("das Feld wird großgeschrieben", zeile.feld === "PASSWORT");
  pruefe("der Klartext steht NICHT in der Zeile", !JSON.stringify(zeile).includes(GEHEIM));
  pruefe("stattdessen drei Teile: iv, Prüfsumme, Daten", zeile.geheim.split(":").length === 3);
  pruefe("die Notiz bleibt lesbar", zeile.notiz === "Studio-Login");
  pruefe(
    "und im Protokoll steht der Wert auch nicht",
    !globalThis.__protokoll.join(" ").includes(GEHEIM),
  );
}

// ── 2. Zurück kommt er nur an EINER Stelle ────────────────────────────────
{
  const { werte } = await zugangFuer("higgsfield");
  pruefe("browser_do bekommt den echten Wert", werte.PASSWORT === GEHEIM);
  pruefe("und sonst nichts Fremdes", Object.keys(werte).join() === "PASSWORT");
  pruefe("die Benutzung wird vermerkt", globalThis.__zeilen[0].zuletztBenutzt instanceof Date);
  pruefe(
    "die Feldliste nennt Namen, keine Werte",
    (await verfuegbareFelder("higgsfield")).join() === "PASSWORT",
  );
}

// ── 3. Die Liste gibt NIE einen Wert zurück ───────────────────────────────
/*
 * Der Fall, an dem so etwas praktisch immer scheitert: jemand erweitert die
 * Uebersicht und schreibt `...row` statt die Felder aufzuzaehlen. Dann steht
 * der Kryptotext in der API-Antwort — und der ist zwar verschluesselt, aber
 * er gehoert trotzdem nicht dorthin: er ist genau das, was ein Angreifer
 * offline durchprobieren wuerde.
 */
{
  const liste = await listeZugaenge();
  const roh = JSON.stringify(liste);
  pruefe("die Liste kennt den Eintrag", liste.length === 1 && liste[0].feld === "PASSWORT");
  pruefe("aber NICHT den Klartext", !roh.includes(GEHEIM));
  pruefe("und auch nicht den Kryptotext", !roh.includes(globalThis.__zeilen[0].geheim));
  pruefe("kein Feld heißt 'geheim' oder 'wert'", !/"(geheim|wert)"/.test(roh));
}

// ── 4. Ohne Schlüssel wird NICHT gespeichert ──────────────────────────────
/*
 * Kein Rueckfall auf Klartext, auch nicht "vorerst". Genau so entstehen
 * Klartextpasswoerter, die hinterher niemand mehr findet.
 */
{
  const merk = process.env.LUKAS_TRESOR_SCHLUESSEL;
  delete process.env.LUKAS_TRESOR_SCHLUESSEL;
  const vorher = globalThis.__zeilen.length;
  await wirft(
    () => setzeZugang({ sitzung: "x", feld: "PASSWORT", wert: "geheim" }),
    "ohne Schlüssel wird geworfen",
    /TRESOR_SCHLUESSEL/,
  );
  pruefe("und nichts gespeichert", globalThis.__zeilen.length === vorher);

  process.env.LUKAS_TRESOR_SCHLUESSEL = "kurz";
  await wirft(
    () => setzeZugang({ sitzung: "x", feld: "PASSWORT", wert: "geheim" }),
    "ein zu kurzer Schlüssel wird abgelehnt",
    /zu kurz/,
  );
  process.env.LUKAS_TRESOR_SCHLUESSEL = merk;
}

// ── 5. Zweimal dasselbe ergibt zwei verschiedene Kryptotexte ──────────────
/*
 * Sonst sieht man ohne jeden Schluessel, dass zwei Dienste dasselbe Passwort
 * haben — und genau diese Information traegt einen Einbruch von einem Konto
 * zum naechsten.
 */
{
  await setzeZugang({ sitzung: "dienst-a", feld: "PASSWORT", wert: GEHEIM });
  await setzeZugang({ sitzung: "dienst-b", feld: "PASSWORT", wert: GEHEIM });
  const a = globalThis.__zeilen.find((z) => z.sitzung === "dienst-a").geheim;
  const b = globalThis.__zeilen.find((z) => z.sitzung === "dienst-b").geheim;
  pruefe("gleicher Wert, verschiedener Kryptotext", a !== b);
  pruefe("beide entschlüsseln trotzdem richtig", (await zugangFuer("dienst-a")).werte.PASSWORT === GEHEIM);
}

// ── 6. Verändertes wird erkannt, nicht durchgereicht ──────────────────────
{
  const zeile = globalThis.__zeilen.find((z) => z.sitzung === "dienst-a");
  const [iv, tag, daten] = zeile.geheim.split(":");
  // Ein Bit im Kryptotext drehen.
  const kaputt = Buffer.from(daten, "base64url");
  kaputt[0] ^= 1;
  zeile.geheim = [iv, tag, kaputt.toString("base64url")].join(":");

  const { werte } = await zugangFuer("dienst-a");
  pruefe("ein verändertes Geheimnis wird ÜBERGANGEN, nicht getippt", werte.PASSWORT === undefined);
  pruefe(
    "und der Wert steht auch dabei nicht im Protokoll",
    !globalThis.__protokoll.join(" ").includes(GEHEIM),
  );
}

// ── 7. Falscher Schlüssel liefert keinen Müll ─────────────────────────────
{
  await setzeZugang({ sitzung: "dienst-c", feld: "PASSWORT", wert: GEHEIM });
  process.env.LUKAS_TRESOR_SCHLUESSEL = "eine-voellig-andere-passphrase-die-nicht-passt";
  const { werte } = await zugangFuer("dienst-c");
  pruefe("mit falschem Schlüssel kommt NICHTS zurück", werte.PASSWORT === undefined);
  process.env.LUKAS_TRESOR_SCHLUESSEL = "eine-lange-zufaellige-passphrase-fuer-den-test";
  pruefe(
    "mit dem richtigen wieder der echte Wert",
    (await zugangFuer("dienst-c")).werte.PASSWORT === GEHEIM,
  );
}

// ── 8. Beliebige Felder, nicht nur Benutzer und Passwort ─────────────────
{
  await setzeZugang({ sitzung: "bank", feld: "PIN", wert: "4711" });
  await setzeZugang({ sitzung: "bank", feld: "KUNDENNUMMER", wert: "DE-99" });
  const { werte } = await zugangFuer("bank");
  pruefe("eine PIN geht genauso", werte.PIN === "4711");
  pruefe("und eine Kundennummer auch", werte.KUNDENNUMMER === "DE-99");

  await wirft(
    () => setzeZugang({ sitzung: "bank", feld: "mein feld", wert: "x" }),
    "ein Feldname, der kein Platzhalter sein kann, wird abgelehnt",
    /Feldname/,
  );
  await wirft(() => setzeZugang({ sitzung: "bank", feld: "PIN", wert: "" }), "ein leerer Wert auch");
  await wirft(() => setzeZugang({ sitzung: "", feld: "PIN", wert: "x" }), "und eine leere Sitzung");
}

// ── 9. Umgebungsvariablen bleiben gültig, Datenbank hat Vorrang ───────────
/*
 * Wer den alten Weg schon benutzt, soll nichts umbauen muessen. Aendern kann
 * man aber nur die Datenbank ohne Deployment — deshalb gewinnt sie.
 */
{
  process.env.LUKAS_WEB_ALTMODISCH_USER = "aus-der-umgebung";
  process.env.LUKAS_WEB_ALTMODISCH_PASS = "auch-von-dort";
  let { werte } = await zugangFuer("altmodisch");
  pruefe("die Umgebung wirkt weiterhin", werte.BENUTZER === "aus-der-umgebung");

  await setzeZugang({ sitzung: "altmodisch", feld: "PASSWORT", wert: "aus-dem-tresor" });
  ({ werte } = await zugangFuer("altmodisch"));
  pruefe("der Tresor sticht die Umgebung", werte.PASSWORT === "aus-dem-tresor");
  pruefe("was nur in der Umgebung steht, bleibt", werte.BENUTZER === "aus-der-umgebung");
  delete process.env.LUKAS_WEB_ALTMODISCH_USER;
  delete process.env.LUKAS_WEB_ALTMODISCH_PASS;
}

// ── 10. Löschen löscht ────────────────────────────────────────────────────
{
  pruefe("löschen meldet Erfolg", (await loescheZugang("bank", "pin")) === true);
  pruefe("und der Zugang ist weg", (await zugangFuer("bank")).werte.PIN === undefined);
  pruefe("zweimal löschen meldet ehrlich nichts", (await loescheZugang("bank", "pin")) === false);
}

if (fehler > 0) process.exit(1);
console.log(
  "OK — Zugänge: verschlüsselt gespeichert, nie auslesbar, ohne Schlüssel kein Klartext, Verändertes wird erkannt.",
);
