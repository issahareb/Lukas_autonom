#!/usr/bin/env node
/*
 * Testet die Zustimmungserkennung aus lib/policy.ts.
 *
 * Warum genau hier ein Test steht: an dieser Funktion haengt, ob eine E-Mail
 * rausgeht. Die erste Fassung war ein loses Regex, das in "Nein, schick das
 * noch NICHT ab" das Wort "schick" fand und den Versand freigab — also
 * ausgerechnet in dem Satz, mit dem man ihn stoppen will. So ein Fehler faellt
 * beim Lesen nicht auf und im Betrieb erst, wenn die Mail schon weg ist.
 *
 * Laeuft im typecheck mit. Bundelt policy.ts mit esbuild, weil die Datei TS ist
 * und ueber Workspace-Pakete importiert.
 */
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// [Nachricht, gilt als Zustimmung?]
const CASES = [
  // Eindeutige Zustimmung — muss durchgehen, sonst nervt es Issa.
  ["Ja, schick ab", true],
  ["ja", true],
  ["Ok mach", true],
  ["Senden", true],
  ["raus damit", true],
  ["passt so", true],
  ["Jup, abschicken", true],

  // Verneinung. Jeder dieser Saetze hat frueher den Versand ausgeloest.
  ["Nein, schick das noch nicht.", false],
  ["Schick das NICHT ab", false],
  ["Warte, noch nicht senden", false],
  ["Lieber nicht abschicken", false],
  ["stopp, nicht senden", false],
  ["Erstmal nicht senden", false],

  // Fragen sind keine Auftraege.
  ["Kannst du das theoretisch senden?", false],
  ["Soll ich das senden?", false],
  ["Wie verschickt man sowas?", false],

  // Weder noch.
  ["", false],
  ["   ", false],
  ["Erzähl mir was über Mails", false],
  // Ein Auftrag ist keine Bestaetigung eines konkreten Entwurfs: hier soll
  // Lukas erst zeigen, WAS er senden will, und dann fragen.
  ["Schreib Müller eine Mail", false],
];

// Innerhalb des Pakets ablegen, damit die externen Importe (drizzle-orm,
// pg, …) ueber das normale node_modules aufgeloest werden koennen.
const dir = await mkdtemp(path.join(here, "..", ".consent-check-"));
const outfile = path.join(dir, "policy.mjs");

/*
 * Gemeinsamer Einstieg fuer beide Module: die Einstufung steht in policy.ts,
 * das Merken der Mail-Links in email.ts. Geprueft wird ihr Zusammenspiel —
 * getrennt sagt keines von beiden etwas ueber die Sperre aus.
 */
const entry = path.join(dir, "entry.ts");
await writeFile(
  entry,
  'export * from "' + path.resolve(here, "..", "src", "lib", "policy.ts").replaceAll("\\", "/") + '";\n' +
    'export { rememberEmailLinks } from "' + path.resolve(here, "..", "src", "lib", "email.ts").replaceAll("\\", "/") + '";\n',
);

try {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "error",
    external: ["pg", "pino", "ssh2", "ffmpeg-static", "drizzle-orm", "imapflow", "mailparser", "nodemailer"],
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; globalThis.require = __cr(import.meta.url);",
    },
  });

  // policy.ts zieht den DB-Client mit hoch; ein Dummy-Wert reicht, verbunden
  // wird beim blossen Import nicht.
  process.env.DATABASE_URL ??= "postgresql://user:pass@127.0.0.1:5432/none";
  const mod = await import(pathToFileURL(outfile).href);
  const { isAffirmation, riskFor, escalate, rememberEmailLinks } = mod;

  const failures = [];
  for (const [message, expected] of CASES) {
    const actual = isAffirmation(message);
    if (actual !== expected) failures.push({ message, expected, actual });
  }

  /*
   * Der Browser darf kein Weg an der Mail-Link-Sperre vorbei sein.
   *
   * fetch_url stuft einen Link aus einer fremden Mail auf freigabepflichtig
   * hoch — genau damit "Mail gelesen, Link geoeffnet" nicht in einem Zug
   * durchlaeuft. browse_page kam neu dazu und tut dasselbe, nur gruendlicher:
   * es fuehrt die Skripte der Seite sogar aus. Haette die Pruefung nur
   * fetch_url gekannt, waere die Sperre ab sofort mit dem staerkeren Werkzeug
   * zu umgehen gewesen.
   */
  const pruefe = (was, ist, soll) => {
    if (ist !== soll) failures.push({ message: was, expected: soll, actual: ist });
  };

  const frei = "https://example.com/normal";
  const ausMail = "https://boese.example/klick-mich";

  pruefe("browse_page ist normal frei", escalate(riskFor("browse_page"), "browse_page", { url: frei }), "R0");
  pruefe("fetch_url ist normal frei", escalate(riskFor("fetch_url"), "fetch_url", { url: frei }), "R0");

  rememberEmailLinks(`Hier klicken: ${ausMail}`);

  pruefe(
    "fetch_url auf Mail-Link braucht Freigabe",
    escalate(riskFor("fetch_url"), "fetch_url", { url: ausMail }),
    "R2",
  );
  pruefe(
    "browse_page auf Mail-Link braucht Freigabe",
    escalate(riskFor("browse_page"), "browse_page", { url: ausMail }),
    "R2",
  );
  pruefe(
    "eine andere Seite bleibt frei",
    escalate(riskFor("browse_page"), "browse_page", { url: frei }),
    "R0",
  );

  /*
   * mcp_call darf kein Weg an den Server-Einstufungen vorbei sein.
   *
   * Es ruft ein beliebiges Werkzeug eines verbundenen Servers auf. Stuende es
   * fest auf R1, waere ein Server, den Issa bewusst auf R2 oder R3 gesetzt hat,
   * damit umgangen — mit genau dem Werkzeug, das Zugriff auf alles gibt.
   */
  const { setMcpRiskTiers } = mod;

  setMcpRiskTiers([{ slug: "higgsfield", riskTier: "R1" }]);
  pruefe("mcp_call bei harmlosen Servern frei", riskFor("mcp_call"), "R1");

  setMcpRiskTiers([
    { slug: "higgsfield", riskTier: "R1" },
    { slug: "bank", riskTier: "R2" },
  ]);
  pruefe("mcp_call folgt dem strengsten Server (R2)", riskFor("mcp_call"), "R2");

  setMcpRiskTiers([
    { slug: "higgsfield", riskTier: "R1" },
    { slug: "wallet", riskTier: "R3" },
  ]);
  pruefe("mcp_call folgt dem strengsten Server (R3)", riskFor("mcp_call"), "R3");

  setMcpRiskTiers([]);

  /*
   * ── Der Freigabepfad selbst ────────────────────────────────────────────
   *
   * Bis hierher wurde geprüft, was isAffirmation() und riskFor() SAGEN. Was
   * nicht geprüft war: was checkPolicy() daraus MACHT — und das ist die
   * Funktion, an der alles hängt.
   *
   * Aufgefallen ist die Lücke durch eine Mutationsprobe: nimmt man die Zeile
   * `tier === "R2"` aus der Zustimmungsbedingung heraus, gäbe ein beiläufiges
   * "ja" im Chat einen R3-Aufruf frei — Root auf dem Droplet. Kein einziger
   * Test hat das gemerkt, weil kein Test checkPolicy je aufgerufen hat. Ein
   * Kommentar ("R3 bleibt IMMER bei der Dashboard-Freigabe") ist keine
   * Zusicherung. Das hier schon.
   *
   * Die Datenbank ist eine Attrappe, die sich wie Drizzle verhält. Wichtig:
   * das UPDATE gibt nur die Zeilen zurück, die es tatsächlich gedreht hat —
   * genau darauf beruht, dass eine Freigabe nur EINMAL eingelöst wird.
   */
  const dbAttrappe = path.join(dir, "db.mjs");
  await writeFile(
    dbAttrappe,
    `globalThis.__zeilen = [];
let naechsteId = 1;
export const approvals = new Proxy({}, { get: (_t, k) => String(k) });
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
export const gt = (feld, wert) => (z) => z[feld] > wert;
export const and = (...b) => (z) => b.every((f) => f(z));
export const desc = () => () => true;
export const sql = () => ({});
export const db = {
  update: () => ({
    set: (werte) => ({
      where: (b) => ({
        returning: async () => {
          const treffer = globalThis.__zeilen.filter(b);
          for (const z of treffer) Object.assign(z, werte);
          return treffer;
        },
      }),
    }),
  }),
  select: () => ({
    from: () => ({
      where: (b) => ({
        limit: async () => globalThis.__zeilen.filter(b),
        orderBy: () => ({ limit: async () => globalThis.__zeilen.filter(b) }),
      }),
    }),
  }),
  insert: () => ({
    values: (werte) => ({
      returning: async () => {
        const zeile = { id: naechsteId++, ...werte };
        globalThis.__zeilen.push(zeile);
        return [zeile];
      },
    }),
  }),
};
export const logger = { info() {}, warn() {}, error() {}, debug() {} };
`,
  );

  const policyOut = path.join(dir, "policy-mit-db.mjs");
  await build({
    entryPoints: [path.resolve(here, "..", "src", "lib", "policy.ts")],
    outfile: policyOut,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "error",
    alias: { "@workspace/db": dbAttrappe, "drizzle-orm": dbAttrappe },
    // Auch das Protokoll: sonst schreibt jeder Prüflauf ein Dutzend
    // Info-Zeilen in die CI-Ausgabe, und echte Fehler gehen darin unter.
    plugins: [
      {
        name: "leises-protokoll",
        setup(b) {
          b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: dbAttrappe }));
        },
      },
    ],
    external: ["pg", "pino", "ssh2", "ffmpeg-static", "imapflow", "mailparser", "nodemailer"],
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; globalThis.require = __cr(import.meta.url);",
    },
  });
  const { checkPolicy } = await import(pathToFileURL(policyOut).href);

  const gueltigBis = () => new Date(Date.now() + 30 * 60 * 1000);
  const mail = { to: "kunde@example.com", subject: "Angebot", body: "Anbei." };

  // R0/R1 laufen ohne jede Anfrage durch — sonst wäre Lukas unbrauchbar.
  globalThis.__zeilen = [];
  pruefe("eine Suche braucht keine Freigabe", (await checkPolicy("query_memory", { q: "x" })).allow, true);
  pruefe("und legt auch keine Anfrage an", globalThis.__zeilen.length, 0);

  // R2 ohne alles: es entsteht eine offene Anfrage, ausgeführt wird nichts.
  globalThis.__zeilen = [];
  pruefe(
    "ein Mailversand läuft nicht einfach los",
    (await checkPolicy("email_send", mail, 1, "Schreib dem Kunden")).allow,
    false,
  );
  pruefe("sondern landet als Anfrage im Dashboard", globalThis.__zeilen.length, 1);
  pruefe("und zwar offen", globalThis.__zeilen[0].status, "pending");

  // Dieselben Argumente + ein klares Ja: jetzt geht es raus.
  globalThis.__zeilen[0].expiresAt = gueltigBis();
  pruefe(
    "nach Issas 'ja' geht dieselbe Mail raus",
    (await checkPolicy("email_send", mail, 1, "Ja, schick ab")).allow,
    true,
  );
  pruefe("die Freigabe ist damit verbraucht", globalThis.__zeilen[0].status, "used");
  pruefe(
    "und zählt kein zweites Mal",
    (await checkPolicy("email_send", mail, 1, "Ja, schick ab")).allow,
    false,
  );

  /*
   * Eine Zustimmung muss KURZ sein.
   *
   * "Ja, und schreib bitte noch Herrn Meier wegen des Termins" enthält "ja"
   * und "schreib" — und hätte damit die offene Mail freigegeben, obwohl Issa
   * gerade von etwas ganz anderem redet. Der Rest der Prüfung (Hash,
   * Einmaligkeit, kein R3) war eng; die Breite der Nachricht selbst war es
   * nicht.
   */
  globalThis.__zeilen = [];
  await checkPolicy("email_send", mail, 1, "Zeig mir den Entwurf");
  globalThis.__zeilen[0].expiresAt = gueltigBis();
  pruefe(
    "ein langer Absatz mit einem 'ja' darin ist KEINE Freigabe",
    (await checkPolicy("email_send", mail, 1,
      "Ja genau, und schreib bitte noch Herrn Meier wegen des Termins am Donnerstag, " +
      "außerdem brauche ich später die Zahlen vom letzten Quartal und den Entwurf für die Startseite")).allow,
    false,
  );
  pruefe("die kurze Bestätigung dagegen schon", (await checkPolicy("email_send", mail, 1, "Ja, schick ab")).allow, true);

  /*
   * Und der zuverlässige Weg: die Nummer der Freigabe. Sie ist eine Aussage
   * über GENAU diese Anfrage — deshalb gilt dort auch die Längengrenze nicht.
   */
  globalThis.__zeilen = [];
  const offen = await checkPolicy("email_send", mail, 1, "Zeig mir den Entwurf");
  globalThis.__zeilen[0].expiresAt = gueltigBis();
  const nummer = globalThis.__zeilen[0].id;
  pruefe(
    "die Freigabe-Nummer gibt frei, auch in einem längeren Satz",
    (await checkPolicy("email_send", mail, 1,
      `Habe den Entwurf gelesen, sieht gut aus, bitte Freigabe #${nummer} einlösen und danach machen wir mit dem Rest weiter`)).allow,
    true,
  );

  // Eine FALSCHE Nummer gibt nichts frei.
  globalThis.__zeilen = [];
  await checkPolicy("email_send", mail, 1, "Entwurf?");
  globalThis.__zeilen[0].expiresAt = gueltigBis();
  pruefe(
    "eine fremde Nummer gibt nichts frei",
    (await checkPolicy("email_send", mail, 1, `Freigabe #${globalThis.__zeilen[0].id + 99} bitte einlösen und weiter geht es mit dem nächsten Punkt`)).allow,
    false,
  );

  // Ein Nein bleibt ein Nein.
  globalThis.__zeilen = [];
  await checkPolicy("email_send", mail, 1, "Zeig mir den Entwurf");
  globalThis.__zeilen[0].expiresAt = gueltigBis();
  pruefe(
    "'Nein, schick das noch nicht' gibt nichts frei",
    (await checkPolicy("email_send", mail, 1, "Nein, schick das noch nicht")).allow,
    false,
  );
  pruefe(
    "und eine Zustimmung gilt nicht für einen ANDEREN Text",
    (await checkPolicy("email_send", { ...mail, body: "Etwas ganz anderes." }, 1, "Ja, schick ab")).allow,
    false,
  );

  // Autonomer Lauf: kein Nutzertext, also keine Abkürzung.
  globalThis.__zeilen = [];
  await checkPolicy("email_send", mail, undefined, undefined);
  globalThis.__zeilen[0].expiresAt = gueltigBis();
  pruefe(
    "im autonomen Lauf gibt es keine Zustimmung im Chat",
    (await checkPolicy("email_send", mail, undefined, undefined)).allow,
    false,
  );

  /*
   * DIE STELLE. R3 — Root auf dem Droplet — darf NIE über ein "ja" im Chat
   * laufen, sondern nur über den Klick im Dashboard, wo der genaue Befehl vor
   * Augen steht.
   */
  process.env.LUKAS_HOST_APPROVAL = "true";
  const befehl = { command: "rm -rf /var/www" };
  globalThis.__zeilen = [];
  await checkPolicy("execute_on_host", befehl, 1, "Räum das mal auf");
  globalThis.__zeilen[0].expiresAt = gueltigBis();
  pruefe("ein Host-Befehl landet als R3-Anfrage", globalThis.__zeilen[0].riskTier, "R3");
  pruefe(
    "und ein beiläufiges 'ja' im Chat gibt ihn NICHT frei",
    (await checkPolicy("execute_on_host", befehl, 1, "Ja, mach")).allow,
    false,
  );
  globalThis.__zeilen[0].status = "allowed";
  pruefe(
    "über das Dashboard freigegeben läuft er",
    (await checkPolicy("execute_on_host", befehl, 1, "Ja, mach")).allow,
    true,
  );
  delete process.env.LUKAS_HOST_APPROVAL;


  if (failures.length > 0) {
    console.error("FEHLER in der Zustimmungserkennung:\n");
    for (const f of failures) {
      console.error(`  "${f.message}" -> ${f.actual}, erwartet ${f.expected}`);
    }
    console.error("\nEine E-Mail haengt daran. Bitte lib/policy.ts korrigieren.");
    process.exit(1);
  }

  console.log(`OK — Zustimmung + Mail-Link-Sperre: ${CASES.length + 8} Fälle korrekt, Freigabepfad inklusive.`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
