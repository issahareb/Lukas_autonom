/*
 * Prueft die Stelle, an der Lukas' Antworten verschwunden sind, und dass die
 * reine Ausgabeschicht den privaten Vollkontext nicht ein zweites Mal sendet.
 *
 * Zwei Invarianten werden hier festgehalten:
 *  1. In einen werkzeuglosen Aufruf gelangt kein einziges Werkzeug-Element.
 *  2. Soul, Memories, Ziele und Tagebuch werden nicht erneut uebertragen.
 *  3. Scheitert die Politur trotzdem, geht der fertige Entwurf raus.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".ausgabe-check-"));
const out = join(dir, "voice.mjs");

const attrappe = join(dir, "attrappe.mjs");
writeFileSync(
  attrappe,
  `globalThis.__gesendet = [];
globalThis.__sollScheitern = false;
export const openai = {
  responses: {
    create: async (req) => {
      globalThis.__gesendet.push(req);
      if (globalThis.__sollScheitern) {
        throw new Error("400 No tool output found for function call");
      }
      return { output: [], output_text: "Poliert.", status: "completed" };
    },
  },
};
export const logger = { info() {}, warn() {}, error() {} };
`,
);

await build({
  entryPoints: ["src/lib/ai/voice-renderer.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/integrations-openai-ai": attrappe },
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

const { renderLukasVoice } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

const verlaufMitWerkzeug = [
  { role: "system", content: "Du bist Lukas." },
  { role: "user", content: "Schau dir die Seite an." },
  {
    role: "assistant",
    content: null,
    tool_calls: [
      { id: "call_1", type: "function", function: { name: "browse_page", arguments: '{"url":"https://x.test"}' } },
    ],
  },
  { role: "tool", tool_call_id: "call_1", content: "Seiteninhalt …" },
  { role: "assistant", content: "Ich habe sie gelesen." },
];

const privaterVollkontext = [
  "SOUL_SECRET_MARKER",
  "MEMORY_MARKER",
  "DIARY_MARKER",
  "GOAL_MARKER",
].join("\n");

globalThis.__gesendet = [];
globalThis.__sollScheitern = false;

// Diese Regression prueft den explizit aktivierten Politurpfad.
process.env.LUKAS_VOICE_POLISH = "true";
const antwort = await renderLukasVoice({
  systemPrompt: privaterVollkontext,
  conversation: verlaufMitWerkzeug,
  draft: "Die Seite zeigt drei Clips. Quelle B ist noch unsicher.",
});

pruefe("es wurde genau ein Aufruf gemacht", globalThis.__gesendet.length === 1);

const req = globalThis.__gesendet[0] ?? {};
const serialisiert = JSON.stringify(req);
const eingabe = JSON.stringify(req.input ?? []);

pruefe("der Aufruf hat keine Werkzeuge", !req.tools || req.tools.length === 0);
pruefe("und deshalb auch KEIN function_call", !eingabe.includes("function_call"));
pruefe("und kein function_call_output", !eingabe.includes("function_call_output"));
pruefe("der Entwurf ist trotzdem drin", eingabe.includes("Die Seite zeigt drei Clips"));
pruefe("die Unsicherheit des Entwurfs ist drin", eingabe.includes("Quelle B ist noch unsicher"));
pruefe("und der Dialog auch", eingabe.includes("Schau dir die Seite an"));
pruefe("die sichtbare Identitaet Lukas bleibt fest", eingabe.includes("sichtbare Identitaet ist Lukas"));
pruefe("die Ausgabeschicht darf nichts erfinden", eingabe.includes("Erfinde nichts"));
pruefe("der Entwurf wird nur als Inhalt behandelt", eingabe.includes("zu formulierenden Inhalt"));
pruefe("Soul wird nicht ein zweites Mal gesendet", !serialisiert.includes("SOUL_SECRET_MARKER"));
pruefe("Memories werden nicht ein zweites Mal gesendet", !serialisiert.includes("MEMORY_MARKER"));
pruefe("Tagebuch wird nicht ein zweites Mal gesendet", !serialisiert.includes("DIARY_MARKER"));
pruefe("Ziele werden nicht ein zweites Mal gesendet", !serialisiert.includes("GOAL_MARKER"));
pruefe("die polierte Antwort kommt zurueck", antwort === "Poliert.");

// Scheitert der Aufruf, darf die Antwort NICHT verloren gehen.
globalThis.__gesendet = [];
globalThis.__sollScheitern = true;

const trotzdem = await renderLukasVoice({
  systemPrompt: privaterVollkontext,
  conversation: verlaufMitWerkzeug,
  draft: "Die Seite zeigt drei Clips.",
});
pruefe("bei einem Fehler geht der Entwurf raus", trotzdem === "Die Seite zeigt drei Clips.");

// Ohne Entwurf gibt es nichts zu formulieren — und keinen Aufruf.
globalThis.__gesendet = [];
globalThis.__sollScheitern = false;
const leer = await renderLukasVoice({
  systemPrompt: privaterVollkontext,
  conversation: verlaufMitWerkzeug,
  draft: "   ",
});
pruefe("ohne Entwurf keine Antwort", leer === "");
pruefe("und kein unnoetiger Aufruf", globalThis.__gesendet.length === 0);

if (fehler > 0) process.exit(1);
console.log("OK — Ausgabeschicht: keine Werkzeug-Elemente und kein privater Vollkontext im zweiten Aufruf; Antwort geht nie verloren.");
