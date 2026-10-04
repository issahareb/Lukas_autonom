import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

/*
 * Grundschutz fuer die private API: wer darf sie aus dem Browser aufrufen, wie
 * oft, und mit welchen Kopfzeilen antwortet der Server.
 *
 * Vorher stand hier ein blankes `app.use(cors())` — also: jede Webseite der
 * Welt durfte im Browser eines Angemeldeten Anfragen an diese API stellen und
 * die Antwort lesen. Der Bearer-Token hat das bisher aufgefangen: ohne ihn
 * kommt nichts durch. Aber eine Tuer, die nur deshalb zu ist, weil dahinter
 * noch ein Schloss haengt, sollte man trotzdem schliessen.
 *
 * Was hier NICHT steht, und warum:
 *
 *  - Die Content-Security-Policy stand hier zuerst NICHT, aus Sorge vor
 *    Nonce-Pipelines. Beim Nachsehen im gebauten Dashboard war die Sorge
 *    unbegruendet: Vite erzeugt genau ein <script src=...>, kein Inline-Skript
 *    und kein <style>-Tag. `script-src 'self'` reicht also — und das ist die
 *    Richtung, auf die es ankommt, weil im localStorage der Zugangstoken
 *    liegt. Ein eingeschleustes Skript ist der einzige realistische Weg, ihn
 *    auszulesen.
 *  - Kein Cross-Origin-Opener-Policy. Die MCP-Anmeldung laeuft ueber ein
 *    Browserfenster zu einem fremden Anbieter und zurueck; COOP kann genau
 *    diesen Rueckweg abschneiden.
 */

/*
 * Zwei Zugangscodes vergleichen, ohne ueber die Dauer zu verraten, wie weit
 * jemand gekommen ist.
 *
 * `a !== b` bricht beim ersten falschen Zeichen ab. Ueber viele Versuche laesst
 * sich daraus Zeichen fuer Zeichen ein Token rekonstruieren. Praktisch ist das
 * ueber das Internet schwer — aber es kostet drei Zeilen, es richtig zu machen,
 * und dieser Token oeffnet Gedaechtnis, GitHub und Infrastruktur.
 */
export function gleicherToken(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const einA = Buffer.from(a, "utf8");
  const einB = Buffer.from(b, "utf8");
  // Laengen zuerst angleichen: timingSafeEqual wirft bei ungleicher Laenge, und
  // eine geworfene Ausnahme verraet die Laenge genauso.
  if (einA.length !== einB.length) {
    // Trotzdem vergleichen, damit die Dauer nicht von der Laenge abhaengt.
    timingSafeEqual(einA, einA);
    return false;
  }
  return timingSafeEqual(einA, einB);
}

/** Die echte Adresse hinter Railways Proxy — sonst zaehlt alles auf eine IP. */
export function klientIp(req: Request): string {
  const weitergeleitet = req.headers["x-forwarded-for"];
  const erste = Array.isArray(weitergeleitet)
    ? weitergeleitet[0]
    : weitergeleitet?.split(",")[0];
  return erste?.trim() || req.ip || "?";
}

const istSchleife = (ip: string) =>
  ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

/*
 * Der oeffentliche Teil bleibt fuer jede Herkunft offen: das Widget sitzt auf
 * Issas Portfolio, und dort ist es genau richtig. Geschuetzt ist es an anderer
 * Stelle — eigene Host-Liste und ein eigenes, engeres Limit in public.ts.
 */
const istOeffentlich = (pfad: string) =>
  pfad.startsWith("/api/public/") ||
  pfad === "/api/whatsapp/webhook" ||
  pfad === "/api/telefon/eingehend" ||
  pfad === "/api/sms/eingehend" ||
  pfad === "/healthz";

const istApi = (pfad: string) => pfad.startsWith("/api/");

function eigeneHosts(req: Request): string[] {
  const host = req.headers.host?.split(":")[0];
  return host ? [host] : [];
}

function erlaubteListe(): string[] {
  return (process.env.LUKAS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((eintrag) => {
      // Sowohl "https://foo.de" als auch "foo.de" sollen funktionieren —
      // sonst scheitert es an einem vergessenen Schema.
      try {
        return new URL(eintrag).hostname;
      } catch {
        return eintrag.replace(/^https?:\/\//, "").split("/")[0];
      }
    });
}

/**
 * Darf diese Herkunft die private API im Browser lesen?
 *
 * Kein Origin-Kopf heisst: kein Browser-Cross-Origin — ein Server-Aufruf, curl,
 * oder dieselbe Seite. Das ist erlaubt; abgesichert ist es durch den Token.
 */
export function herkunftErlaubt(req: Request, herkunft: string | undefined): boolean {
  if (!istApi(req.path) || istOeffentlich(req.path)) return true;
  if (!herkunft) return true;

  let host: string;
  try {
    host = new URL(herkunft).hostname;
  } catch {
    return false;
  }

  if (eigeneHosts(req).includes(host)) return true;
  if (erlaubteListe().includes(host)) return true;
  // Im Entwicklungsbetrieb laeuft die Oberflaeche auf einem eigenen Port.
  if (process.env.NODE_ENV === "development" && (host === "localhost" || host === "127.0.0.1")) {
    return true;
  }
  return false;
}

/**
 * Regelwerk fuer das cors-Paket. Bewusst die Bibliothek und keine eigenen
 * Kopfzeilen: die Vorab-Anfrage (OPTIONS) korrekt zu beantworten hat mehr
 * Fallstricke, als es aussieht.
 */
export function korsRegeln(
  req: Request,
  callback: (fehler: Error | null, optionen: { origin: boolean; credentials: boolean }) => void,
): void {
  callback(null, {
    origin: herkunftErlaubt(req, req.headers.origin),
    credentials: false,
  });
}

/*
 * Die Regeln im Einzelnen — jede steht fuer etwas, das das Dashboard wirklich
 * tut. Wer hier etwas streicht, schaltet eine Funktion ab:
 *
 *   connect-src  api.openai.com: der Sprachkanal verbindet sich DIREKT zu
 *                OpenAI (WebRTC), damit das Gespraech nicht ueber unseren
 *                Server umgeleitet wird. Ohne diese Zeile bleibt er stumm.
 *   img-src      https: — Anhaenge und fertige Medien kommen von fremden
 *                Adressen (Higgsfield, Mail-Anhaenge).
 *   style-src    'unsafe-inline': Komponenten setzen Stile zur Laufzeit. Stile
 *                sind kein Weg, an den Token zu kommen; Skripte schon.
 *   worker-src   blob: — Vite und three.js starten Worker aus Blobs.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.openai.com https://*.openai.com wss://*.openai.com blob:",
  "worker-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

/*
 * Das Widget und seine Demoseite bleiben aussen vor: sie werden in fremde
 * Seiten eingebettet, und dort gilt ohnehin die CSP der fremden Seite. Der
 * Token liegt dort nicht.
 */
const ohneCsp = (pfad: string) => pfad === "/widget.js" || pfad.startsWith("/embed-demo");

export function sicherheitsKopfzeilen(req: Request, res: Response, next: NextFunction): void {
  /*
   * LUKAS_CSP=off schaltet sie ab, LUKAS_CSP=report meldet nur, statt zu
   * blockieren. Der Report-Modus ist der ehrliche Weg, eine CSP einzufuehren:
   * bricht doch etwas, sieht man es in der Browserkonsole, statt dass das
   * Dashboard weiss bleibt.
   */
  const modus = (process.env.LUKAS_CSP ?? "an").trim().toLowerCase();
  if (modus !== "off" && !ohneCsp(req.path)) {
    res.setHeader(
      modus === "report" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
      // Safari does not consistently match a WebSocket against connect-src self.
      // Allow only this response's validated host, never a scheme-wide wildcard.
      /^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(req.headers.host ?? "")
        ? CSP.replace("connect-src 'self'", `connect-src 'self' wss://${req.headers.host}${req.secure || String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() === "https" ? "" : ` ws://${req.headers.host}`}`)
        : CSP,
    );
  }

  // Kein Raten am Inhaltstyp: verhindert, dass ein hochgeladener Text als
  // Skript ausgefuehrt wird, nur weil er danach aussieht.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Das Dashboard gehoert in kein fremdes Fenster.
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  /*
   * Mikrofon MUSS erlaubt bleiben — daran haengt der Sprachkanal. Genau
   * deshalb steht diese Zeile hier und nicht in einer fertigen Kopfzeilen-
   * Bibliothek: deren Standardwert schaltet ihn ab, und man merkt es erst,
   * wenn das Gespraech stumm bleibt.
   */
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");

  const ueberHttps =
    req.secure || String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() === "https";
  if (ueberHttps) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
}

type Eimer = { anzahl: number; zuruecksetzenUm: number };
const eimer = new Map<string, Eimer>();

/** Nur fuer den Test: den Zaehler leeren. */
export function drosselZuruecksetzen(): void {
  eimer.clear();
}

/*
 * Ein Limit fuer die private API.
 *
 * Es geht hier nicht um einen entschlossenen Angreifer — der braeuchte den
 * Token. Es geht um das, was tatsaechlich passiert: eine Schleife im
 * Dashboard, ein haengendes Skript, ein durchgedrehter Neuversuch. Ohne
 * Deckel laeuft so etwas bis zur Rechnung durch.
 *
 * Grosszuegig gesetzt: das Dashboard fragt mehrere Listen im Halbminutentakt
 * ab, und eine lange Chat-Antwort ist EINE Anfrage, die minutenlang offen
 * bleibt — die zaehlt also nur einmal.
 */
export function apiDrossel(req: Request, res: Response, next: NextFunction): void {
  if (!istApi(req.path) || istOeffentlich(req.path)) return void next();

  const ip = klientIp(req);
  // Lukas selbst ruft ueber die Schleife an, nicht uebers Netz. Sich selbst
  // auszusperren waere die duemmste Art, an ein Limit zu geraten.
  if (istSchleife(ip)) return void next();

  const grenze = Number(process.env.LUKAS_RATE_LIMIT ?? 240);
  if (!Number.isFinite(grenze) || grenze <= 0) return void next();

  const fenster = 60_000;
  const jetzt = Date.now();
  const vorhanden = eimer.get(ip);

  if (!vorhanden || vorhanden.zuruecksetzenUm <= jetzt) {
    // Aufraeumen, solange es billig ist: sonst waechst die Tabelle mit jeder
    // neuen Adresse weiter, auch wenn niemand mehr da ist.
    if (eimer.size > 5000) {
      for (const [schluessel, wert] of eimer) {
        if (wert.zuruecksetzenUm <= jetzt) eimer.delete(schluessel);
      }
    }
    eimer.set(ip, { anzahl: 1, zuruecksetzenUm: jetzt + fenster });
    return void next();
  }

  vorhanden.anzahl++;
  if (vorhanden.anzahl > grenze) {
    const sekunden = Math.max(1, Math.ceil((vorhanden.zuruecksetzenUm - jetzt) / 1000));
    res.setHeader("Retry-After", String(sekunden));
    res.status(429).json({ error: "Zu viele Anfragen — kurz durchatmen.", retryAfter: sekunden });
    return;
  }
  next();
}
