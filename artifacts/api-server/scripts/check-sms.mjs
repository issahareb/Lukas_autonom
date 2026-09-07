/*
 * Prueft den SMS-Versand.
 *
 * Eine SMS ist weg, sobald sie weg ist — kein Zurueckholen, kein Papierkorb,
 * und sie landet auf einem fremden Telefon in Issas Namen. Deshalb sind hier
 * genau die Faelle festgehalten, in denen ein Fehler nicht auffaellt, sondern
 * beim Empfaenger ankommt:
 *
 *  1. Eine Nummer ohne Laendervorwahl. "0171 1234" ist keine Adresse, sondern
 *     eine Vermutung — und die SMS ginge an irgendwen.
 *  2. Eine gesperrte Nummer. Es waere absurd, jemanden am Telefon abzuweisen
 *     und ihm dann zu schreiben.
 *  3. Die Zugangsdaten. Sie duerfen im Protokoll und in keiner Fehlermeldung
 *     auftauchen — auch nicht, wenn der Anbieter etwas zurueckwirft.
 *
 * Und die Gegenrichtung, die genauso wichtig ist: eine normale Nachricht an
 * eine normale Nummer muss durchgehen, ohne Nachfragen.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".sms-check-"));
const out = join(dir, "sms.mjs");
const attrappe = join(dir, "attrappe.mjs");

writeFileSync(
  attrappe,
  `/*
 * Die Tabellen geben jetzt FELDNAMEN zurueck statt nur ihren eigenen Namen.
 * Ohne das liesse sich die Idempotenz-Abfrage nicht nachstellen: sie fragt
 * nach fingerabdruck UND Zeitfenster, und ein eq(), das blind auf nummer oder
 * id vergleicht, wuerde jede Zeile treffen.
 */
const t = (name) => new Proxy({ __name: name }, { get: (o, k) => (k === "__name" ? name : String(k)) });
export const smsNachrichten = t("sms");
export const telefonNummern = t("nummern");
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
export const gte = (feld, wert) => (z) => z[feld] >= wert;
export const and = (...bed) => (z) => bed.filter(Boolean).every((b) => b(z));
export const desc = () => ({});
export const logger = {
  info(daten) { (globalThis.__protokoll ??= []).push(JSON.stringify(daten)); },
  warn(daten) { (globalThis.__protokoll ??= []).push(JSON.stringify(daten)); },
  error() {}, debug() {},
};

globalThis.__nummern = [];
globalThis.__sms = [];
globalThis.__gesendet = 0;
let naechsteId = 0;

export const db = {
  select: () => ({
    from: (tab) => {
      const alle = tab.__name === "nummern" ? globalThis.__nummern : globalThis.__sms;
      const bau = (bed) => ({
        where: (b) => bau(b),
        orderBy: () => bau(bed),
        limit: async () => alle.filter((z) => (bed ? bed(z) : true)),
        then: (r) => Promise.resolve(alle.filter((z) => (bed ? bed(z) : true))).then(r),
      });
      return bau(null);
    },
  }),
  insert: () => ({
    values: (v) => ({
      returning: async () => {
        const zeile = { id: ++naechsteId, createdAt: new Date(), ...v };
        globalThis.__sms.push(zeile);
        return [zeile];
      },
    }),
  }),
  update: () => ({
    set: (werte) => ({
      where: (bed) => {
        const treffer = globalThis.__sms.filter((z) => (bed ? bed(z) : true));
        for (const z of treffer) Object.assign(z, werte);
        return Promise.resolve(treffer);
      },
    }),
  }),
};
`,
);

await build({
  entryPoints: ["src/lib/sms.ts"],
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

const { sendeSms, normalisiereNummer, segmente, zugangVorhanden } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};
const wirft = async (fn, was, muster) => {
  try {
    await fn();
    pruefe(was, false);
  } catch (err) {
    pruefe(was, muster ? muster.test(err.message) : true);
    if (muster && !muster.test(err.message)) console.error(`   (Meldung war: ${err.message})`);
  }
};

// ── 1. Nummern ────────────────────────────────────────────────────────────
pruefe("internationale Nummer bleibt", normalisiereNummer("+4915100000042") === "+4915100000042");
pruefe(
  "Leerzeichen und Bindestriche stören nicht",
  normalisiereNummer("+49 151 / 0000-0042") === "+4915100000042",
);
pruefe("ohne Vorwahl wird NICHT geraten", normalisiereNummer("015100000042") === null);
pruefe("Unsinn wird abgelehnt", normalisiereNummer("ruf mal an") === null);
pruefe("und Leeres auch", normalisiereNummer("") === null);

process.env.LUKAS_LAENDERVORWAHL = "+49";
pruefe(
  "mit ausdrücklicher Ländervorwahl geht die führende Null",
  normalisiereNummer("015100000042") === "+4915100000042",
);
delete process.env.LUKAS_LAENDERVORWAHL;

// ── 2. Länge und Kosten ───────────────────────────────────────────────────
pruefe("kurzer Text ist eine SMS", segmente("Bin um 15 Uhr da.") === 1);
pruefe("160 Zeichen sind noch eine", segmente("a".repeat(160)) === 1);
pruefe("161 sind zwei", segmente("a".repeat(161)) === 2);
pruefe("Umlaute bleiben günstig", segmente("ä".repeat(160)) === 1);
pruefe("ein Emoji macht die ganze Nachricht teuer", segmente("Hallo 👋" + "a".repeat(80)) === 2);

// ── 3. Der Versand ────────────────────────────────────────────────────────
process.env.CLICKSEND_USERNAME = "issa";
process.env.CLICKSEND_API_KEY = "GEHEIMER-SCHLUESSEL";
pruefe("mit Zugangsdaten ist er bereit", zugangVorhanden());

let letzterAufruf = null;
globalThis.fetch = async (url, init) => {
  letzterAufruf = { url: String(url), init };
  globalThis.__gesendet++;
  return new Response(
    JSON.stringify({
      http_code: 200,
      response_code: "SUCCESS",
      data: {
        messages: [{ status: "SUCCESS", message_id: "ABC-123", message_price: "0.0784" }],
        total_price: 0.0784,
        _currency: { currency_code: "EUR" },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};

{
  const e = await sendeSms({ an: "+4915100000042", text: "Bin um 15 Uhr da." });
  pruefe("die SMS geht raus", e.ok === true);
  pruefe("mit Status vom Anbieter", e.status === "SUCCESS");
  pruefe("und dem Preis", e.preis === "0.0784");

  pruefe("an den richtigen Endpunkt", letzterAufruf.url === "https://rest.clicksend.com/v3/sms/send");
  const koerper = JSON.parse(letzterAufruf.init.body);
  pruefe("mit genau einer Nachricht", koerper.messages.length === 1);
  pruefe("an die normalisierte Nummer", koerper.messages[0].to === "+4915100000042");
  pruefe("mit dem Text", koerper.messages[0].body === "Bin um 15 Uhr da.");
  pruefe(
    "und Basic-Auth im Kopf",
    letzterAufruf.init.headers.Authorization ===
      `Basic ${Buffer.from("issa:GEHEIMER-SCHLUESSEL").toString("base64")}`,
  );

  const zeile = globalThis.__sms.at(-1);
  pruefe("die Nachricht wird protokolliert", zeile?.text === "Bin um 15 Uhr da.");
  pruefe("mit der Kennung des Anbieters", zeile?.anbieterId === "ABC-123");
  pruefe("und der Quelle", zeile?.quelle === "dashboard");
}

// ── Idempotenz: derselbe Retry darf nicht zweimal senden ─────────────────
/*
 * Der Ablauf, gegen den das steht: die SMS geht raus, das Netz bricht weg,
 * der Aufruf sieht aus wie gescheitert, der Agent versucht es erneut. Der
 * Empfänger bekommt sie doppelt — und zurückholen lässt sich nichts.
 */
{
  globalThis.__sms = [];
  globalThis.__gesendet = 0;
  const eins = await sendeSms({ an: "+4915100000042", text: "Bin um 15 Uhr da.", quelle: "lukas" });
  const zwei = await sendeSms({ an: "+4915100000042", text: "Bin um 15 Uhr da.", quelle: "lukas" });
  pruefe("die erste SMS geht raus", eins.ok === true && eins.wiederholung !== true);
  pruefe("die zweite wird als Wiederholung erkannt", zwei.wiederholung === true);
  pruefe("und der Anbieter wird kein zweites Mal angefragt", globalThis.__gesendet === 1);

  // Eine ANDERE Nachricht an dieselbe Nummer muss weiterhin durchgehen —
  // sonst wäre der Schutz eine Sperre.
  const drei = await sendeSms({ an: "+4915100000042", text: "Doch erst um 16 Uhr.", quelle: "lukas" });
  pruefe("eine andere Nachricht geht trotzdem raus", drei.wiederholung !== true && globalThis.__gesendet === 2);
}

// Was Lukas schreibt, ist als seins erkennbar.
{
  await sendeSms({ an: "+4915100000042", text: "Termin bestätigt.", quelle: "lukas" });
  pruefe("von Lukas geschriebene SMS sind erkennbar", globalThis.__sms.at(-1)?.quelle === "lukas");
}

// ── 4. Was NICHT rausgehen darf ───────────────────────────────────────────
await wirft(
  () => sendeSms({ an: "015100000042", text: "Hallo" }),
  "ohne Ländervorwahl geht nichts raus",
  /internationale/i,
);
await wirft(() => sendeSms({ an: "+4915100000042", text: "   " }), "ohne Text auch nicht");
await wirft(
  () => sendeSms({ an: "+4915100000042", text: "a".repeat(1300) }),
  "und ein Roman wird abgelehnt statt in zehn Teile zerlegt",
  /kürzer|Mail/i,
);

globalThis.__nummern = [{ id: 1, nummer: "+4930111111", stufe: "gesperrt" }];
await wirft(
  () => sendeSms({ an: "+4930111111", text: "Hallo" }),
  "an eine gesperrte Nummer geht nichts raus",
  /gesperrt/i,
);

// ── 5. Zugangsdaten bleiben drin ──────────────────────────────────────────
globalThis.fetch = async () =>
  new Response(JSON.stringify({ response_code: "INVALID_RECIPIENT", data: { messages: [{ status: "INVALID_RECIPIENT" }] } }), {
    status: 400,
  });
{
  const e = await sendeSms({ an: "+4915259559700", text: "Test" });
  pruefe("ein abgelehnter Empfänger ist kein Erfolg", e.ok === false);
  pruefe("und der Grund steht dabei", /INVALID_RECIPIENT/.test(`${e.fehler} ${e.status}`));
  pruefe(
    "der Schlüssel steht NICHT in der Antwort",
    !JSON.stringify(e).includes("GEHEIMER-SCHLUESSEL"),
  );
}
pruefe(
  "und auch nicht im Protokoll",
  !(globalThis.__protokoll ?? []).join(" ").includes("GEHEIMER-SCHLUESSEL"),
);
pruefe(
  "im Protokoll steht auch kein Nachrichtentext",
  !(globalThis.__protokoll ?? []).join(" ").includes("Bin um 15 Uhr da"),
);

// Ohne Zugangsdaten sagt er es klar, statt still zu scheitern.
delete process.env.CLICKSEND_USERNAME;
delete process.env.CLICKSEND_API_KEY;
pruefe("ohne Zugangsdaten ist er nicht bereit", !zugangVorhanden());
await wirft(
  () => sendeSms({ an: "+4915100000042", text: "Test" }),
  "und sagt, was fehlt",
  /CLICKSEND_USERNAME/,
);

if (fehler > 0) process.exit(1);
console.log("OK — SMS: nur echte Nummern, Gesperrte bleiben gesperrt, Zugangsdaten bleiben drin.");
