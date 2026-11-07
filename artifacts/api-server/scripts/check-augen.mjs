/*
 * Prueft, dass Lukas die Seite SIEHT — nicht nur ihren Text bekommt.
 *
 * Der Unterschied ist nicht kosmetisch. browser_do liefert Text und eine Liste
 * der Bedienelemente; was dabei nicht ankommt, ist alles Raeumliche: ein
 * Cookie-Banner quer ueber dem Knopf, ein Overlay, eine rote Fehlermeldung
 * neben dem Feld, ein Knopf, der zwar im DOM steht aber ausgegraut ist. Genau
 * daran scheitert die Bedienung fremder Seiten, und genau da hilft ein Bild.
 *
 * Drei Dinge muessen dafuer zusammenkommen, und keins davon ist selbstredend:
 *
 *  1. Das Bild muss als BILD in den Verlauf, nicht als Base64-Text in ein
 *     Werkzeugergebnis. Ein String mit 40.000 Zeichen Base64 ist fuer das
 *     Modell kein Bild, sondern Muell — und kostet dabei mehr als das Bild.
 *  2. Der Router muss danach ein Modell mit Augen waehlen. Ein Bild an ein
 *     reines Textmodell zu schicken ist im besten Fall verschwendet.
 *  3. Alte Bilder muessen wieder raus. Zehn Klicks waeren sonst zehn Bilder im
 *     Kontext — neun davon zeigen einen Zustand, den es nicht mehr gibt.
 *
 * Geprueft wird der ECHTE Durchlauf aus lukas-brain: Modell-Client und
 * Werkzeugschicht sind Attrappen, der Router und die Bildablage sind echt.
 * Sonst wuerde die Pruefung nur ihre eigenen Attrappen bestaetigen.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".augen-check-"));
const out = join(dir, "brain.mjs");
const attrappen = join(dir, "attrappen.mjs");
const ablage = resolve("src/lib/bildablage.ts");

/*
 * Die Attrappen. Wichtig: executeLukasTool ruft das ECHTE merkeBild auf —
 * genau wie browser_do es tut. Waere auch das nachgebaut, pruefte der Test
 * nichts als seine eigene Erfindung.
 */
writeFileSync(
  attrappen,
  `import { merkeBild } from ${JSON.stringify(ablage)};

globalThis.__aufrufe = [];

export async function allLukasTools() { return []; }
export async function executeLukasTool(name, input, ctx) {
  if (name === 'browser_do') {
    merkeBild(ctx.conversationId, 'Bildschirmfoto von https://higgsfield.ai/login', 'BILDDATEN' + globalThis.__aufrufe.length);
    return 'Alle Schritte durch — jetzt auf: Higgsfield (https://higgsfield.ai/login)';
  }
  return 'ok';
}
export async function buildSystemPrompt() { return 'System'; }
// Persistence is outside this vision-routing regression. A build must never
// write fixture conversation 4711 into the deployment's configured database.
export async function withWorkProgress(_scope, _task, fn) { return fn(); }
export function workProgressContext() { return ''; }
export function workProgressTask(task) { return task; }
export function workProgressStatus() {}
export async function planWorkBatch() {}
export async function startWorkStep() {}
export async function finishWorkStep() {}
export async function mitVerbrauchsAuftrag(_quelle, _conversationId, fn) { return fn(); }
export function auftragsStatus() {}
export async function recordEmotion() {}
export async function fuehleWerkzeug() {}
export async function merkeErfahrung() {}
export function recordDebugEvent() {}
export const logger = { info() {}, warn() {}, error() {}, debug() {} };
export async function renderLukasVoice({ draft }) { return draft; }

/*
 * Der Modell-Client. Er merkt sich, was ihm vorgelegt wurde — daran haengt
 * die ganze Pruefung — und ruft zweimal browser_do auf, damit es ueberhaupt
 * ein zweites, aelteres Bild gibt, das entwertet werden kann.
 */
export async function callLukasModel({ route, messages }) {
  globalThis.__aufrufe.push({ route, messages: JSON.parse(JSON.stringify(messages)) });
  const runde = globalThis.__aufrufe.length;
  if (runde <= 2) {
    return {
      content: '',
      toolCalls: [{ id: 't' + runde, name: 'browser_do', arguments: JSON.stringify({ sitzung: 'higgsfield', schritte: [{ art: 'klicke', wahl: 'Anmelden ' + runde }] }) }],
      usage: { input: 100, output: 10 },
    };
  }
  return { content: 'Ich sehe die Anmeldemaske.', toolCalls: [], usage: { input: 100, output: 10 } };
}
export async function callOpenAI() { return { content: '', toolCalls: [] }; }
`,
);

await build({
  entryPoints: ["src/lib/lukas-brain.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  plugins: [
    {
      name: "attrappen",
      setup(b) {
        // Router und Bildablage bleiben ECHT — sie sind der Gegenstand der Prüfung.
        b.onResolve(
          { filter: /(^|\/)(lukas-tools|system-prompt|emotion-engine|logger|debug-log|model-client|voice-renderer|lernen|work-progress|verbrauch-auftrag)$/ },
          () => ({ path: attrappen }),
        );
      },
    },
  ],
  logLevel: "silent",
});

const { runLukasTurn } = await import(`file://${out}`);

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

globalThis.__aufrufe = [];
const antwort = await runLukasTurn({
  history: [{ role: "user", content: "Melde dich bei Higgsfield an." }],
  userText: "Melde dich bei Higgsfield an.",
  conversationId: 4711,
});
rmSync(dir, { recursive: true, force: true });

const aufrufe = globalThis.__aufrufe;
pruefe("der Durchlauf kommt zu einer Antwort", typeof antwort === "string" && antwort.length > 0);
pruefe("und braucht dafür drei Modellrunden", aufrufe.length === 3);

// ── 1. Das Bild landet als Bild im Verlauf ───────────────────────────────
const bildTeile = (nachrichten) =>
  nachrichten
    .filter((m) => Array.isArray(m.content))
    .flatMap((m) => m.content)
    .filter((t) => t?.type === "image_url");

const zweite = aufrufe[1].messages;
pruefe(
  "nach dem Klick sieht Lukas ein Bild",
  bildTeile(zweite).length === 1,
);
pruefe(
  "und es ist ein JPEG als Daten-URL, kein Base64-Text in einem Werkzeugergebnis",
  bildTeile(zweite)[0]?.image_url?.url?.startsWith("data:image/jpeg;base64,"),
);
pruefe(
  "die Base64-Daten stehen NICHT im Text — dort wären sie nur teurer Müll",
  !JSON.stringify(zweite.filter((m) => m.role === "tool")).includes("BILDDATEN"),
);
pruefe(
  "die Bildnachricht steht NACH dem Werkzeugergebnis (sonst weist die API den Aufruf zurück)",
  zweite.findIndex((m) => Array.isArray(m.content) && m.content.some((t) => t?.type === "image_url")) >
    zweite.findIndex((m) => m.role === "tool"),
);

// ── 2. Der Router schaltet auf ein Modell mit Augen ──────────────────────
pruefe(
  "die erste Runde braucht noch kein Bildmodell",
  aufrufe[0].route.profile !== "vision",
);
pruefe(
  "ab dem ersten Bild aber schon",
  aufrufe[1].route.profile === "vision" && aufrufe[2].route.profile === "vision",
);

// ── 3. Das alte Bild fliegt wieder raus ──────────────────────────────────
const dritte = aufrufe[2].messages;
pruefe(
  "beim zweiten Klick steht nur noch EIN Bild im Kontext, nicht zwei",
  bildTeile(dritte).length === 1,
);
// Das Bild aus der ZWEITEN Werkzeugrunde trägt die Kennung BILDDATEN2 (die
// Attrappe zählt die Modellaufrufe mit); das aus der ersten BILDDATEN1.
pruefe(
  "und zwar das neue, nicht das überholte",
  bildTeile(dritte)[0]?.image_url?.url?.endsWith("BILDDATEN2"),
);
pruefe(
  "vom alten bleibt die Zeile stehen, damit sichtbar bleibt, dass er hingesehen hat",
  JSON.stringify(dritte).includes("Bild entfernt"),
);

// ── 4. Die Ablage selbst ─────────────────────────────────────────────────
const { merkeBild, nimmBilder, entwerteAlteBilder, BILD_MARKE } = await import(
  `file://${await (async () => {
    const d2 = mkdtempSync(join(process.cwd(), ".augen-check2-"));
    const o2 = join(d2, "ablage.mjs");
    await build({ entryPoints: [ablage], bundle: true, format: "esm", platform: "node", outfile: o2, logLevel: "silent" });
    return o2;
  })()}`
);

// Höchstens zwei Bilder pro Runde — jedes kostet rund 2.500 Tokens.
for (let i = 0; i < 5; i++) merkeBild(1, "q" + i, "D" + i);
const geholt = nimmBilder(1);
pruefe("höchstens zwei Bilder pro Runde", geholt.length === 2);
pruefe("und behalten wird das Jüngste", geholt[1].datenUrl.endsWith("D4"));
pruefe("zweimal abholen gibt nichts mehr — sonst stünde es doppelt im Kontext", nimmBilder(1).length === 0);
pruefe("ohne Conversation-ID wird nichts gemerkt", (merkeBild(undefined, "q", "D"), nimmBilder(undefined).length === 0));
pruefe("ein leeres Bild auch nicht", (merkeBild(2, "q", ""), nimmBilder(2).length === 0));

// Issas eigene Anhänge sind KEINE Werkzeugbilder und dürfen nicht wegfliegen.
const verlauf = [
  { role: "user", content: [{ type: "text", text: "Was steht auf dem Foto?" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,ISSA" } }] },
  { role: "user", content: [{ type: "text", text: `Bildschirmfoto${BILD_MARKE}` }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,WERKZEUG" } }] },
];
entwerteAlteBilder(verlauf);
pruefe(
  "Issas eigenes Bild bleibt im Verlauf",
  verlauf[0].content.some((t) => t.type === "image_url"),
);
pruefe(
  "das Werkzeugbild dagegen nicht",
  !verlauf[1].content.some((t) => t.type === "image_url"),
);

for (const rest of (await import("node:fs")).readdirSync(process.cwd()).filter((n) => n.startsWith(".augen-check")))
  rmSync(join(process.cwd(), rest), { recursive: true, force: true });

if (fehler > 0) process.exit(1);
console.log(
  "OK — Augen: das Bildschirmfoto kommt als Bild an, der Router schaltet auf ein Modell mit Augen, alte Bilder fliegen raus.",
);
