/*
 * Prueft die drei Stellen, an denen gespart wird — und die Gegenrichtung, an
 * der Sparen zu Schaden wird.
 *
 *  1. Die Cache-Rechnung. OpenAI zaehlt gecachte Tokens IN den Eingang,
 *     Anthropic DANEBEN. Wer das gleich behandelt, bekommt eine Quote, die
 *     falsch ist — und danach entscheidet man ueber Kosten mit einer erfundenen
 *     Zahl. Genau das stand hier.
 *  2. Das Kontextfenster. Gekuerzt werden darf nur, was ALT ist: die neuesten
 *     Nachrichten und der System-Prompt muessen ueberleben, sonst antwortet er
 *     auf die falsche Frage.
 *  3. Das Ereignis-Tor der Autonomie. Es soll den Lauf ausfallen lassen, wenn
 *     sich nichts bewegt hat — aber niemals, wenn Issa etwas freigegeben oder
 *     geantwortet hat, und niemals dauerhaft (Grundtakt).
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".spar-check-"));
const attrappe = join(dir, "attrappe.mjs");

writeFileSync(
  attrappe,
  `const t = (name) => ({ __name: name });
export const goalsTable = t("goals");
export const approvals = t("approvals");
export const meldungen = t("meldungen");
export const debugLogTable = t("debug");
export const eq = () => () => true;
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
export const inArray = () => () => true;
export const gte = (_f, wert) => (z) => new Date(z.createdAt).getTime() >= new Date(wert).getTime();
export const logger = { info() {}, warn() {}, error() {}, debug() {} };
export const tageskostenTable = new Proxy({}, { get: (_t, k) => String(k) });
export const sql = () => ({});
export const desc = () => ({});

/*
 * Der gespeicherte Autonomie-Stand. Er ist der Kern der Aenderung: die
 * Leerlaufbremse lag vorher im Arbeitsspeicher und war nach jedem Neustart
 * leer — ein Deploy loeste damit sofort einen vollen Agentenlauf aus.
 */
globalThis.__stand = [];
export const autonomieStandTable = t("stand");

// Ein OpenAI-SDK, das nur das tut, was model-client davon braucht: antworten
// und dabei eine Verbrauchsmeldung mitgeben.
globalThis.__usage = {};
export const openai = {
  responses: {
    create: async () => ({ output: [], output_text: "ok", usage: globalThis.__usage }),
  },
};
globalThis.__welt = { goals: [], approvals: [], meldungen: [], debug: [] };
export const db = {
  /* Tabellenbewusst: die Tageskosten schreiben ebenfalls, und sie duerfen den
     Autonomie-Stand nicht mitbefuellen. Genau das hat dieser Test beim ersten
     Anlauf getan und eine falsche Zahl geprueft. */
  insert: (tab) => ({ values: async (v) => {
    if (tab && tab.__name === "stand") globalThis.__stand.push({ id: 1, ...v });
  } }),
  update: () => ({ set: (w) => ({ where: async () => {
    if (globalThis.__stand[0]) Object.assign(globalThis.__stand[0], w);
  } }) }),
  select: () => ({
    from: (tab) => {
      const alle = tab.__name === "stand" ? globalThis.__stand : (globalThis.__welt[tab.__name] ?? []);
      const bau = (bed) => ({
        where: (b) => bau(b),
        orderBy: () => bau(bed),
        limit: async () => alle.filter((z) => (bed ? bed(z) : true)),
        then: (r) => Promise.resolve(alle.filter((z) => (bed ? bed(z) : true))).then(r),
      });
      return bau(null);
    },
  }),
};
`,
);

await build({
  entryPoints: ["src/lib/autonomie-anlass.ts", "src/lib/ai/context-window.ts", "src/lib/ai/model-client.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outdir: dir,
  outExtension: { ".js": ".mjs" },
  alias: {
    "@workspace/db": attrappe,
    "drizzle-orm": attrappe,
    "@workspace/integrations-openai-ai": attrappe,
  },
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

const { anlass, laufNotiert, anlassZuruecksetzen } = await import(
  `file://${join(dir, "autonomie-anlass.mjs")}`
);
const { fitLukasContext } = await import(`file://${join(dir, "ai", "context-window.mjs")}`);
const { callLukasModel, verbrauchsUebersicht } = await import(
  `file://${join(dir, "ai", "model-client.mjs")}`
);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

// ── 1. Cache-Rechnung ─────────────────────────────────────────────────────
// Kein Nachbau der Regel, sondern der echte Code: model-client wird mit einem
// Attrappen-SDK gebuendelt und bekommt Verbrauchsmeldungen vorgesetzt, wie sie
// die beiden Anbieter tatsaechlich schicken.
const quoteAus = (zeilen) => {
  const gelesen = zeilen.reduce((n, z) => n + z.ausCache, 0);
  const ganz = zeilen.reduce((n, z) => n + z.rein + z.ausCache + z.inCache, 0);
  return { gelesen, ganz, prozent: ganz > 0 ? Math.round((gelesen / ganz) * 100) : 0 };
};

const ruf = async (model, usage) => {
  globalThis.__usage = usage;
  await callLukasModel({
    route: { provider: "openai", model, profile: "general", reason: "test" },
    messages: [{ role: "user", content: "hallo" }],
  });
};

// OpenAI: input_tokens ENTHAELT die 8.000 aus dem Cache. Der ganze Eingang
// sind 10.000 — nicht 18.000, wie es die alte Rechnung ergab.
await ruf("test-openai", { input_tokens: 10000, output_tokens: 100, input_tokens_details: { cached_tokens: 8000 } });
{
  const zeile = verbrauchsUebersicht().find((z) => z.model === "test-openai");
  pruefe("OpenAI: frisch bezahlter Eingang ist 2.000", zeile.rein === 2000);
  pruefe("OpenAI: 8.000 kamen aus dem Cache", zeile.ausCache === 8000);
  const q = quoteAus([zeile]);
  pruefe("OpenAI: der ganze Eingang bleibt 10.000", q.ganz === 10000);
  pruefe(`OpenAI: die Quote ist 80% (war ${q.prozent}%)`, q.prozent === 80);
}

// Anthropic meldet dieselbe Lage anders: 2.000 frisch, 8.000 daneben.
globalThis.__usage = {};
globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 2000, output_tokens: 100, cache_read_input_tokens: 8000, cache_creation_input_tokens: 0 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
process.env.ANTHROPIC_API_KEY = "test";
await callLukasModel({
  route: { provider: "anthropic", model: "test-anthropic", profile: "general", reason: "test" },
  messages: [{ role: "user", content: "hallo" }],
});
{
  const zeile = verbrauchsUebersicht().find((z) => z.model === "test-anthropic");
  pruefe("Anthropic: frischer Eingang bleibt 2.000", zeile.rein === 2000);
  pruefe("Anthropic: 8.000 aus dem Cache", zeile.ausCache === 8000);
  const q = quoteAus([zeile]);
  pruefe("Anthropic: derselbe Eingang, dieselbe Zahl — 10.000", q.ganz === 10000);
  pruefe(`Anthropic: dieselbe Quote wie bei OpenAI (war ${q.prozent}%)`, q.prozent === 80);
}
delete process.env.ANTHROPIC_API_KEY;

// ── 2. Kontextfenster ─────────────────────────────────────────────────────
process.env.LUKAS_CONTEXT_MAX_CHARS = "20000";
{
  const lang = (n, text) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `${text} ${i}`.padEnd(2000, ".") }));
  const nachrichten = [{ role: "system", content: "SEELE".padEnd(3000, "!") }, ...lang(40, "alt")];
  nachrichten.push({ role: "user", content: "DIE AKTUELLE FRAGE" });

  const gekuerzt = fitLukasContext(nachrichten);
  pruefe("es wird überhaupt gekürzt", gekuerzt.length < nachrichten.length);
  pruefe(
    "der System-Prompt überlebt",
    gekuerzt.some((m) => m.role === "system" && String(m.content).startsWith("SEELE")),
  );
  pruefe(
    "die aktuelle Frage überlebt — sonst antwortet er auf die falsche",
    gekuerzt[gekuerzt.length - 1].content === "DIE AKTUELLE FRAGE",
  );
  pruefe(
    "geschnitten wird am ALTEN Ende",
    !gekuerzt.some((m) => String(m.content).startsWith("alt 0")),
  );
}
{
  const kurz = [
    { role: "system", content: "SEELE" },
    { role: "user", content: "hallo" },
  ];
  pruefe("ein kurzes Gespräch bleibt unangetastet", fitLukasContext(kurz).length === 2);
}
delete process.env.LUKAS_CONTEXT_MAX_CHARS;

// ── 3. Ereignis-Tor ───────────────────────────────────────────────────────
const D = (msVorher) => new Date(Date.now() - msVorher);
globalThis.__welt = {
  goals: [{ id: 1, status: "active", progress: "läuft", updatedAt: D(60000) }],
  approvals: [],
  meldungen: [],
  debug: [],
};
process.env.LUKAS_AUTONOMY_MIN_PAUSE_MIN = "180";
anlassZuruecksetzen();

pruefe("nach dem Start läuft er sofort", (await anlass()).starten === true);
await laufNotiert();

pruefe("direkt danach und ohne Veränderung nicht nochmal", (await anlass()).starten === false);

// Issa gibt etwas frei — das MUSS ihn wecken.
globalThis.__welt.approvals = [{ id: 5, status: "allowed" }];
let a = await anlass();
pruefe("eine Freigabe weckt ihn", a.starten === true);
pruefe("und er weiß, warum", /bewegt/.test(a.grund));
await laufNotiert();
pruefe("danach ist wieder Ruhe", (await anlass()).starten === false);

// Issa antwortet auf eine Meldung.
globalThis.__welt.meldungen = [
  { id: 1, status: "erledigt", antwort: "Nimm meinen Account.", gelesen: false },
];
pruefe("eine Antwort von Issa weckt ihn", (await anlass()).starten === true);
await laufNotiert();
pruefe("dieselbe Antwort weckt ihn kein zweites Mal", (await anlass()).starten === false);

// Ein Ziel bewegt sich.
globalThis.__welt.goals = [{ id: 1, status: "active", progress: "weiter", updatedAt: new Date() }];
pruefe("ein verändertes Ziel weckt ihn", (await anlass()).starten === true);
await laufNotiert();

// Fehler haeufen sich — und zwar VERSCHIEDENE.
globalThis.__welt.debug = [
  { id: 1, scope: "tool:fetch_url", message: "getaddrinfo ENOTFOUND", createdAt: new Date() },
  { id: 2, scope: "chat", message: "Leere Antwort", createdAt: new Date() },
];
pruefe("zwei Fehler sind noch kein Anlass", (await anlass()).starten === false);
globalThis.__welt.debug.push({
  id: 3, scope: "tool:browser_do", message: "Zeitüberschreitung", createdAt: new Date(),
});
const f = await anlass();
pruefe("drei sind einer", f.starten === true);

/*
 * Und der Fall, der einen ganzen Tag lang 4,2 Millionen Tokens gekostet hat:
 * der Droplet ist tot, JEDES Werkzeug meldet denselben Fehler, dutzendfach.
 *
 * Vorher war die Schwelle von drei damit zu jedem Zeitpunkt gerissen — die
 * Leerlaufbremse war den ganzen Tag wirkungslos, jeder 30-Minuten-Takt lief,
 * und jeder Lauf erzeugte beim Scheitern neue Fehler fuer den naechsten. Eine
 * Rueckkopplung, die sich selbst am Leben haelt.
 *
 * Dreissig Mal dasselbe ist EIN Problem, kein Grund fuer dreissig Laeufe.
 */
await laufNotiert();
globalThis.__welt.debug = Array.from({ length: 30 }, (_, i) => ({
  id: 100 + i,
  scope: "tool:browse_page",
  message: "Der Droplet (1.2.3.4:22) antwortet nicht auf SSH — der Verbindungsaufbau lief in die Zeitüberschreitung.",
  createdAt: new Date(),
}));
const gleiche = await anlass();
pruefe(
  "dreissig Mal DERSELBE Fehler ist kein Anlass für dreissig Läufe",
  gleiche.starten === false,
);

/*
 * Und die zweite Hälfte derselben Sache: ein NEUSTART ist kein Ereignis in
 * Lukas' Welt, sondern eines in meiner.
 *
 * Vorher lag der Stand im Arbeitsspeicher. Nach jedem Deploy war er leer, und
 * "erster Lauf nach dem Start" löste sofort einen vollen Agentenlauf aus — an
 * einem Tag mit einem Dutzend Deployments ein Dutzend zusätzliche Läufe. Und
 * weil ein Lauf selbst Ziele und Tagebuch ändert, lief danach auch der nächste
 * reguläre Takt.
 */
globalThis.__welt.debug = [];
await laufNotiert();
pruefe("nach dem Lauf ist ein Stand gespeichert", globalThis.__stand.length === 1);
{
  // Der Neustart: der Speicher ist leer, die Datenbank nicht.
  anlassZuruecksetzen();
  const nachNeustart = await anlass();
  pruefe(
    "ein Neustart allein löst KEINEN Lauf mehr aus",
    nachNeustart.starten === false,
  );
  pruefe(
    "und der Grund nennt den Grundtakt statt 'erster Lauf'",
    /Grundtakt/.test(nachNeustart.grund),
  );
}

/*
 * Gespeichert ist ein Zeitpunkt, aber KEIN Weltbild — das passiert, wenn die
 * Datenbank direkt nach einem Lauf kurz nicht lesbar war.
 *
 * Dann wird gelaufen, und das ist Absicht: in dieser Lage ist ohnehin etwas
 * nicht in Ordnung, und lieber einmal zu viel als nie wieder. Festgehalten,
 * damit später niemand das für ein Versehen hält und "wegoptimiert".
 */
globalThis.__stand = [{ id: 1, letzterLauf: new Date(), stand: null }];
anlassZuruecksetzen();
{
  const e = await anlass();
  pruefe("ohne gespeichertes Weltbild wird bewusst gelaufen", e.starten === true);
}

// Wirklich noch nie gelaufen: dann natürlich schon.
globalThis.__stand = [];
anlassZuruecksetzen();
pruefe("beim allerersten Mal läuft er sofort", (await anlass()).starten === true);
pruefe("und stehen im Grund", /Fehler/.test(f.grund));
await laufNotiert();

// Grundtakt: irgendwann laeuft er auch ohne Anlass wieder.
globalThis.__welt.debug = [];
process.env.LUKAS_AUTONOMY_MIN_PAUSE_MIN = "0.0001"; // ~6 ms
await new Promise((r) => setTimeout(r, 30));
const g = await anlass();
pruefe("nach dem Grundtakt arbeitet er auch ohne Anlass weiter", g.starten === true);
pruefe("und sagt es auch so", /Grundtakt/.test(g.grund));
delete process.env.LUKAS_AUTONOMY_MIN_PAUSE_MIN;

if (fehler > 0) process.exit(1);
console.log(
  "OK — Sparsamkeit: Cache-Quote stimmt für beide Anbieter, gekürzt wird nur Altes, das Tor lässt Ereignisse immer durch.",
);
