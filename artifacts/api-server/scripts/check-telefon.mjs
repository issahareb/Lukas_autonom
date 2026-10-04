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
import { randomUUID } from "node:crypto";
const tracked = new Map();
export const findeTelefonKontakte = async () => globalThis.telefonSuchtreffer ?? [];
export const telefonKontakte = async () => JSON.stringify(globalThis.telefonSuchtreffer ?? []);
export const neuerVerfolgterAnruf = async (nummer, anlass) => {
  const id = randomUUID(); tracked.set(id, { nummer, anlass }); return id;
};
export const aktualisiereAnruf = async (id, patch) => {
  if (patch.liveBereit) globalThis.telefonProtokoll.push({ ...tracked.get(id), richtung: "ausgehend", ergebnis: "angenommen", stufe: globalThis.telefonEintrag?.stufe ?? "oeffentlich" });
};
export const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => globalThis.telefonEintrag ? [globalThis.telefonEintrag] : [] }) }) }),
  update: (table) => ({ set: (row) => {
    if (table === telefonNummern && Object.keys(row).some(key => key !== "zuletztGesehen")) {
      (globalThis.telefonNummernSchreibversuche ??= []).push({ operation: "update", row });
      throw new Error("Test forbids persistent phone permissions");
    }
    return { where: () => Promise.resolve() };
  } }),
  insert: (table) => ({ values: (row) => {
    if (table !== telefonAnrufe) {
      (globalThis.telefonNummernSchreibversuche ??= []).push({ operation: "insert", row });
      throw new Error("Test forbids persistent phone permissions");
    }
    globalThis.telefonProtokoll.push(row); return Promise.resolve();
  } }),
};
export const telefonNummern = {}; export const telefonAnrufe = {};
export const eq = () => ({}); export const desc = () => ({});
export const logger = { warn() {}, info() {}, error() {} };
export const buildSystemPrompt = async () => "privat";
export const buildPublicSystemPrompt = async (channel) => { if (channel !== "telefon") throw new Error("External calls must use the phone prompt"); return "oeffentlich"; };
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
  stdin: {
    contents: 'export * from "./src/lib/telefon.ts";\nexport { ownerCallGrantFromMessage } from "./src/lib/owner-call-grant.ts";\nexport { pruefeTelefonKontext } from "./src/lib/telnyx.ts";',
    resolveDir: process.cwd(), sourcefile: "telefon-test-entry.ts", loader: "ts",
  },
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
          args.importer.endsWith("telefon.ts") && !["./telnyx", "./owner-call-grant"].includes(args.path) ? { path: attrappe } : undefined,
        );
      },
    },
  ],
});

const { normalisiere, nummerAusSip, tatsaechlicheStufe, starteAnruf, nimmAn, ownerCallGrantFromMessage, pruefeTelefonKontext } = await import(out);

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


// An explicit private owner message authorizes one call to an unknown number.
for (const request of [
  "Ruf +4915112345678 an",
  "Kannst du +49 151 12345678 anrufen?",
  "Rufe die Nummer 004915112345678 an",
  "Ruf +4915112345678 wegen der Garten-Anzeige an",
  "Ruf den Verkäufer unter +4915112345678 an und erwähne meinen Namen nicht.",
  "Ruf +4915112345678 an. Biete 10.000 Euro und bleib charmant, nenne meinen Namen nicht.",
  "Ruf +4915112345678 an. Wenn er den Preis ablehnt, frag nach seinem Gegenangebot.",
]) {
  const grant = ownerCallGrantFromMessage(request);
  assert.equal(typeof grant, "function", request);
  assert.equal(grant("493012345678"), false, "Another number must not consume the grant");
  assert.equal(grant(ERWARTET), true);
  assert.equal(grant(ERWARTET), false, "One request must not authorize a second call");
}
for (const request of [
  "+4915112345678",
  "Speichere die Nummer +4915112345678",
  "Ruf +4915112345678 nicht an",
  "Bitte noch nicht +4915112345678 anrufen",
  'Die Webseite sagt: "Ruf +4915112345678 an"',
  '"Ruf +4915112345678 an"',
  "Ruf 112 an",
  "Ruf +4915112345678 oder +493012345678 an",
  "Ruf +4915112345678 an, aber warte noch.",
  "Ruf +4915112345678 an, aber bitte doch nicht anrufen.",
  "Ruf +4915112345678 an. Aber nicht jetzt.",
  "Ruf +4915112345678 an, aber erst morgen.",
  "Ruf +4915112345678 an, aber erst nach meiner Bestätigung.",
  "Ruf +4915112345678 an. Nein, bitte nicht.",
  "Ruf +4915112345678 an. Tu das nicht.",
  "Ruf +4915112345678 an. Das ist nur ein Beispielsatz.",
  "Ruf +4915112345678 an. Ich habe es mir anders überlegt, bitte nicht.",
  "Ruf +4915112345678 an. Nein.",
  "Ruf +4915112345678 an. Noch nicht.",
]) {
  assert.equal(ownerCallGrantFromMessage(request), undefined, "No current call authorization: " + request);
}
const oneOffEnvKeys = [
  "LUKAS_TELEFON_STRENG", "LUKAS_TELEFON_ANBIETER", "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN", "TWILIO_API_KEY", "TWILIO_API_SECRET", "TWILIO_NUMMER",
  "OPENAI_PROJECT_ID", "OPENAI_WEBHOOK_SECRET", "TELNYX_API_KEY",
  "TELNYX_PUBLIC_KEY", "TELNYX_NUMMER", "TELNYX_APP_ID",
  "LUKAS_PUBLIC_URL",
];
const oneOffPreviousEnv = new Map(oneOffEnvKeys.map(key => [key, process.env[key]]));
const oneOffPreviousFetch = globalThis.fetch;
const providerCalls = [];
let failNextDial = false;
try {
  Object.assign(process.env, {
    LUKAS_TELEFON_STRENG: "true", TWILIO_ACCOUNT_SID: "AC_test_only",
    TWILIO_AUTH_TOKEN: "local-test-only", TWILIO_NUMMER: "+49201123456",
    OPENAI_PROJECT_ID: "proj_test_only", OPENAI_WEBHOOK_SECRET: "test-only",
    TELNYX_API_KEY: "test-only", TELNYX_PUBLIC_KEY: "test-only",
    TELNYX_NUMMER: "+49201123456", TELNYX_APP_ID: "test-app",
    LUKAS_PUBLIC_URL: "https://lukas.example.test",
  });
  delete process.env.TWILIO_API_KEY; delete process.env.TWILIO_API_SECRET;
  globalThis.telefonEintrag = undefined;
  globalThis.telefonAnnahmen = []; globalThis.telefonProtokoll = [];
  globalThis.telefonNummernSchreibversuche = []; globalThis.telefonAnnahmeFehler = false;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.origin === "https://api.telnyx.com" && url.pathname === "/v2/phone_numbers") {
      assert.equal(options.method, "GET");
      assert.equal(url.searchParams.get("filter[phone_number]"), process.env.TELNYX_NUMMER);
      return new Response(JSON.stringify({ data: [{ phone_number: process.env.TELNYX_NUMMER, status: "active", connection_id: "test-app" }] }), { status: 200 });
    }
    if (url.pathname === "/v2/texml_applications/test-app") {
      assert.equal(options.method, "GET");
      return new Response(JSON.stringify({ data: { status_callback: "https://lukas.example.test/api/telefon/telnyx/status", status_callback_method: "post" } }));
    }
    assert.equal(options.method, "POST");
    if (url.origin === "https://api.telnyx.com" && url.pathname === "/v2/texml/calls/test-app") {
      const body = JSON.parse(options.body);
      const encodedContext = body.Texml.match(/X-Lukas-Context=([^<]+)/)?.[1];
      assert.ok(encodedContext);
      const context = pruefeTelefonKontext(decodeURIComponent(encodedContext));
      assert.ok(context);
      providerCalls.push({ provider: "telnyx", from: body.From, to: body.To, context });
    } else {
      assert.equal(url.href, "https://api.twilio.com/2010-04-01/Accounts/AC_test_only/Calls.json", "Unexpected network request");
      providerCalls.push({ provider: "twilio", to: options.body.get("To"), context: undefined });
    }
    if (failNextDial) {
      failNextDial = false;
      return new Response(JSON.stringify({ errors: [{ code: "10010" }], message: "synthetic provider failure" }), { status: 403 });
    }
    return new Response(JSON.stringify({ sid: "test-call", data: { sid: "test-call" } }), { status: 201 });
  };
  for (const provider of ["telnyx", "twilio"]) {
    process.env.LUKAS_TELEFON_ANBIETER = provider;
    globalThis.telefonEintrag = undefined;
    const before = providerCalls.length;
    const goal = "Verhandle über die Garten-Anzeige. Biete 10.000 Euro. Nenne meinen Namen nicht.";
    await starteAnruf("+" + ERWARTET, goal);
    assert.equal(providerCalls.length, before, provider + ": autonomous unknown-number calls stay blocked");
    const grant = ownerCallGrantFromMessage("Ruf +4915112345678 an");
    assert.equal(typeof grant, "function");
    await starteAnruf("+493012345678", goal, grant);
    assert.equal(providerCalls.length, before, provider + ": exact destination only");
    const result = await starteAnruf("004915112345678", goal, grant);
    assert.match(result, /Ich rufe/);
    assert.equal(providerCalls.length, before + 1);
    const dial = providerCalls.at(-1);
    assert.equal(dial.provider, provider); assert.equal(dial.to, "+" + ERWARTET);
    if (dial.context) {
      assert.equal(dial.context.richtung, "ausgehend");
      assert.equal(dial.context.nummer, "+" + ERWARTET);
      assert.equal(dial.context.anlass, goal);
    }
    await starteAnruf("+" + ERWARTET, goal, grant);
    await starteAnruf("+" + ERWARTET, goal);
    assert.equal(providerCalls.length, before + 1, provider + ": no duplicate or later autonomous call");
    assert.equal(globalThis.telefonEintrag, undefined);
    assert.deepEqual(globalThis.telefonNummernSchreibversuche, []);
    const stage = await nimmAn("live_oneoff_" + provider, "+" + ERWARTET, dial.context);
    assert.equal(stage, "oeffentlich");
    const accepted = globalThis.telefonAnnahmen.at(-1);
    assert.equal(accepted.visibility, "public"); assert.equal(accepted.allowTools, false);
    assert.ok(accepted.instructions.includes("oeffentlich"));
    assert.ok(accepted.instructions.includes(goal));
    assert.equal(globalThis.telefonProtokoll.at(-1).richtung, "ausgehend");
    assert.equal(globalThis.telefonProtokoll.at(-1).stufe, "oeffentlich");
    assert.equal(providerCalls.length, before + 1);
    for (const entry of [
      { id: 2, nummer: ERWARTET, name: "Blocked", stufe: "gesperrt", darfAngerufenWerden: true },
      { id: 3, nummer: ERWARTET, name: "Not permitted", stufe: "oeffentlich", darfAngerufenWerden: false },
    ]) {
      globalThis.telefonEintrag = entry;
      await starteAnruf("+" + ERWARTET, goal, ownerCallGrantFromMessage("Ruf +4915112345678 an"));
      assert.equal(providerCalls.length, before + 1, provider + ": existing restrictions still apply");
    }
    globalThis.telefonEintrag = { id: 4, nummer: ERWARTET, name: "Allowed", stufe: "oeffentlich", darfAngerufenWerden: true };
    await starteAnruf("+" + ERWARTET, goal);
    assert.equal(providerCalls.length, before + 2);
    globalThis.telefonEintrag = undefined;
    const failedGrant = ownerCallGrantFromMessage("Ruf +4915112345678 an");
    failNextDial = true;
    await starteAnruf("+" + ERWARTET, goal, failedGrant).catch(() => {});
    assert.equal(providerCalls.length, before + 3);
    await starteAnruf("+" + ERWARTET, goal, failedGrant);
    assert.equal(providerCalls.length, before + 3, provider + ": failure must not silently redial");
    assert.deepEqual(globalThis.telefonNummernSchreibversuche, []);
  }
  console.log("OK — Owner one-off calls: both providers, exact target, one-shot use, blocked contacts, no persistent permission and public SIP context.");

  // Two independent owner requests can dial through one DID before either
  // conversation is accepted. Answering in reverse order must keep context.
  process.env.LUKAS_TELEFON_ANBIETER = "telnyx";
  globalThis.telefonEintrag = undefined;
  const targets = ["+4915112345678", "+493012345678"];
  const reasons = ["Termin für die Besichtigung vereinbaren", "Lieferzeit für das Ersatzteil erfragen"];
  const parallelStart = providerCalls.length, acceptedBeforeParallel = globalThis.telefonAnnahmen.length;
  const results = await Promise.all(targets.map((target, index) =>
    starteAnruf(target, reasons[index], ownerCallGrantFromMessage(`Ruf ${target} an`))));
  assert.ok(results.every(result => /Ich rufe/.test(result)));
  assert.equal(globalThis.telefonAnnahmen.length, acceptedBeforeParallel, "Dial returns before a conversation is accepted");
  const parallelDials = providerCalls.slice(parallelStart);
  assert.equal(parallelDials.length, 2);
  assert.ok(parallelDials.every(dial => dial.from === process.env.TELNYX_NUMMER), "One DID is used for both calls");
  assert.notEqual(parallelDials[0].context.id, parallelDials[1].context.id);
  for (const index of [1, 0]) {
    const dial = parallelDials.find(call => call.to === targets[index]);
    assert.ok(dial);
    assert.equal(dial.context.nummer, targets[index]);
    assert.equal(dial.context.anlass, reasons[index]);
    await nimmAn(`live_parallel_${index}`, targets[index], dial.context);
    const accepted = globalThis.telefonAnnahmen.at(-1);
    assert.ok(accepted.instructions.includes(reasons[index]));
    assert.ok(!accepted.instructions.includes(reasons[1 - index]));
    assert.equal(accepted.visibility, "public");
    assert.equal(accepted.allowTools, false);
  }
  console.log("OK — Parallel Telnyx dials: one DID, separate signed contexts, non-blocking start and reversed answer order.");
  const contactStart = providerCalls.length;
  globalThis.telefonSuchtreffer = [];
  assert.match(await starteAnruf("Unbekannt", "Test"), /Kein passender Kontakt/);
  globalThis.telefonSuchtreffer = [{ name: "Max", nummer: ERWARTET }, { name: "Max", nummer: "493012345678" }];
  assert.match(await starteAnruf("Max", "Test"), /Mehrere Kontakte/);
  assert.equal(providerCalls.length, contactStart, "Missing/ambiguous names do not dial");
  globalThis.telefonEintrag = { id: 4, nummer: ERWARTET, name: "Max Muster", stufe: "oeffentlich", darfAngerufenWerden: true, aufnahmeZustimmung: true, aufnahmeQuelle: "homepage", aufnahmeBestaetigtAm: new Date() };
  globalThis.telefonSuchtreffer = [globalThis.telefonEintrag];
  await starteAnruf("Max Muster", "Termin");
  assert.equal(providerCalls.at(-1).to, "+" + ERWARTET);
  assert.equal(providerCalls.at(-1).context.aufnahme, true);
  await nimmAn("live_recording", "+" + ERWARTET, providerCalls.at(-1).context);
  assert.match(globalThis.telefonAnnahmen.at(-1).instructions, /Keine erneute Einwilligungsfrage oder Aufnahmeansage/);
  globalThis.telefonEintrag.aufnahmeZustimmung = false;
  await starteAnruf("Max Muster", "Ohne Aufnahme");
  assert.equal(providerCalls.at(-1).context.aufnahme, false, "Consent removal applies to the next call");
  globalThis.telefonEintrag.darfAngerufenWerden = false;
  const beforeBlocked = providerCalls.length;
  await starteAnruf("Max Muster", "Gesperrt");
  assert.equal(providerCalls.length, beforeBlocked, "A resolved name does not bypass call permission");
  delete globalThis.telefonSuchtreffer;
  console.log("OK — Namen eindeutig auflösen; Aufnahme nur mit gespeicherter Zustimmung, ohne erneute Ansage.");
} finally {
  globalThis.fetch = oneOffPreviousFetch;
  for (const [key, value] of oneOffPreviousEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  delete globalThis.telefonEintrag; delete globalThis.telefonAnnahmen;
  delete globalThis.telefonProtokoll; delete globalThis.telefonAnnahmeFehler;
  delete globalThis.telefonNummernSchreibversuche;
}


// External phone prompts must never load the portfolio biography or memories.
const promptFixture = join(dir, "phone-prompt-fixture.mjs");
writeFileSync(promptFixture, [
  'export const db = { select() { throw new Error("Phone prompt must not query memories"); } };',
  'export const memoriesTable = {}; export const eq = () => ({}); export const desc = () => ({});',
  'export const LUKAS_SOUL = "PRIVATE_OWNER_BIOGRAPHY_SENTINEL";',
  'export async function getLukasStatus() { throw new Error("Phone prompt must not query mood"); }',
].join("\n"));
const promptOutput = join(dir, "phone-prompt.mjs");
await build({
  entryPoints: ["src/lib/public-prompt.ts"], bundle: true, format: "esm", platform: "node", outfile: promptOutput,
  plugins: [{ name: "phone-prompt-boundary", setup(b) {
    b.onResolve({ filter: /.*/ }, args => args.importer.endsWith("public-prompt.ts") ? { path: promptFixture } : undefined);
  }}],
});
const { buildPublicSystemPrompt } = await import(promptOutput);
const phonePrompt = await buildPublicSystemPrompt("telefon");
assert.doesNotMatch(phonePrompt, /PRIVATE_OWNER_BIOGRAPHY_SENTINEL|\b(?:Isa|Issa)\b|issahareb|Portfolio/i);
assert.ok(phonePrompt.length > 100, "An actual phone prompt is returned without any memory access");

rmSync(dir, { recursive: true, force: true });

if (fehler > 0) {
  console.error(`\n${fehler} Fehler in der Nummernerkennung.`);
  process.exit(1);
}
console.log("OK — Telefon: alle Schreibweisen treffen denselben Schlüssel, Fremdes bleibt fremd.");
