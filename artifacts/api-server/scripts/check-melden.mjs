/*
 * Prueft, was passiert, wenn Lukas bei seiner eigenen Arbeit etwas von Issa
 * braucht.
 *
 * Eine Meldung hat einen ZUSTAND — sie ist offen, bis Issa geantwortet hat.
 * Daran haengen drei Dinge, die alle leicht kaputtzumachen sind:
 *
 *  1. Keine Wiederholung. Der autonome Lauf startet immer wieder neu; ohne
 *     Sperre landet dieselbe offene Frage bei jedem Durchlauf erneut im Tab.
 *     Nach einem Tag waeren das 48 identische Eintraege, und danach liest sie
 *     niemand mehr.
 *  2. Die Gegenrichtung: eine ANDERE Sache muss sofort durchkommen. Eine
 *     Sperre, die alles blockiert, waere dasselbe wie keine Meldung.
 *  3. Die Antwort muss bei Lukas ankommen. Sonst ist der Tab eine Sackgasse:
 *     er fragt, Issa antwortet, und er erfaehrt es nie.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".melde-check-"));
const out = join(dir, "melden.mjs");

/*
 * Eine Attrappe mit einer echten kleinen Tabelle im Speicher. Gegen eine
 * Attrappe, die nur "ok" sagt, koennte man die Zustandslogik gar nicht pruefen
 * — und genau die ist hier der Inhalt.
 */
const attrappe = join(dir, "attrappe.mjs");
writeFileSync(
  attrappe,
  `globalThis.__tabelle ??= [];
globalThis.__id ??= 0;

export const meldungen = { betreff: "betreff", status: "status", id: "id", gelesen: "gelesen", erledigtAt: "erledigtAt", createdAt: "createdAt" };

// Bedingungen werden als Funktion ueber eine Zeile abgebildet.
export const eq = (feld, wert) => (z) => z[feld] === wert;
export const and = (...fns) => (z) => fns.every((f) => f(z));
export const desc = () => ({});
export const asc = () => ({});

const treffer = (bed) => globalThis.__tabelle.filter((z) => (bed ? bed(z) : true));

export const db = {
  insert: () => ({
    values: (v) => ({
      returning: async () => {
        const zeile = {
          id: ++globalThis.__id,
          antwort: null,
          gelesen: false,
          status: "offen",
          erledigtAt: null,
          createdAt: new Date(),
          ...v,
        };
        globalThis.__tabelle.push(zeile);
        return [zeile];
      },
    }),
  }),
  select: () => ({
    from: () => {
      const bau = (bed) => ({
        where: (b) => bau(b),
        orderBy: () => bau(bed),
        limit: async () => treffer(bed),
        then: (r) => Promise.resolve(treffer(bed)).then(r),
      });
      return bau(null);
    },
  }),
  update: () => ({
    set: (werte) => ({
      where: (bed) => ({
        returning: async () => {
          const zeilen = treffer(bed);
          for (const z of zeilen) Object.assign(z, werte);
          return zeilen;
        },
        then: (r) => {
          const zeilen = treffer(bed);
          for (const z of zeilen) Object.assign(z, werte);
          return Promise.resolve(zeilen).then(r);
        },
      }),
    }),
  }),
};

export const logger = { info() {}, warn() {}, error() {} };
`,
);

await build({
  entryPoints: ["src/lib/melden.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
  plugins: [
    {
      name: "attrappen",
      setup(b) {
        b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: attrappe }));
      },
    },
  ],
  logLevel: "silent",
});

const { meldeDichBeiIssa, beantworteMeldung, neueAntworten, offeneAnzahl } = await import(
  `file://${out}`
);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

// 1. Die erste Meldung landet im Tab und ist offen.
const erste = await meldeDichBeiIssa({
  betreff: "Higgsfield-Zugang fehlt",
  text: "Ich komme an die Projektseite nicht ran, dort ist eine Anmeldung nötig.",
});
pruefe("die Meldung wird angelegt", globalThis.__tabelle.length === 1);
pruefe("und ist offen", globalThis.__tabelle[0].status === "offen");
pruefe("die Zahl der offenen stimmt", (await offeneAnzahl()) === 1);
pruefe("er erfährt, wo sie liegt", erste.includes("Meldungen"));
pruefe("und dass er weiterarbeiten soll", erste.includes("weiter"));

// 2. Dieselbe Sache noch einmal, solange sie offen ist: nichts Neues.
const zweite = await meldeDichBeiIssa({
  betreff: "Higgsfield-Zugang fehlt",
  text: "Immer noch das gleiche Problem.",
});
pruefe("keine zweite Meldung zur selben Sache", globalThis.__tabelle.length === 1);
pruefe("und er erfährt, warum nicht", zweite.includes("schon offen"));

// 3. Eine ANDERE Sache muss sofort durchkommen.
await meldeDichBeiIssa({
  betreff: "Sollen die alten Moltbook-Einträge weg?",
  text: "Sie machen die Übersicht unlesbar.",
});
pruefe("eine andere Sache kommt durch", globalThis.__tabelle.length === 2);
pruefe("dann sind zwei offen", (await offeneAnzahl()) === 2);

// 4. Issa antwortet — die Meldung ist erledigt.
await beantworteMeldung(1, "Nimm meinen Higgsfield-Account, Zugang liegt im Passwortmanager.");
pruefe("die Meldung ist erledigt", globalThis.__tabelle[0].status === "erledigt");
pruefe("nur noch eine offen", (await offeneAnzahl()) === 1);

// 5. Und die Antwort kommt bei Lukas an — genau EINMAL.
const antwort = await neueAntworten();
pruefe("die Antwort erreicht ihn", antwort.includes("Passwortmanager"));
pruefe("mit dem Betreff dazu", antwort.includes("Higgsfield-Zugang fehlt"));
pruefe("und seiner ursprünglichen Frage", antwort.includes("Anmeldung nötig"));

const nochmal = await neueAntworten();
pruefe("beim zweiten Mal nicht erneut", nochmal === "");

// 6. Ist die Sache erledigt, darf er sie wieder melden — sie könnte ja
//    weiterhin klemmen.
await meldeDichBeiIssa({ betreff: "Higgsfield-Zugang fehlt", text: "Der Zugang geht nicht." });
pruefe("nach der Antwort ist eine neue Meldung möglich", globalThis.__tabelle.length === 3);

// 7. Ohne Inhalt gibt es keine Meldung.
for (const leer of [
  { betreff: "", text: "irgendwas" },
  { betreff: "irgendwas", text: "" },
  { betreff: "   ", text: "   " },
]) {
  let geworfen = false;
  try {
    await meldeDichBeiIssa(leer);
  } catch {
    geworfen = true;
  }
  pruefe(`leere Meldung wird abgelehnt (${JSON.stringify(leer)})`, geworfen);
}
pruefe("und nichts wurde angelegt", globalThis.__tabelle.length === 3);

if (fehler > 0) process.exit(1);
console.log("OK — Meldungen: kein Doppel, andere Sachen kommen durch, Antworten erreichen Lukas.");
