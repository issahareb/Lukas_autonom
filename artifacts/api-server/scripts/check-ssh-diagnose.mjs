/*
 * Prueft, dass ein SSH-Fehler als Diagnose ankommt und nicht als Raetsel.
 *
 * ANLASS: im Dashboard stand "Fehler: Timed out while waiting for handshake".
 * Das ist die Meldung der ssh2-Bibliothek, unveraendert durchgereicht. Sie
 * sagt weder Lukas noch Issa, was los ist — und vor allem sagt sie nicht, dass
 * es nichts mit dem Browser zu tun hatte, sondern damit, dass der Droplet
 * nicht antwortete.
 *
 * Drei Eigenschaften, und die zweite ist die, die Runden spart:
 *
 *  1. Jede Ursache bekommt ihren eigenen Satz. "Server aus", "Schluessel
 *     passt nicht" und "falscher Port" fuehren zu drei verschiedenen
 *     Handgriffen; eine gemeinsame Meldung fuer alle drei ist keine Hilfe.
 *  2. Es steht dabei, dass ALLE Droplet-Werkzeuge davon betroffen sind. Ohne
 *     das probiert Lukas die Geschwister durch und verbrennt drei Runden an
 *     derselben Ursache.
 *  3. Es steht dabei, dass er es nicht selbst reparieren kann. Ein Agent, der
 *     glaubt, ein weiterer Versuch schalte einen ausgeschalteten Server ein,
 *     versucht es bis zum Rundenlimit.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Legacy diagnostics first, then verify the independent browser below.
delete process.env.LUKAS_BROWSER_URL;

const dir = mkdtempSync(join(process.cwd(), ".ssh-check-"));
const out = join(dir, "s.mjs");
const attrappe = join(dir, "a.mjs");

writeFileSync(
  attrappe,
  `export const db = new Proxy({}, { get: () => () => ({}) });
export default new Proxy({}, { get: () => () => ({}) });
export const logger = { info(){},warn(){},error(){},debug(){} };
export class Client {}
`,
);

await build({
  entryPoints: ["src/lib/code-sandbox.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe, ssh2: attrappe },
  plugins: [
    { name: "a", setup(b) { b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: attrappe })); } },
  ],
  logLevel: "silent",
}).catch((e) => {
  console.error("Bundle fehlgeschlagen:", String(e.message).slice(0, 400));
  process.exit(1);
});

process.env.VPS_SSH_HOST = "203.0.113.7";
const { sshDiagnose } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) { console.error(`FEHLER: ${was}`); fehler++; }
};

const mitCode = (msg, code) => Object.assign(new Error(msg), { code });

// ── 1. Jede Ursache bekommt ihren eigenen Satz ────────────────────────────
const faelle = [
  ["Timed out while waiting for handshake", undefined, /antwortet nicht auf SSH|Server ist aus/i],
  ["All configured authentication methods failed", undefined, /Schlüssel|VPS_SSH_KEY/i],
  ["connect ECONNREFUSED 203.0.113.7:22", "ECONNREFUSED", /nimmt niemand ab|SSH-Dienst/i],
  ["getaddrinfo ENOTFOUND droplet.example", "ENOTFOUND", /auflösen|Adresse stimmt nicht/i],
  ["connect ETIMEDOUT", "ETIMEDOUT", /über das Netz nicht erreichbar/i],
];

const saetze = new Set();
for (const [msg, code, muster] of faelle) {
  const text = sshDiagnose(mitCode(msg, code));
  pruefe(`"${msg.slice(0, 34)}…" wird erkannt`, muster.test(text));
  pruefe(`… und nennt den Host`, text.includes("203.0.113.7"));
  saetze.add(text.split(" Betroffen")[0]);
}
pruefe(
  "die fünf Ursachen ergeben fünf VERSCHIEDENE Diagnosen",
  saetze.size === faelle.length,
);

// ── 2. Der Umfang steht dabei ─────────────────────────────────────────────
for (const [msg, code] of faelle) {
  const text = sshDiagnose(mitCode(msg, code));
  pruefe(
    `"${msg.slice(0, 24)}…": es steht dabei, dass alle Droplet-Werkzeuge betroffen sind`,
    /Sandbox, Browser/.test(text),
  );
  pruefe(
    `"${msg.slice(0, 24)}…": und dass er die Geschwister nicht durchprobieren soll`,
    /nicht die anderen Werkzeuge durch/.test(text),
  );
  pruefe(
    `"${msg.slice(0, 24)}…": und dass Issa ran muss`,
    /melde_dich_bei_issa/.test(text),
  );
}

// ── 3. Unbekanntes wird eingeordnet, nicht ersetzt ────────────────────────
/*
 * Wenn wir die Ursache NICHT kennen, muss die Originalmeldung erhalten
 * bleiben — sonst hat man eine huebsche Diagnose und keine Spur mehr zum
 * eigentlichen Fehler.
 */
{
  const text = sshDiagnose(new Error("Etwas völlig Unerwartetes ist passiert"));
  pruefe("die Originalmeldung bleibt erhalten", text.includes("Etwas völlig Unerwartetes"));
  pruefe("mit Einordnung davor", /SSH zum Droplet/.test(text));
  pruefe("und dem Umfang dahinter", /Sandbox, Browser/.test(text));
}

// ── 4. Die rohe Bibliotheksmeldung steht nie allein da ────────────────────
{
  const text = sshDiagnose(new Error("Timed out while waiting for handshake"));
  pruefe(
    "die nackte ssh2-Meldung wird NICHT einfach durchgereicht",
    text !== "Timed out while waiting for handshake" && text.length > 120,
  );
}

// ── 5. Und sie ist auch wirklich verdrahtet ──────────────────────────────
/*
 * Die beste Diagnose nuetzt nichts, wenn sshExec den rohen Fehler weiterhin
 * durchreicht. Das laesst sich hier nur am Quelltext pruefen — eine echte
 * SSH-Verbindung hat dieser Lauf nicht, und eine Attrappe davon wuerde
 * genau die Verdrahtung wegtesten, um die es geht. Steht bewusst so da:
 * ohne diese Zeile lief die Gegenprobe "rohen Fehler durchreichen" gruen
 * durch.
 */
{
  const quelle = await import("node:fs").then((fs) =>
    fs.readFileSync("src/lib/code-sandbox.ts", "utf8"),
  );
  /*
   * Auf die EIGENSCHAFT geprueft, nicht auf den Wortlaut: die Diagnose wird
   * erzeugt und geworfen, der rohe Fehler nicht. Der erste Entwurf suchte
   * woertlich nach `reject(new Error(sshDiagnose(err)))` — und schlug fehl,
   * sobald die Zeile aus einem anderen Grund umgebaut wurde, obwohl die
   * Eigenschaft weiter stimmte. Ein Test, der bei einer Umbenennung rot wird,
   * erzieht dazu, ihn anzupassen statt ihn zu lesen.
   */
  pruefe(
    "die Diagnose wird im Fehlerpfad erzeugt",
    /sshDiagnose\(err\)/.test(quelle),
  );
  pruefe(
    "und geworfen wird sie, nicht der rohe Fehler",
    /reject\(new Error\(diagnose\)\)|reject\(new Error\(sshDiagnose\(err\)\)\)/.test(quelle) &&
      !/finish\(\(\) => reject\(err\)\)/.test(quelle),
  );
  /*
   * Der Verbindungsaufbau bekam bisher immer ssh2s Voreinstellung von 20
   * Sekunden — auch wenn der Aufrufer 180 mitgab. Genau daran ist der Aufruf
   * im Dashboard nach 20,0 s gescheitert.
   */
  pruefe(
    "das Zeitlimit des Aufrufers gilt auch für den Verbindungsaufbau",
    /readyTimeout:\s*Math\.min\(Math\.max\(timeoutMs/.test(quelle),
  );
}

process.env.LUKAS_BROWSER_URL = "http://browser.internal:8080";
const unabhängig = sshDiagnose(new Error("All configured authentication methods failed"));
pruefe("VPS-Fehler erklärt den Railway-Browser nicht für ausgefallen", /bleiben verfügbar/.test(unabhängig) && !/Sandbox, Browser/.test(unabhängig));
delete process.env.LUKAS_BROWSER_URL;

if (fehler > 0) process.exit(1);
console.log(
  "OK — SSH-Diagnose: jede Ursache ihr eigener Satz, mit Umfang und Zuständigkeit statt einer nackten Bibliotheksmeldung.",
);
