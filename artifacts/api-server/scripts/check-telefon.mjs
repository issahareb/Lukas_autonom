/*
 * Prueft, wie aus dem, was ein Telefonanbieter schickt, eine Nummer wird.
 *
 * Das ist die sicherheitskritische Stelle des ganzen Telefonwegs: an ihr
 * entscheidet sich, WELCHEN Lukas ein Anrufer bekommt. Greift sie daneben,
 * bekommt ein Fremder Issas privates Gedaechtnis ans Ohr — oder Issa selbst
 * wird nicht erkannt und redet mit dem oeffentlichen Lukas.
 *
 * Dieselbe Nummer kommt je nach Anbieter und Route in mindestens fuenf
 * Schreibweisen an. Alle muessen auf denselben Schluessel fallen.
 */
import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".telefon-check-"));
const out = join(dir, "telefon.mjs");
const attrappe = join(dir, "attrappe.mjs");

writeFileSync(
  attrappe,
  `
export const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [globalThis.telefonEintrag] }) }) }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  insert: () => ({ values: (row) => { globalThis.telefonProtokoll.push(row); return Promise.resolve(); } }),
};
export const telefonNummern = {}; export const telefonAnrufe = {};
export const eq = () => ({}); export const desc = () => ({});
export const logger = { warn() {}, info() {}, error() {} };
export const buildSystemPrompt = async () => "privat";
export const buildPublicSystemPrompt = async () => "oeffentlich";
export const SPRACH_REGEL = ""; export const sprachAudio = () => ({});
export const sprachModell = () => "gpt-live-1";
export const acceptLiveSipSession = async (options) => {
  globalThis.telefonAnnahmen.push(options);
  if (globalThis.telefonAnnahmeFehler) throw new Error("temporary accept failure");
};
export const rejectLiveSipSession = async () => {};
`,
);

await build({
  entryPoints: ["src/lib/telefon.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
  plugins: [
    {
      name: "attrappen",
      setup(b) {
        b.onResolve({ filter: /^\.\// }, (args) =>
          args.importer.endsWith("telefon.ts") && args.path !== "./telnyx" ? { path: attrappe } : undefined,
        );
      },
    },
  ],
});

const { normalisiere, nummerAusSip, tatsaechlicheStufe, starteAnruf, nimmAn } = await import(out);

let fehler = 0;
const pruefe = (bedingung, text) => {
  if (!bedingung) {
    console.error("FEHLER — " + text);
    fehler++;
  }
};

const ERWARTET = "4915112345678";

// ── 1. Dieselbe Nummer, viele Schreibweisen ────────────────────────────────
for (const [roh, wie] of [
  ["+49 151 12345678", "international mit Leerzeichen"],
  ["+4915112345678", "international kompakt"],
  ["004915112345678", "mit Amtsnullen"],
  ["49-151-12345678", "mit Bindestrichen"],
  ["(+49) 151 / 123 456 78", "mit Klammern und Schraegstrich"],
]) {
  pruefe(normalisiere(roh) === ERWARTET, `${wie}: "${roh}" muss ${ERWARTET} ergeben, war ${normalisiere(roh)}`);
}

// ── 2. Aus dem SIP-From-Header ─────────────────────────────────────────────
for (const [header, wie] of [
  ['"Issa" <sip:+4915112345678@sip.twilio.com>', "mit Anzeigename und Plus"],
  ["<sip:4915112345678@sip.api.openai.com>", "spitze Klammern"],
  ["sip:4915112345678@host;transport=tls", "mit Transport-Parameter"],
  ['"Issa Hareb" <sip:004915112345678@host>;tag=abc123', "mit Tag hinten dran"],
]) {
  pruefe(
    nummerAusSip(header) === ERWARTET,
    `${wie}: ${header} muss ${ERWARTET} ergeben, war ${nummerAusSip(header)}`,
  );
}

// ── 3. Was NICHT durchgehen darf ───────────────────────────────────────────
// Eine fremde Nummer darf niemals auf Issas Schluessel fallen — sonst reicht
// ein aehnlich aussehender Header, um an den privaten Lukas zu kommen.
for (const fremd of [
  '"Issa" <sip:4915199999999@host>',
  "<sip:4930123456@host>",
  '"4915112345678" <sip:4930999999@host>',
]) {
  pruefe(
    nummerAusSip(fremd) !== ERWARTET,
    `Fremde Nummer darf nicht als Issa gelten: ${fremd} ergab ${nummerAusSip(fremd)}`,
  );
}

// Der Anzeigename wird zuletzt genannt, die echte Nummer steht in der URI —
// wer den Namen zuerst liest, laesst sich mit einem gefaelschten Namen
// hereinlegen.
pruefe(
  nummerAusSip('"4915112345678" <sip:4930999999@host>') === "4930999999",
  "Die Nummer muss aus der sip:-URI kommen, nicht aus dem frei waehlbaren Anzeigenamen",
);

// ── 4. Unbrauchbares faellt auf leer, nicht auf irgendwas ─────────────────
for (const murks of ["", "anonymous", "<sip:anonymous@anonymous.invalid>"]) {
  pruefe(
    normalisiere(nummerAusSip(murks)).length === 0,
    `Ohne Nummer muss leer herauskommen: "${murks}" ergab "${nummerAusSip(murks)}"`,
  );
}

// ── 5. Die Rufnummernanzeige als Ausweis — und der strenge Schalter ──────
/*
 * Die eigentliche Schwachstelle des Telefonwegs: die Nummer im From-Header
 * behauptet das anrufende Netz. Mit einem VoIP-Anschluss ist sie frei setzbar.
 * Wer Issas Nummer und Lukas' Nummer kennt, laesst sich sonst ansagen, was
 * Lukas ueber Issa weiss.
 *
 * Geprueft wird beides — dass der strenge Schalter wirkt, UND dass er Issa
 * nicht aussperrt, wenn LUKAS SELBST angerufen hat. Ein Schalter, der auch
 * die eigenen Rueckrufe abwuergt, wuerde als Erstes wieder abgeschaltet.
 */
/*
 * OHNE Konfiguration bleibt es beim bequemen Verhalten — Issas Entscheidung.
 * Das Risiko (fälschbare Rufnummer) steht in docs/SICHERHEITSMODELL.md; die
 * Abwägung trifft er.
 */
delete process.env.LUKAS_TELEFON_STRENG;
pruefe(
  tatsaechlicheStufe("privat", false, "4915112345678") === "privat",
  "ohne Schalter bleibt es beim bequemen Verhalten",
);

process.env.LUKAS_TELEFON_STRENG = "true";
pruefe(
  tatsaechlicheStufe("privat", false, "4915112345678") === "oeffentlich",
  "streng: ein EINGEHENDER Anruf bekommt nie den privaten Prompt",
);
pruefe(
  tatsaechlicheStufe("privat", true, "4915112345678") === "privat",
  "streng: ein Anruf, den LUKAS gewählt hat, schon — sonst wäre der Rückruf wertlos",
);
pruefe(
  tatsaechlicheStufe("gesperrt", true, "4915112345678") === "gesperrt",
  "gesperrt bleibt gesperrt, auch wenn Lukas selbst gewählt hat",
);
pruefe(
  tatsaechlicheStufe("oeffentlich", false, "4930999999") === "oeffentlich",
  "und öffentlich wird durch den Schalter nicht privater",
);
delete process.env.LUKAS_TELEFON_STRENG;

// Accept retries retain outgoing context; successful calls consume it.
const telefonEnv = ["LUKAS_TELEFON_STRENG", "LUKAS_TELEFON_ANBIETER", "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN", "TWILIO_API_KEY", "TWILIO_API_SECRET", "TWILIO_NUMMER", "OPENAI_PROJECT_ID"];
const vorigeEnv = new Map(telefonEnv.map(key => [key, process.env[key]])), vorigesFetch = globalThis.fetch;
try {
  Object.assign(process.env, { LUKAS_TELEFON_STRENG: "true", LUKAS_TELEFON_ANBIETER: "twilio",
    TWILIO_ACCOUNT_SID: "AC_test_only", TWILIO_AUTH_TOKEN: "local-test-only", TWILIO_NUMMER: "+49201123456", OPENAI_PROJECT_ID: "proj_test_only" });
  delete process.env.TWILIO_API_KEY; delete process.env.TWILIO_API_SECRET;
  globalThis.telefonEintrag = { id: 1, nummer: ERWARTET, name: "Testkontakt", stufe: "privat", darfAngerufenWerden: true };
  globalThis.telefonAnnahmen = []; globalThis.telefonProtokoll = []; globalThis.telefonAnnahmeFehler = true;
  const gewaehlt = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.twilio.com/2010-04-01/Accounts/AC_test_only/Calls.json");
    assert.equal(options.method, "POST"); gewaehlt.push(options);
    return new Response(JSON.stringify({ sid: "CA_test_only" }), { status: 201 });
  };
  const anlass = "Besprechung zum Rückruf";
  await starteAnruf("+" + ERWARTET, anlass);
  assert.equal(gewaehlt.length, 1); assert.equal(gewaehlt[0].body.get("To"), "+" + ERWARTET);
  await assert.rejects(nimmAn("live_retry", "+" + ERWARTET), /temporary accept failure/);
  assert.equal(globalThis.telefonAnnahmen[0].visibility, "private");
  assert.ok(globalThis.telefonAnnahmen[0].instructions.includes(anlass));
  globalThis.telefonAnnahmeFehler = false;
  assert.equal(await nimmAn("live_retry", "+" + ERWARTET), "privat");
  const wiederholung = globalThis.telefonAnnahmen[1];
  assert.equal(wiederholung.visibility, "private"); assert.equal(wiederholung.allowTools, false);
  assert.ok(wiederholung.instructions.includes(anlass)); assert.match(wiederholung.instructions, /DU HAST ANGERUFEN/);
  assert.ok(wiederholung.initialCommentary.includes(anlass));
  assert.equal(globalThis.telefonProtokoll.at(-1).richtung, "ausgehend");
  assert.equal(globalThis.telefonProtokoll.at(-1).anlass, anlass);
  assert.equal(await nimmAn("live_unrelated_incoming", "+" + ERWARTET), "oeffentlich");
  const danach = globalThis.telefonAnnahmen[2];
  assert.equal(danach.visibility, "public"); assert.equal(danach.allowTools, false);
  assert.ok(!danach.instructions.includes(anlass)); assert.doesNotMatch(danach.instructions, /DU HAST ANGERUFEN/);
  assert.equal(globalThis.telefonProtokoll.at(-1).richtung, "eingehend");
  assert.equal(gewaehlt.length, 1, "Retry must not dial again");
} finally {
  globalThis.fetch = vorigesFetch;
  for (const [key, value] of vorigeEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  delete globalThis.telefonEintrag; delete globalThis.telefonAnnahmen; delete globalThis.telefonProtokoll; delete globalThis.telefonAnnahmeFehler;
}

rmSync(dir, { recursive: true, force: true });

if (fehler > 0) {
  console.error(`\n${fehler} Fehler in der Nummernerkennung.`);
  process.exit(1);
}
console.log("OK — Telefon: alle Schreibweisen treffen denselben Schlüssel, Fremdes bleibt fremd.");
