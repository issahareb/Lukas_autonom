/*
 * Lukas am Telefon.
 *
 * Zwei Richtungen, aber nur EIN Weg durch den Code:
 *
 *   Eingehend  Anrufer -> Telnyx/TeXML oder Twilio/SIP -> OpenAI -> Webhook hier
 *   Ausgehend  Lukas -> ausgewaehlter Anbieter waehlt -> verbindet zu OpenAI
 *              -> OpenAI -> derselbe Webhook hier
 *
 * Der Telefonanbieter waehlt die Nummer und verbindet das Gespraech per SIP.
 * Wir nehmen es ueber GPT Live an; die Provider-Zuordnung bleibt erhalten.
 *
 * Die Nummer des Anrufers entscheidet, WELCHEN Lukas jemand bekommt. Ein
 * Telefonanschluss ist offen; ohne diese Pruefung bekaeme jeder Fehlanrufer
 * Issas privates Gedaechtnis ans Ohr.
 */
import { db } from "@workspace/db";
import { telefonNummern, telefonAnrufe } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { buildSystemPrompt } from "./system-prompt";
import { buildPublicSystemPrompt } from "./public-prompt";
import { SPRACH_REGEL } from "./ai/sprach-sitzung";
import { acceptLiveSipSession, rejectLiveSipSession } from "./ai/live-session";
import { logger } from "./logger";
import type { OwnerCallGrant } from "./owner-call-grant";
import { istTelnyx, telnyxWaehle, type TelefonKontext } from "./telnyx";

export type Stufe = "privat" | "oeffentlich" | "gesperrt";

/**
 * Nur die Ziffern.
 *
 * Dieselbe Nummer kommt je nach Anbieter als "+4915112345678",
 * "004915112345678" oder "sip:4915112345678@irgendwas" an. Verglichen wird
 * deshalb ausschliesslich die Ziffernfolge — genau wie bei WhatsApp.
 */
export function normalisiere(roh: string): string {
  const nurZiffern = roh.replace(/[^0-9]/g, "");
  // Fuehrende Amtsnullen wegwerfen: 0049… und +49… sind dieselbe Nummer.
  return nurZiffern.replace(/^00/, "");
}

/** Die Nummer aus einem SIP-From-Header ziehen ("Name" <sip:49151…@host>). */
export function nummerAusSip(header: string): string {
  const treffer = header.match(/sip:([^@;>]+)/i);
  return normalisiere(treffer ? treffer[1] : header);
}

/*
 * Anrufe, die Lukas gerade selbst gestartet hat.
 *
 * Wenn Twilio unsere eigene Nummer in den SIP-Trunk verbindet, kommt der Anruf
 * beim Webhook an wie jeder andere — nur dass wir den Anlass kennen. Der wird
 * hier kurz geparkt und beim Verbinden wieder abgeholt.
 *
 * Bewusst im Speicher: zwischen Waehlen und Abnehmen liegen Sekunden. Ueberlebt
 * ein Neustart das nicht, ist der Anruf ohnehin weg.
 */
const offeneAusgehende = new Map<string, { anlass: string; seit: number }>();
const AUSGEHEND_GUELTIG_MS = 120_000;

function parkeAnlass(nummer: string, anlass: string): void {
  offeneAusgehende.set(normalisiere(nummer), { anlass, seit: Date.now() });
}

function holeAnlass(nummer: string): string | null {
  const key = normalisiere(nummer);
  const eintrag = offeneAusgehende.get(key);
  if (!eintrag) return null;
  if (Date.now() - eintrag.seit > AUSGEHEND_GUELTIG_MS) {
    offeneAusgehende.delete(key);
    return null;
  }
  // Provider-Wiederholungen müssen denselben Anlass behalten, bis die
  // Annahme erfolgreich ist. Ein Netzwerkfehler darf ihn nicht verbrauchen.
  return eintrag.anlass;
}

/** Welchen Lukas bekommt diese Nummer? Unbekannt = oeffentlich. */
export async function stufeFuer(nummer: string): Promise<{ stufe: Stufe; name: string }> {
  const key = normalisiere(nummer);
  if (!key) return { stufe: "oeffentlich", name: "" };

  const [treffer] = await db
    .select()
    .from(telefonNummern)
    .where(eq(telefonNummern.nummer, key))
    .limit(1);

  if (!treffer) return { stufe: "oeffentlich", name: "" };

  await db
    .update(telefonNummern)
    .set({ zuletztGesehen: new Date() })
    .where(eq(telefonNummern.id, treffer.id))
    .catch(() => {});

  const stufe = (["privat", "oeffentlich", "gesperrt"] as const).includes(treffer.stufe as Stufe)
    ? (treffer.stufe as Stufe)
    : "oeffentlich";
  return { stufe, name: treffer.name };
}

export async function protokolliere(eintrag: {
  richtung: "eingehend" | "ausgehend";
  nummer: string;
  ergebnis: string;
  stufe?: string;
  anlass?: string;
  detail?: string;
}): Promise<void> {
  await db
    .insert(telefonAnrufe)
    .values({
      richtung: eintrag.richtung,
      nummer: normalisiere(eintrag.nummer),
      ergebnis: eintrag.ergebnis,
      stufe: eintrag.stufe ?? "oeffentlich",
      anlass: eintrag.anlass ?? "",
      detail: (eintrag.detail ?? "").slice(0, 500),
    })
    .catch((err) => logger.warn({ err }, "Anruf konnte nicht protokolliert werden"));
}

/** Die Anweisungen fuer genau diesen Anrufer. */
async function anweisungen(stufe: Stufe, name: string, anlass: string | null): Promise<string> {
  const basis =
    stufe === "privat" ? await buildSystemPrompt() : await buildPublicSystemPrompt("telefon");

  const wer = name ? `Du sprichst mit ${name}.` : "";

  /*
   * Ein Telefonat ist kein Chat: es gibt keinen Bildschirm, niemand kann
   * zurueckscrollen, und eine Aufzaehlung vorgelesen zu bekommen ist eine
   * Zumutung. Das muss dranstehen, sonst antwortet er wie im Dashboard.
   */
  const amTelefon = `DU TELEFONIERST GERADE. ${wer}
- Sprich in kurzen, natuerlichen Saetzen. Keine Aufzaehlungen, keine Ueberschriften, kein Markdown.
- Der andere sieht nichts. Beschreibe kurz, was du tust, statt auf etwas zu verweisen.
- Wird es laenger als drei Saetze, mach eine Pause und frag nach, statt einen Vortrag zu halten.`;

  const grund = anlass
    ? `\n\nDU HAST ANGERUFEN. Der Anlass: ${anlass}\nKomm nach der Begrüßung direkt darauf zu sprechen.`
    : "";

  return `${SPRACH_REGEL}\n\n${amTelefon}${grund}\n\n${basis}`;
}

/*
 * DIE RUFNUMMERNANZEIGE IST KEIN AUSWEIS.
 *
 * Das ist die unangenehmste Stelle im ganzen System, und sie steht hier
 * ausgeschrieben, statt in einer Doku zu verschwinden.
 *
 * stufeFuer() entscheidet anhand der Nummer im SIP-From-Header, ob der Anrufer
 * Issas VOLLEN privaten Prompt bekommt — Erinnerungen, Ziele, Tagebuch. Diese
 * Nummer behauptet das anrufende Netz, nicht der Anrufer und nicht wir. Im
 * Telefonnetz ist sie mit einem VoIP-Anschluss frei setzbar; genau darauf
 * beruht jeder zweite Telefonbetrug. Wer Issas Nummer kennt — sie stand in
 * diesem oeffentlichen Repository — und Lukas' Nummer kennt, kann sich
 * ansagen lassen, was Lukas ueber Issa weiss.
 *
 * Was das NICHT ist: ein Weg, etwas auszuloesen. Die Sprachsitzung bekommt
 * keine Werkzeuge. Auch der Live-Backend-Durchlauf bekommt explizit tools: [].
 * Es geht um Preisgabe, nicht um Handlungen.
 *
 * Eine zusaetzliche Authentifizierung ist technisch moeglich. Die bestehende
 * Caller-ID-Abwaegung bleibt eine bewusste Owner-Entscheidung; die Migration
 * auf Live erweitert sie nicht um Werkzeugrechte.
 *
 * Bleiben drei Moeglichkeiten, und die Wahl gehoert Issa:
 *
 *  1. SO LASSEN. Bequem, und das Risiko ist Preisgabe an jemanden, der bereits
 *     beide Nummern kennt und Rufnummern faelschen kann. Das ist der Stand
 *     ohne LUKAS_TELEFON_STRENG.
 *  2. STRENG (LUKAS_TELEFON_STRENG=true). Eingehende Anrufe bekommen NIE den
 *     privaten Prompt — nur Anrufe, die Lukas selbst gewaehlt hat. Ruft Issa
 *     an, spricht er mit dem oeffentlichen Lukas, der ihn beim Namen kennt;
 *     will er den privaten, laesst er sich zurueckrufen.
 *  3. RUECKRUF ALS REGEL. Technisch dasselbe wie 2, nur als Gewohnheit.
 *
 * Voreinstellung ist 1, weil 2 Issa den Zugang zu seinem eigenen Lukas
 * verengt und diese Entscheidung nicht nebenbei getroffen wird. Solange 1
 * gilt, steht bei jedem solchen Anruf eine Warnung im Protokoll — ein
 * Restrisiko, das niemand sieht, ist keins, das jemand abwaegt.
 */
export function tatsaechlicheStufe(
  eingetragen: Stufe,
  vonLukasGewaehlt: boolean,
  nummer: string,
): Stufe {
  if (eingetragen !== "privat" || vonLukasGewaehlt) return eingetragen;

  /*
   * Nicht streng als Standard — auch das bleibt Issas Entscheidung.
   *
   * Anders als beim Droplet geht es hier NICHT darum, Lukas einzuschraenken,
   * sondern um Preisgabe an Dritte: eine faelschbare Rufnummer oeffnet den
   * vollen privaten Prompt. Der Schalter existiert, das Risiko steht
   * ausgeschrieben in docs/SICHERHEITSMODELL.md — aber die Voreinstellung
   * verengt Issas eigenen Zugang zu seinem Lukas, und diese Abwaegung trifft
   * er, nicht ein Audit und nicht ich.
   *
   * LUKAS_TELEFON_STRENG=true schaltet es scharf.
   */
  const streng = (process.env.LUKAS_TELEFON_STRENG ?? "false").trim().toLowerCase() === "true";
  if (streng) {
    logger.info(
      { nummer },
      "Eingehender Anruf mit privater Nummer — streng: öffentlicher Lukas, weil die Rufnummernanzeige kein Ausweis ist",
    );
    return "oeffentlich";
  }

  logger.warn(
    { nummer },
    "Eingehender Anruf bekommt den PRIVATEN Prompt allein aufgrund der Rufnummernanzeige. " +
      "Die ist fälschbar. Mit LUKAS_TELEFON_STRENG=true gilt das nur noch für Anrufe, die Lukas selbst gewählt hat.",
  );
  return eingetragen;
}

/**
 * Den Anruf annehmen.
 *
 * Der Anrufer haengt waehrenddessen in der Leitung und hoert Stille — deshalb
 * passiert hier nichts, was warten kann.
 */
export async function nimmAn(callId: string, vonNummer: string, kontext?: TelefonKontext): Promise<Stufe> {
  vonNummer = kontext?.nummer ?? vonNummer;
  const { stufe: eingetragen, name } = await stufeFuer(vonNummer);
  const offenerAnlass = !kontext ? offeneAusgehende.get(normalisiere(vonNummer)) : undefined;
  const anlass = kontext ? (kontext.richtung === "ausgehend" ? kontext.anlass : null) : holeAnlass(vonNummer);
  const ausgehend = kontext ? kontext.richtung === "ausgehend" : anlass !== null;
  const stufe = tatsaechlicheStufe(eingetragen, ausgehend, vonNummer);

  if (stufe === "gesperrt") {
    await weiseAb(callId, "Gesperrte Nummer");
    await protokolliere({ richtung: "eingehend", nummer: vonNummer, ergebnis: "abgewiesen", stufe });
    return stufe;
  }

  await acceptLiveSipSession({
    sessionId: callId,
    instructions: await anweisungen(stufe, name, anlass),
    visibility: stufe === "privat" ? "private" : "public",
    initialCommentary: ausgehend
      ? `Du hast selbst angerufen. Begrüße ${name || "den Gesprächspartner"} kurz. Anlass: ${(anlass || "der vereinbarte Rückruf").slice(0, 500)}`
      : `Ein Anrufer hat dich erreicht. Begrüße ${name || "den Gesprächspartner"} kurz.`,
    // Rufnummernanzeige berechtigt wie bisher nicht zu Werkzeugaktionen.
    allowTools: false,
  });
  if (offenerAnlass && offeneAusgehende.get(normalisiere(vonNummer)) === offenerAnlass) {
    offeneAusgehende.delete(normalisiere(vonNummer));
  }

  await protokolliere({
    richtung: ausgehend ? "ausgehend" : "eingehend",
    nummer: vonNummer,
    ergebnis: "angenommen",
    stufe,
    anlass: anlass ?? "",
  });
  return stufe;
}

export async function weiseAb(sessionId: string, grund: string): Promise<void> {
  try {
    await rejectLiveSipSession(sessionId);
  } catch (err) {
    logger.warn({ err, grund }, "Live-Anruf konnte nicht abgewiesen werden");
    throw err;
  }
}

/**
 * Lukas ruft an.
 *
 * Twilio waehlt und verbindet das abgenommene Gespraech per TwiML in den
 * SIP-Trunk — ab da laeuft es durch denselben Webhook wie ein eingehender
 * Anruf. Deshalb wird der Anlass vorher geparkt.
 */
/*
 * Zugangsdaten fuer Twilio.
 *
 * Es gibt zwei Wege, und in der Konsole liegen sie an verschiedenen Stellen:
 *
 *   Account SID + Auth Token   auf der Startseite unter "Account Info"
 *   API Key (SK…) + Secret     unter "API keys & tokens"
 *
 * Beide funktionieren als Basic-Auth. Der API Key ist der bessere Weg — er
 * laesst sich einzeln zurueckziehen, ohne dass alles andere stehenbleibt.
 *
 * Der Account SID wird IMMER gebraucht, auch mit API Key: er steht im Pfad
 * der URL, nicht in der Anmeldung. Genau daran scheitert es sonst.
 */
export function twilioZugang(): { sid: string; nutzer: string; geheim: string } | null {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  if (!sid) return null;

  const key = process.env.TWILIO_API_KEY?.trim();
  const secret = process.env.TWILIO_API_SECRET?.trim();
  if (key && secret) return { sid, nutzer: key, geheim: secret };

  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (token) return { sid, nutzer: sid, geheim: token };

  return null;
}

export async function starteAnruf(nummer: string, anlass: string, ownerCallGrant?: OwnerCallGrant): Promise<string> {
  const zugang = twilioZugang();
  const von = process.env.TWILIO_NUMMER?.trim();
  const projekt = process.env.OPENAI_PROJECT_ID?.trim();

  if (!istTelnyx() && (!zugang || !von || !projekt)) {
    return (
      "Zum Anrufen fehlen noch Zugangsdaten. Gebraucht werden TWILIO_ACCOUNT_SID (AC…), " +
      "TWILIO_NUMMER, OPENAI_PROJECT_ID — und zur Anmeldung entweder TWILIO_API_KEY " +
      "plus TWILIO_API_SECRET oder TWILIO_AUTH_TOKEN."
    );
  }

  const ziel = normalisiere(nummer);
  const [eintrag] = await db
    .select()
    .from(telefonNummern)
    .where(eq(telefonNummern.nummer, ziel))
    .limit(1);

  // Only an authenticated Dashboard request may authorize an unknown target.
  // Consume its exact-target capability before any provider side effect.
  // Existing contact restrictions always win; no contact permissions are saved.
  const einmalig = !eintrag && ownerCallGrant?.(ziel) === true;
  if (!einmalig && (!eintrag?.darfAngerufenWerden || eintrag.stufe === "gesperrt")) {
    await protokolliere({ richtung: "ausgehend", nummer: ziel, ergebnis: "abgewiesen", anlass });
    return eintrag
      ? "Diese Nummer ist nicht zum Anrufen freigegeben. Issa kann sie im Dashboard unter Telefon freischalten."
      : "Für diese neue Nummer brauche ich einen ausdrücklichen Anrufauftrag in deiner aktuellen Dashboard-Nachricht, zum Beispiel: Ruf +4915112345678 an und verhandle über den Garten. Die Nummer muss dafür nicht gespeichert werden. Ein bereits verbrauchter Auftrag braucht eine neue Nachricht.";
  }

  if (istTelnyx()) {
    try {
      await telnyxWaehle(`+${ziel}`, anlass);
      await protokolliere({ richtung: "ausgehend", nummer: ziel, ergebnis: "gewaehlt", anlass });
      return `Ich rufe ${eintrag?.name || "+" + ziel} gerade an.`;
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Telnyx-Anruf fehlgeschlagen";
      await protokolliere({ richtung: "ausgehend", nummer: ziel, ergebnis: "fehlgeschlagen", anlass, detail });
      throw new Error(detail);
    }
  }
  if (!zugang || !von || !projekt) throw new Error("Twilio-Zugangsdaten fehlen.");
  const { sid } = zugang;
  const sipZiel = `sip:${projekt}@${process.env.OPENAI_SIP_HOST ?? "sip.api.openai.com"};transport=tls`;
  const twiml = `<Response><Dial answerOnBridge="true"><Sip>${sipZiel}</Sip></Dial></Response>`;

  parkeAnlass(ziel, anlass);

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${zugang.nutzer}:${zugang.geheim}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: `+${ziel}`, From: von, Twiml: twiml }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    await protokolliere({
      richtung: "ausgehend",
      nummer: ziel,
      ergebnis: "fehlgeschlagen",
      anlass,
      detail: text,
    });
    return `Der Anruf ging nicht raus (${res.status}): ${text.slice(0, 200)}`;
  }

  await protokolliere({ richtung: "ausgehend", nummer: ziel, ergebnis: "gewaehlt", anlass });
  return `Ich rufe ${eintrag?.name || "+" + ziel} gerade an.`;
}

/** Die letzten Anrufe fuer das Dashboard. */
export async function letzteAnrufe(grenze = 30) {
  return db.select().from(telefonAnrufe).orderBy(desc(telefonAnrufe.createdAt)).limit(grenze);
}

/*
 * ── Twilio einrichten, ohne Terminal ──────────────────────────────────────
 *
 * Die Einrichtung besteht aus drei Aufrufen an Twilio: Trunk anlegen,
 * Origination-URI auf OpenAI zeigen lassen, Nummer anhaengen. Dafuer gab es
 * bisher nur das Skript — und das braucht eine Kommandozeile.
 *
 * Der Server kann dasselbe. Er hat die Zugangsdaten ohnehin als
 * Umgebungsvariablen, und damit muessen sie nirgends sonst auftauchen: nicht
 * im Chat, nicht im Gedaechtnis, nicht auf einem fremden Rechner. Ein Knopf im
 * Dashboard reicht.
 */

const TRUNK_NAME = "Lukas";

async function twilioAnfrage(
  url: string,
  form?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const zugang = twilioZugang();
  if (!zugang) throw new Error("Twilio-Zugangsdaten fehlen.");

  const res = await fetch(url, {
    method: form ? "POST" : "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${zugang.nutzer}:${zugang.geheim}`).toString("base64")}`,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form) : undefined,
    signal: AbortSignal.timeout(20000),
  });

  const text = await res.text();
  let daten: Record<string, unknown>;
  try {
    daten = JSON.parse(text);
  } catch {
    daten = { raw: text };
  }
  if (!res.ok) {
    // Twilios Fehlertexte sind brauchbar — durchreichen statt verschlucken.
    throw new Error(`Twilio ${res.status}: ${daten.message ?? text.slice(0, 200)}`);
  }
  return daten;
}

function sipZiel(): string {
  const projekt = process.env.OPENAI_PROJECT_ID?.trim();
  if (!projekt) throw new Error("OPENAI_PROJECT_ID fehlt.");
  return `sip:${projekt}@${process.env.OPENAI_SIP_HOST ?? "sip.api.openai.com"};transport=tls`;
}

export type TwilioStand = {
  nummern: Array<{ nummer: string; name: string }>;
  trunk: string | null;
  origination: string[];
  amTrunk: string[];
  ziel: string | null;
};

/** Was bei Twilio gerade eingerichtet ist. */
export async function twilioStand(): Promise<TwilioStand> {
  const zugang = twilioZugang();
  if (!zugang) throw new Error("Twilio-Zugangsdaten fehlen.");

  const konto = (await twilioAnfrage(
    `https://api.twilio.com/2010-04-01/Accounts/${zugang.sid}/IncomingPhoneNumbers.json?PageSize=50`,
  )) as { incoming_phone_numbers?: Array<{ phone_number: string; friendly_name: string }> };

  const { trunks = [] } = (await twilioAnfrage(
    "https://trunking.twilio.com/v1/Trunks?PageSize=50",
  )) as { trunks?: Array<{ sid: string; friendly_name: string }> };
  const trunk = trunks.find((t) => t.friendly_name === TRUNK_NAME) ?? null;

  let origination: string[] = [];
  let amTrunk: string[] = [];
  if (trunk) {
    const o = (await twilioAnfrage(
      `https://trunking.twilio.com/v1/Trunks/${trunk.sid}/OriginationUrls`,
    )) as { origination_urls?: Array<{ sip_url: string; enabled: boolean }> };
    origination = (o.origination_urls ?? []).filter((u) => u.enabled).map((u) => u.sip_url);

    const n = (await twilioAnfrage(
      `https://trunking.twilio.com/v1/Trunks/${trunk.sid}/PhoneNumbers`,
    )) as { phone_numbers?: Array<{ phone_number: string }> };
    amTrunk = (n.phone_numbers ?? []).map((p) => p.phone_number);
  }

  return {
    nummern: (konto.incoming_phone_numbers ?? []).map((n) => ({
      nummer: n.phone_number,
      name: n.friendly_name,
    })),
    trunk: trunk?.sid ?? null,
    origination,
    amTrunk,
    ziel: process.env.OPENAI_PROJECT_ID ? sipZiel() : null,
  };
}

/**
 * Trunk anlegen, auf OpenAI zeigen lassen, Nummer anhaengen.
 *
 * Bewusst wiederholbar: jeder Schritt prueft erst, ob er schon getan ist.
 * Ein zweiter Klick darf nichts kaputtmachen — sonst traut sich niemand, ihn
 * zu druecken, wenn beim ersten Mal etwas schiefging.
 */
export async function twilioEinrichten(nummer: string): Promise<string[]> {
  const zugang = twilioZugang();
  if (!zugang) throw new Error("Twilio-Zugangsdaten fehlen.");
  const ziel = sipZiel();
  const schritte: string[] = [];

  const { trunks = [] } = (await twilioAnfrage(
    "https://trunking.twilio.com/v1/Trunks?PageSize=50",
  )) as { trunks?: Array<{ sid: string; friendly_name: string }> };

  let trunkSid = trunks.find((t) => t.friendly_name === TRUNK_NAME)?.sid;
  if (trunkSid) {
    schritte.push(`Trunk „${TRUNK_NAME}" war schon da.`);
  } else {
    const neu = (await twilioAnfrage("https://trunking.twilio.com/v1/Trunks", {
      FriendlyName: TRUNK_NAME,
    })) as { sid: string };
    trunkSid = neu.sid;
    schritte.push(`Trunk „${TRUNK_NAME}" angelegt.`);
  }

  const o = (await twilioAnfrage(
    `https://trunking.twilio.com/v1/Trunks/${trunkSid}/OriginationUrls`,
  )) as { origination_urls?: Array<{ sip_url: string }> };
  if ((o.origination_urls ?? []).some((u) => u.sip_url === ziel)) {
    schritte.push("Origination zeigte bereits auf OpenAI.");
  } else {
    await twilioAnfrage(`https://trunking.twilio.com/v1/Trunks/${trunkSid}/OriginationUrls`, {
      FriendlyName: "OpenAI Realtime",
      SipUrl: ziel,
      Priority: "10",
      Weight: "10",
      Enabled: "true",
    });
    schritte.push("Origination auf OpenAI gesetzt.");
  }

  const konto = (await twilioAnfrage(
    `https://api.twilio.com/2010-04-01/Accounts/${zugang.sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(nummer)}`,
  )) as { incoming_phone_numbers?: Array<{ sid: string }> };
  const eintrag = konto.incoming_phone_numbers?.[0];
  if (!eintrag) throw new Error(`${nummer} gehört diesem Twilio-Konto nicht.`);

  const schon = (await twilioAnfrage(
    `https://trunking.twilio.com/v1/Trunks/${trunkSid}/PhoneNumbers`,
  )) as { phone_numbers?: Array<{ phone_number: string }> };
  if ((schon.phone_numbers ?? []).some((p) => p.phone_number === nummer)) {
    schritte.push(`${nummer} hing schon am Trunk.`);
  } else {
    await twilioAnfrage(`https://trunking.twilio.com/v1/Trunks/${trunkSid}/PhoneNumbers`, {
      PhoneNumberSid: eintrag.sid,
    });
    schritte.push(`${nummer} an den Trunk gehängt.`);
  }

  return schritte;
}
