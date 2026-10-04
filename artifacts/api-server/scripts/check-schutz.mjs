/*
 * Prueft den Grundschutz der privaten API.
 *
 * Drei Dinge, die alle leicht falsch herum sind:
 *
 *  1. CORS. Vorher stand dort `app.use(cors())` — jede fremde Seite durfte im
 *     Browser eines Angemeldeten Anfragen stellen UND die Antwort lesen. Die
 *     Gegenrichtung ist genauso wichtig: das Widget auf Issas Portfolio MUSS
 *     weiter von aussen drankommen, sonst schaltet man mit der Absicherung den
 *     oeffentlichen Chat ab.
 *  2. Das Limit. Es soll eine durchdrehende Schleife bremsen — aber niemals
 *     Lukas selbst (der ruft von localhost) und niemals einen Webhook (Meta
 *     und OpenAI wiederholen nicht ewig, eine verworfene Nachricht ist weg).
 *  3. Die Kopfzeilen. Genau eine davon ist gefaehrlich: schaltet man das
 *     Mikrofon per Permissions-Policy ab, bleibt der Sprachkanal stumm — und
 *     zwar ohne Fehlermeldung. Fertige Bibliotheken tun das im Standardfall.
 */
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".schutz-check-"));
const out = join(dir, "schutz.mjs");

await build({
  entryPoints: ["src/middlewares/schutz.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  logLevel: "silent",
});

const {
  herkunftErlaubt,
  korsRegeln,
  sicherheitsKopfzeilen,
  apiDrossel,
  klientIp,
  drosselZuruecksetzen,
  gleicherToken,
} = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

const anfrage = (pfad, { origin, ip, proto, host = "lukas.issahareb.me" } = {}) => ({
  path: pfad,
  ip: ip ?? "203.0.113.7",
  secure: false,
  headers: {
    host,
    ...(origin ? { origin } : {}),
    ...(ip ? { "x-forwarded-for": ip } : {}),
    ...(proto ? { "x-forwarded-proto": proto } : {}),
  },
});

const antwort = () => {
  const kopf = {};
  return {
    kopf,
    status: null,
    koerper: null,
    setHeader(name, wert) {
      kopf[name] = wert;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(daten) {
      this.koerper = daten;
      return this;
    },
  };
};

const durch = (mw, req) => {
  const res = antwort();
  let weiter = false;
  mw(req, res, () => {
    weiter = true;
  });
  return { weiter, res };
};

// ── 1. Herkunft ───────────────────────────────────────────────────────────
process.env.LUKAS_ALLOWED_ORIGINS = "https://issahareb.me, www.issahareb.me";

pruefe(
  "der eigene Host darf",
  herkunftErlaubt(anfrage("/api/lukas/memories"), "https://lukas.issahareb.me"),
);
pruefe(
  "ein eingetragener Ursprung darf",
  herkunftErlaubt(anfrage("/api/lukas/memories"), "https://issahareb.me"),
);
pruefe(
  "auch ohne Schema eingetragen",
  herkunftErlaubt(anfrage("/api/lukas/memories"), "https://www.issahareb.me"),
);
pruefe(
  "eine fremde Seite darf NICHT",
  !herkunftErlaubt(anfrage("/api/lukas/memories"), "https://boese.example"),
);
pruefe(
  "ein Ursprung, der wie der eigene AUSSIEHT, darf auch nicht",
  !herkunftErlaubt(anfrage("/api/lukas/memories"), "https://lukas.issahareb.me.boese.example"),
);
pruefe(
  "Unsinn im Origin-Kopf darf nicht",
  !herkunftErlaubt(anfrage("/api/lukas/memories"), "nicht-mal-eine-url"),
);
pruefe(
  "ohne Origin (Server-Aufruf, curl, dieselbe Seite) darf",
  herkunftErlaubt(anfrage("/api/lukas/memories"), undefined),
);

// Gegenrichtung: der oeffentliche Teil muss offen bleiben.
pruefe(
  "das Widget kommt von einer fremden Seite durch",
  herkunftErlaubt(anfrage("/api/public/chat"), "https://irgendein-portfolio.example"),
);
pruefe(
  "der WhatsApp-Webhook auch",
  herkunftErlaubt(anfrage("/api/whatsapp/webhook"), "https://graph.facebook.com"),
);
pruefe(
  "und statische Dateien ausserhalb der API sowieso",
  herkunftErlaubt(anfrage("/widget.js"), "https://irgendwo.example"),
);

// Ohne Liste bleibt nur der eigene Host uebrig.
delete process.env.LUKAS_ALLOWED_ORIGINS;
pruefe(
  "ohne LUKAS_ALLOWED_ORIGINS gilt weiter der eigene Host",
  herkunftErlaubt(anfrage("/api/lukas/memories"), "https://lukas.issahareb.me"),
);
pruefe(
  "und sonst niemand",
  !herkunftErlaubt(anfrage("/api/lukas/memories"), "https://issahareb.me"),
);

// Das Regelwerk fuer das cors-Paket reicht die Entscheidung durch.
let regel = null;
korsRegeln(anfrage("/api/lukas/memories", { origin: "https://boese.example" }), (_e, o) => {
  regel = o;
});
pruefe("das Kors-Regelwerk lehnt fremde Herkunft ab", regel?.origin === false);
korsRegeln(anfrage("/api/public/chat", { origin: "https://boese.example" }), (_e, o) => {
  regel = o;
});
pruefe("und laesst den oeffentlichen Teil zu", regel?.origin === true);

// ── 2. Kopfzeilen ─────────────────────────────────────────────────────────
{
  const { weiter, res } = durch(sicherheitsKopfzeilen, anfrage("/chat"));
  pruefe("die Kopfzeilen halten nichts auf", weiter);
  pruefe("kein Raten am Inhaltstyp", res.kopf["X-Content-Type-Options"] === "nosniff");
  pruefe("kein fremder Rahmen", res.kopf["X-Frame-Options"] === "SAMEORIGIN");
  pruefe("Referrer eingeschränkt", Boolean(res.kopf["Referrer-Policy"]));
  pruefe(
    "das MIKROFON bleibt erlaubt — sonst ist der Sprachkanal stumm",
    /microphone=\(self\)/.test(res.kopf["Permissions-Policy"] ?? ""),
  );
  pruefe(
    "Kamera und Ort sind zu",
    /camera=\(\)/.test(res.kopf["Permissions-Policy"] ?? "") &&
      /geolocation=\(\)/.test(res.kopf["Permissions-Policy"] ?? ""),
  );
  pruefe("ohne HTTPS kein HSTS", !res.kopf["Strict-Transport-Security"]);
}
{
  const { res } = durch(sicherheitsKopfzeilen, anfrage("/chat", { proto: "https" }));
  pruefe("hinter HTTPS dagegen schon", Boolean(res.kopf["Strict-Transport-Security"]));
}

// ── 2b. Content-Security-Policy ───────────────────────────────────────────
// Im localStorage liegt der Zugangstoken. Der einzige realistische Weg, ihn
// auszulesen, ist ein eingeschleustes Skript — genau dagegen steht script-src.
{
  const { res } = durch(sicherheitsKopfzeilen, anfrage("/chat"));
  const csp = res.kopf["Content-Security-Policy"] ?? "";
  pruefe("es gibt eine CSP", csp.length > 0);
  pruefe("fremde Skripte sind ausgesperrt", /script-src 'self'(;|$)/.test(csp));
  pruefe("und kein 'unsafe-inline' beim Skript", !/script-src[^;]*unsafe-inline/.test(csp));
  pruefe("nichts darf uns einbetten außer wir selbst", /frame-ancestors 'self'/.test(csp));
  pruefe("Plugins sind aus", /object-src 'none'/.test(csp));

  // Gegenrichtung: was das Dashboard wirklich braucht, muss durchkommen.
  pruefe("der Sprachkanal erreicht OpenAI direkt", /connect-src[^;]*api\.openai\.com/.test(csp));
  pruefe("Mithören erhält eine explizite eigene WebSocket-Origin für Safari", csp.includes("wss://" + anfrage("/chat").headers.host));
  pruefe("und per WebSocket", /connect-src[^;]*wss:\/\/\*\.openai\.com/.test(csp));
  pruefe("fremde Bilder (Anhänge, Medien) werden angezeigt", /img-src[^;]*https:/.test(csp));
  pruefe("Laufzeit-Stile bleiben erlaubt", /style-src[^;]*'unsafe-inline'/.test(csp));
  pruefe("Worker aus Blobs auch", /worker-src[^;]*blob:/.test(csp));
}
{
  // Das Widget wird in fremde Seiten eingebettet — dort gilt deren CSP.
  const { res } = durch(sicherheitsKopfzeilen, anfrage("/widget.js"));
  pruefe("das Widget bekommt keine CSP aufgedrückt", !res.kopf["Content-Security-Policy"]);
}
{
  process.env.LUKAS_CSP = "report";
  const { res } = durch(sicherheitsKopfzeilen, anfrage("/chat"));
  pruefe("im Report-Modus wird nur gemeldet", Boolean(res.kopf["Content-Security-Policy-Report-Only"]));
  pruefe("und nichts blockiert", !res.kopf["Content-Security-Policy"]);
  process.env.LUKAS_CSP = "off";
  const aus = durch(sicherheitsKopfzeilen, anfrage("/chat")).res;
  pruefe("und ganz abschaltbar, falls doch etwas bricht", !aus.kopf["Content-Security-Policy"]);
  delete process.env.LUKAS_CSP;
}

// ── 2c. Token-Vergleich ───────────────────────────────────────────────────
// Zeitkonstant: `a !== b` bricht beim ersten falschen Zeichen ab, und daraus
// laesst sich ein Token Stueck fuer Stueck erraten.
pruefe("der richtige Token passt", gleicherToken("geheim-123", "geheim-123"));
pruefe("ein falscher nicht", !gleicherToken("geheim-124", "geheim-123"));
pruefe("ein kürzerer nicht", !gleicherToken("geheim", "geheim-123"));
pruefe("ein längerer nicht", !gleicherToken("geheim-123-mehr", "geheim-123"));
pruefe("kein Token ist kein Zutritt", !gleicherToken(undefined, "geheim-123"));
pruefe("und ein leerer erst recht nicht", !gleicherToken("", ""));

/*
 * Und jetzt das eigentliche Versprechen — das die sechs Zeilen darüber NICHT
 * prüfen.
 *
 * Aufgefallen bei einer Mutationsprobe: ersetzt man den ganzen Rumpf durch
 * `return a === b`, bleiben alle Fälle oben grün. Kein Wunder — sie prüfen das
 * ERGEBNIS, und das ist bei beiden Fassungen dasselbe. Die Eigenschaft, um die
 * es hier geht, ist aber nicht das Ergebnis, sondern die DAUER: `a !== b`
 * bricht beim ersten falschen Zeichen ab, und über viele Versuche lässt sich
 * daraus ein Token Zeichen für Zeichen rekonstruieren.
 *
 * Diese Eigenschaft lässt sich nicht sinnvoll messen — eine Zeitmessung im
 * Millisekundenbereich wäre auf einem geteilten CI-Läufer reines Rauschen und
 * würde mal grün, mal rot. Was bleibt, ist die Bauart selbst: die Funktion muss
 * timingSafeEqual benutzen und darf die beiden Werte nirgends direkt
 * vergleichen. Ein struktureller Test ist schwächer als ein Verhaltenstest —
 * aber unendlich viel besser als der falsche Eindruck, hier sei etwas
 * abgesichert, das es nicht ist.
 */
{
  const quelle = readFileSync(
    new URL("../src/middlewares/schutz.ts", import.meta.url),
    "utf8",
  );
  const rumpf = quelle.slice(
    quelle.indexOf("export function gleicherToken"),
    quelle.indexOf("export function klientIp"),
  );
  pruefe("gleicherToken vergleicht zeitkonstant", /timingSafeEqual\(einA, einB\)/.test(rumpf));
  pruefe(
    "und nirgends direkt mit === oder !==",
    !/\b(a|einA)\s*[!=]==\s*(b|einB)\b/.test(rumpf),
  );
}

// ── 3. Limit ──────────────────────────────────────────────────────────────
process.env.LUKAS_RATE_LIMIT = "5";
drosselZuruecksetzen();

let durchgelassen = 0;
let geblockt = 0;
for (let i = 0; i < 8; i++) {
  const { weiter, res } = durch(apiDrossel, anfrage("/api/lukas/memories", { ip: "198.51.100.4" }));
  if (weiter) durchgelassen++;
  else {
    geblockt++;
    pruefe("der Block sagt 429", res.statusCode === 429);
    pruefe("und wann es wieder geht", Number(res.kopf["Retry-After"]) > 0);
  }
}
pruefe(`genau 5 kommen durch (waren ${durchgelassen})`, durchgelassen === 5);
pruefe(`der Rest wird geblockt (waren ${geblockt})`, geblockt === 3);

pruefe(
  "eine andere Adresse ist davon unberührt",
  durch(apiDrossel, anfrage("/api/lukas/memories", { ip: "198.51.100.99" })).weiter,
);
pruefe(
  "Lukas selbst (localhost) wird nie gebremst",
  Array.from({ length: 50 }, () =>
    durch(apiDrossel, anfrage("/api/lukas/memories", { ip: "127.0.0.1" })).weiter,
  ).every(Boolean),
);
pruefe(
  "ein Webhook wird nie gebremst — eine verworfene Nachricht ist weg",
  Array.from({ length: 50 }, () =>
    durch(apiDrossel, anfrage("/api/whatsapp/webhook", { ip: "198.51.100.4" })).weiter,
  ).every(Boolean),
);
pruefe(
  "der öffentliche Chat hat sein eigenes, engeres Limit und wird hier nicht doppelt gebremst",
  durch(apiDrossel, anfrage("/api/public/chat", { ip: "198.51.100.4" })).weiter,
);
pruefe(
  "der Healthcheck kommt immer durch — sonst killt Railway das Deployment",
  Array.from({ length: 50 }, () =>
    durch(apiDrossel, anfrage("/healthz", { ip: "198.51.100.4" })).weiter,
  ).every(Boolean),
);

// Die Adresse hinter dem Proxy zaehlt, nicht die des Proxys.
pruefe(
  "hinter dem Proxy zählt die echte Adresse",
  klientIp({ ip: "10.0.0.1", headers: { "x-forwarded-for": "198.51.100.4, 10.0.0.1" } }) ===
    "198.51.100.4",
);

// Ein Limit von 0 oder Unsinn schaltet die Bremse ab, statt alles zu sperren.
process.env.LUKAS_RATE_LIMIT = "keine-zahl";
drosselZuruecksetzen();
pruefe(
  "ein unsinniges Limit sperrt nicht alles aus",
  durch(apiDrossel, anfrage("/api/lukas/memories", { ip: "198.51.100.4" })).weiter,
);
delete process.env.LUKAS_RATE_LIMIT;

if (fehler > 0) process.exit(1);
console.log("OK — Schutz: fremde Herkunft draußen, Widget und Webhooks drin, Limit bremst nur Fremde.");
