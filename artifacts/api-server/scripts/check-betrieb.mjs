/*
 * Prueft zwei Dinge, die man erst merkt, wenn sie fehlen — und dann teuer.
 *
 * 1. DIE SPERRE. Zwei Laeufe duerfen nie gleichzeitig an denselben Zielen
 *    arbeiten — sonst schreiben sie sich gegenseitig den Fortschritt um.
 *    Dass sich das ueberhaupt ueberschneiden kann, hat drei Gruende, und nur
 *    der erste haengt am Takt: ein Zug darf bis zu 25 Minuten arbeiten
 *    (LUKAS_TURN_MAX_MINUTEN), gemessen ab dem ersten Modellaufruf — steht
 *    der Takt eng, ueberholt ein langsamer Lauf seinen eigenen Zyklus. Der
 *    Abstand ist derzeit weit (LUKAS_AUTONOMY_INTERVAL_MIN), aber das ist
 *    eine Einstellung, kein Gesetz. Die beiden anderen Gruende bleiben davon
 *    ohnehin unberuehrt: waehrend eines Deployments laufen kurz zwei
 *    Instanzen, und die Instanzzahl kann jemand hochsetzen.
 *    Geprueft wird deshalb: der zweite Lauf laeuft NICHT an,
 *    die Sperre wird danach wieder freigegeben, und ohne Datenbank passiert
 *    gar nichts (statt blind loszulaufen und Tokens fuer ein Ergebnis
 *    auszugeben, das nirgends abgelegt werden kann).
 *
 * 2. DER ABSCHIED. Railway schickt bei jedem Deployment ein SIGTERM. Ohne
 *    Behandlung endet Node auf der Stelle — mitten in einer Chat-Antwort,
 *    mitten in einem Datenbankschreibvorgang. Geprueft wird die REIHENFOLGE,
 *    denn daran haengt alles: erst krankmelden, dann Taktgeber aus, dann keine
 *    neuen Verbindungen, und die Datenbank ganz zuletzt.
 *
 * Attrappen sind hier pg und die Datenbank — beides steht in einer Pruefung
 * nicht zur Verfuegung. Die Attrappe fuer pg_try_advisory_lock bildet nach,
 * was Postgres zusagt: die Sperre gehoert einer VERBINDUNG, und mit der
 * Verbindung faellt sie.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".betrieb-check-"));
const attrappe = join(dir, "attrappe.mjs");

writeFileSync(
  attrappe,
  `globalThis.__gesperrt = new Set();
globalThis.__sql = [];
globalThis.__verbindungen = 0;
globalThis.__pool = { beendet: 0, fehlerZuhoerer: 0 };

class Client {
  constructor(cfg) { this.cfg = cfg; this.meine = new Set(); }
  async connect() {
    if (globalThis.__dbKaputt) throw new Error("ECONNREFUSED");
    globalThis.__verbindungen++;
  }
  async query(sql, werte) {
    const schluessel = werte?.[0];
    globalThis.__sql.push(sql);
    if (sql.includes("pg_try_advisory_lock")) {
      if (globalThis.__gesperrt.has(schluessel)) return { rows: [{ ok: false }] };
      globalThis.__gesperrt.add(schluessel);
      this.meine.add(schluessel);
      return { rows: [{ ok: true }] };
    }
    if (sql.includes("pg_advisory_unlock")) {
      globalThis.__gesperrt.delete(schluessel);
      this.meine.delete(schluessel);
      return { rows: [{ ok: true }] };
    }
    return { rows: [] };
  }
  async end() {
    // Wie bei Postgres: mit der Verbindung fallen ihre Sperren.
    for (const s of this.meine) globalThis.__gesperrt.delete(s);
    this.meine.clear();
    globalThis.__verbindungen--;
  }
}
export default { Client };
export const logger = { info() {}, warn() {}, error() {}, debug() {} };
export const pool = {
  end: async () => { globalThis.__pool.beendet++; },
  on: () => { globalThis.__pool.fehlerZuhoerer++; },
  query: async () => ({ rows: [] }),
};
`,
);

const bauen = async (eintritt, datei) => {
  const out = join(dir, datei);
  await build({
    entryPoints: [eintritt],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    plugins: [
      {
        name: "attrappen",
        setup(b) {
          b.onResolve({ filter: /^(pg|@workspace\/db)$/ }, () => ({ path: attrappe }));
          b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: attrappe }));
        },
      },
    ],
    logLevel: "silent",
  });
  return import(`file://${out}`);
};

const { mitSperre, SPERREN } = await bauen("src/lib/lauf-sperre.ts", "sperre.mjs");
const { richteAbschiedEin, istImAbschied } = await bauen("src/lib/abschied.ts", "abschied.mjs");
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

// ── 1. Zwei Läufe gleichzeitig — nur einer kommt durch ───────────────────
{
  let gelaufen = 0;
  let freigeben;
  const haengt = new Promise((r) => (freigeben = r));

  const erster = mitSperre("autonomie", async () => {
    gelaufen++;
    await haengt;
    return "fertig";
  });
  // Kurz warten, damit der erste die Sperre wirklich hat.
  await new Promise((r) => setTimeout(r, 10));

  const zweiter = await mitSperre("autonomie", async () => {
    gelaufen++;
    return "auch fertig";
  });

  pruefe("der zweite Lauf startet gar nicht erst", gelaufen === 1);
  pruefe("und meldet das als 'nichts getan', nicht als Fehler", zweiter === null);

  freigeben();
  pruefe("der erste läuft ungestört zu Ende", (await erster) === "fertig");
  pruefe("danach ist die Sperre wieder frei", globalThis.__gesperrt.size === 0);
  /*
   * Ausdrücklich entsperrt, nicht nur die Verbindung weggeworfen. Bei einer
   * direkten Verbindung liefe beides aufs Gleiche hinaus — Postgres gibt die
   * Sperren einer geschlossenen Verbindung selbst frei. Sitzt aber ein
   * Verbindungs-Pooler dazwischen (PgBouncer im Transaktionsmodus, bei
   * gehosteten Datenbanken die Regel), wird die Sitzung NICHT beendet, sondern
   * dem Nächsten weitergereicht — samt Sperre. Dann hinge die Autonomie für
   * immer, und zwar lautlos.
   */
  pruefe(
    "die Sperre wird ausdrücklich freigegeben, nicht nur die Verbindung weggeworfen",
    globalThis.__sql.some((q) => q.includes("pg_advisory_unlock")),
  );
  pruefe("und die Verbindung ist zurückgegeben", globalThis.__verbindungen === 0);
}

// ── 2. Verschiedene Läufe behindern sich NICHT ───────────────────────────
// Die Gegenrichtung: eine Sperre, die alles bremst, waere schlimmer als keine.
{
  let freigeben;
  const haengt = new Promise((r) => (freigeben = r));
  const autonom = mitSperre("autonomie", () => haengt);
  await new Promise((r) => setTimeout(r, 10));
  const moltbook = await mitSperre("moltbook", async () => "läuft");
  pruefe("Moltbook läuft, während die Autonomie arbeitet", moltbook === "läuft");
  pruefe("die Schlüssel sind verschieden", SPERREN.autonomie !== SPERREN.moltbook);
  freigeben();
  await autonom;
}

// ── 3. Ein Fehler im Lauf gibt die Sperre trotzdem frei ──────────────────
{
  let geworfen = null;
  try {
    await mitSperre("autonomie", async () => {
      throw new Error("mitten drin abgestürzt");
    });
  } catch (err) {
    geworfen = err;
  }
  pruefe("ein Absturz im Lauf wird durchgereicht", geworfen?.message === "mitten drin abgestürzt");
  pruefe("aber die Sperre bleibt NICHT hängen", globalThis.__gesperrt.size === 0);
  pruefe("und die Verbindung auch nicht", globalThis.__verbindungen === 0);
}

// ── 4. Ohne Datenbank wird ausgelassen statt blind losgelaufen ───────────
{
  globalThis.__dbKaputt = true;
  let gelaufen = 0;
  const ergebnis = await mitSperre("autonomie", async () => {
    gelaufen++;
    return "x";
  });
  globalThis.__dbKaputt = false;
  pruefe("ohne Datenbank startet kein Lauf", gelaufen === 0);
  pruefe("und es kommt sauber null zurück", ergebnis === null);
}

// ── 5. Der Abschied — die Reihenfolge ist der ganze Punkt ────────────────
{
  const ablauf = [];
  const server = {
    close(fertig) {
      ablauf.push("keine neuen Verbindungen");
      // Als wären alle Anfragen gleich durch.
      setTimeout(fertig, 5);
    },
    closeIdleConnections() {
      ablauf.push("leerlaufende getrennt");
    },
    closeAllConnections() {
      ablauf.push("alle getrennt");
    },
  };

  const echterExit = process.exit;
  let beendetMit = null;
  process.exit = (code) => {
    beendetMit = code;
    ablauf.push("Ende");
  };

  pruefe("vor dem Signal ist alles normal", istImAbschied() === false);

  richteAbschiedEin(server, () => ablauf.push("Taktgeber aus"));
  pruefe(
    "auf den Pool wird ein Fehler-Zuhörer gesetzt (sonst stirbt der Prozess an einer Leerlauf-Verbindung)",
    globalThis.__pool.fehlerZuhoerer === 1,
  );

  process.emit("SIGTERM");
  pruefe("ab dem Signal meldet sich der Server krank", istImAbschied() === true);
  pruefe(
    "und zwar BEVOR irgendetwas abgebaut wird — sonst laufen noch Anfragen herein",
    ablauf.indexOf("Taktgeber aus") === 0,
  );
  pruefe(
    "die Taktgeber gehen aus, bevor keine Verbindungen mehr angenommen werden",
    ablauf.indexOf("Taktgeber aus") < ablauf.indexOf("keine neuen Verbindungen"),
  );

  await new Promise((r) => setTimeout(r, 40));
  pruefe("die Datenbank wird zuletzt geschlossen", globalThis.__pool.beendet === 1);
  pruefe("und der Prozess endet sauber", beendetMit === 0);
  pruefe(
    "die Notbremse blieb ungenutzt — es ging ja rechtzeitig zu Ende",
    !ablauf.includes("alle getrennt"),
  );

  process.exit = echterExit;
}

if (fehler > 0) process.exit(1);
console.log(
  "OK — Betrieb: kein Lauf doppelt, keine Sperre hängt, und beim Herunterfahren geht die Reihenfolge auf.",
);
