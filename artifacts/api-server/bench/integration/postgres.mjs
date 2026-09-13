/*
 * Ein echtes Postgres — kein nachgebautes.
 *
 * Warum das noetig ist: check-betrieb.mjs prueft die Sperre gegen eine
 * Attrappe, in der ICH die Semantik hingeschrieben habe. Der Test bestaetigt
 * damit meine Annahme, nicht Postgres. Was er prinzipiell nicht zeigen kann:
 *
 *  - dass ein Advisory Lock an der SITZUNG haengt und nicht an der Transaktion
 *  - dass zwei getrennte Verbindungen sich tatsaechlich gegenseitig sehen
 *  - dass die Sperre beim Verbindungsabbruch wirklich faellt
 *  - dass ON CONFLICT DO UPDATE beim Tagesbudget so aufaddiert, wie gedacht
 *  - dass die Versandsperre nach ihrem Fenster WIRKLICH wieder aufgeht
 *
 * Genau diese vier Dinge tragen die Autonomie: ohne sie laufen zwei
 * Hintergrundlaeufe gleichzeitig oder die Autonomie nie wieder an.
 *
 * Startet sich seinen eigenen Server (bench/integration/pg-start.sh), damit
 * nichts von einer laufenden Datenbank abhaengt.
 */
import pg from "pg";

export const name = "Integration: Postgres";

const URL_ = process.env.BENCH_DATABASE_URL;

export async function lauf() {
  if (!URL_) {
    return { uebersprungen: true, grund: "BENCH_DATABASE_URL nicht gesetzt — Integrationslauf ausgelassen" };
  }

  const faelle = [];
  const p = (id, beschreibung, ok, hinweis = "") =>
    faelle.push({ id, beschreibung, ergebnis: ok ? "PASS" : "FAIL", hinweis });

  const SCHLUESSEL = 815_001;

  // ── 1. Zwei echte Verbindungen, eine Sperre ────────────────────────────
  const a = new pg.Client({ connectionString: URL_ });
  const b = new pg.Client({ connectionString: URL_ });
  await a.connect();
  await b.connect();

  const holt = async (c) => (await c.query("SELECT pg_try_advisory_lock($1) AS ok", [SCHLUESSEL])).rows[0].ok;

  p("pg:erste-bekommt", "die erste Verbindung bekommt die Sperre", (await holt(a)) === true);
  p("pg:zweite-blockiert", "die zweite bekommt sie NICHT", (await holt(b)) === false);

  /*
   * Der Fall, den die Attrappe nie zeigen könnte: dieselbe Verbindung bekommt
   * die Sperre ein zweites Mal (Postgres zählt pro Sitzung mit). Das heißt,
   * ein doppeltes Entsperren wäre nötig — gut zu wissen, bevor jemand
   * mitSperre() verschachtelt.
   */
  p("pg:reentrant", "dieselbe Verbindung bekommt sie erneut (Postgres zählt mit)", (await holt(a)) === true);
  await a.query("SELECT pg_advisory_unlock($1)", [SCHLUESSEL]);
  p("pg:noch-gehalten", "nach EINEM Entsperren hält die Sperre noch", (await holt(b)) === false);
  await a.query("SELECT pg_advisory_unlock($1)", [SCHLUESSEL]);
  p("pg:jetzt-frei", "nach dem zweiten ist sie frei", (await holt(b)) === true);
  await b.query("SELECT pg_advisory_unlock($1)", [SCHLUESSEL]);

  // ── 2. Verbindungsabbruch gibt die Sperre frei ─────────────────────────
  const c = new pg.Client({ connectionString: URL_ });
  await c.connect();
  await holt(c);
  await c.end(); // wie ein abgestürzter Prozess
  await new Promise((r) => setTimeout(r, 200));
  const nachAbbruch = await holt(a);
  p("pg:abbruch-gibt-frei", "nach dem Verbindungsende ist die Sperre frei — die Autonomie läuft wieder an", nachAbbruch === true);
  if (nachAbbruch) await a.query("SELECT pg_advisory_unlock($1)", [SCHLUESSEL]);

  // ── 3. Advisory Locks sind SITZUNGSweit, nicht transaktionsweit ────────
  /*
   * Der Grund, warum lauf-sperre.ts eine eigene Verbindung nimmt und nicht
   * eine aus dem Pool: aus einem Pool bekäme der nächste Aufrufer dieselbe
   * Sitzung samt Sperre. Hier wird belegt, dass die Sperre eine
   * Transaktion überdauert.
   */
  await a.query("BEGIN");
  await holt(a);
  await a.query("COMMIT");
  p("pg:sitzungsweit", "die Sperre überlebt COMMIT — sie hängt an der Sitzung", (await holt(b)) === false);
  await a.query("SELECT pg_advisory_unlock($1)", [SCHLUESSEL]);

  // ── 4. ON CONFLICT DO UPDATE addiert wirklich auf ──────────────────────
  await a.query(`
    CREATE TABLE IF NOT EXISTS bench_tageskosten (
      id serial PRIMARY KEY, tag text NOT NULL, provider text NOT NULL, model text NOT NULL,
      aufrufe integer NOT NULL DEFAULT 0, rein integer NOT NULL DEFAULT 0,
      CONSTRAINT bench_tk_uniq UNIQUE (tag, provider, model))`);
  await a.query("TRUNCATE bench_tageskosten");
  const buche = (client, rein) =>
    client.query(
      `INSERT INTO bench_tageskosten (tag, provider, model, aufrufe, rein) VALUES ('t','openai','m',1,$1)
       ON CONFLICT (tag, provider, model) DO UPDATE SET aufrufe = bench_tageskosten.aufrufe + 1, rein = bench_tageskosten.rein + $1`,
      [rein],
    );
  // Gleichzeitig aus ZWEI Verbindungen — genau der Fall, den ein
  // Lesen-Rechnen-Schreiben verlieren würde.
  await Promise.all([buche(a, 100), buche(b, 50), buche(a, 25), buche(b, 25)]);
  const { rows } = await a.query("SELECT aufrufe, rein FROM bench_tageskosten");
  p(
    "pg:aufaddieren",
    "vier gleichzeitige Buchungen gehen nicht verloren",
    rows[0]?.aufrufe === 4 && rows[0]?.rein === 200,
    `aufrufe=${rows[0]?.aufrufe}, rein=${rows[0]?.rein}`,
  );
  await a.query("DROP TABLE bench_tageskosten");

  // ── 5. Die Versandsperre laeuft ab — und zwar wirklich ─────────────────
  /*
   * DIE ZUSAGE: "Dieselbe Mail wird zehn Minuten lang nicht zweimal
   * geschickt." Zwei Haelften, und nur die erste war geprueft.
   *
   * Der Fehler, der dadurch durchrutschte: der eindeutige Index geht ueber
   * (art, fingerabdruck) — OHNE Zeit. Der Lesepfad beachtete das Fenster,
   * der Schreibpfad konnte danach aber nie wieder einfuegen. Die Sperre galt
   * damit nicht zehn Minuten, sondern fuer immer: dieselbe Mail zwanzig
   * Minuten spaeter ging nie raus.
   *
   * Geprueft wird gegen ECHTES Postgres, weil genau das an der Datenbank
   * haengt: am Index, am Fehlercode 23505, und daran, dass ein bedingtes
   * UPDATE atomar genau einen Gewinner hat. Eine Attrappe wuerde hier meine
   * Annahme bestaetigen und nicht Postgres.
   */
  await a.query(`
    CREATE TABLE IF NOT EXISTS bench_versand (
      id serial PRIMARY KEY, art text NOT NULL, fingerabdruck text NOT NULL,
      ergebnis text NOT NULL DEFAULT '', erledigt boolean NOT NULL DEFAULT false,
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT bench_versand_uniq UNIQUE (art, fingerabdruck))`);
  await a.query("TRUNCATE bench_versand");

  /* Der Einfuegeversuch IST die Reservierung. */
  const reserviere = async (client) => {
    try {
      await client.query(
        "INSERT INTO bench_versand (art, fingerabdruck, ergebnis, erledigt) VALUES ('email','abc','',false)",
      );
      return { gewonnen: true, konflikt: false };
    } catch (err) {
      return { gewonnen: false, konflikt: err.code === "23505" };
    }
  };

  /* Und die Uebernahme einer ABGELAUFENEN Zeile ist ein bedingtes UPDATE. */
  const uebernimm = async (client, fensterMs) =>
    (
      await client.query(
        `UPDATE bench_versand SET ergebnis = '', erledigt = false, created_at = now()
          WHERE art = 'email' AND fingerabdruck = 'abc'
            AND created_at < now() - ($1::int * interval '1 millisecond')
        RETURNING id`,
        [fensterMs],
      )
    ).rowCount;

  const erste = await reserviere(a);
  p("pg:sperre-erste", "die erste Reservierung geht durch", erste.gewonnen === true);

  const zweite = await reserviere(b);
  p(
    "pg:sperre-zweite",
    "die zweite laeuft in den eindeutigen Index — und zwar mit Code 23505",
    zweite.gewonnen === false && zweite.konflikt === true,
    `code-erkannt=${zweite.konflikt}`,
  );

  /* Noch INNERHALB des Fensters: die Uebernahme darf NICHT greifen. */
  p(
    "pg:sperre-haelt",
    "innerhalb des Fensters bleibt sie gesperrt",
    (await uebernimm(a, 600_000)) === 0,
  );

  /*
   * Jetzt elf Minuten vorspulen — durch Zurueckdatieren der Zeile, nicht
   * durch Warten. Das ist derselbe Zustand, den elf echte Minuten erzeugen.
   */
  await a.query("UPDATE bench_versand SET created_at = now() - interval '11 minutes'");
  p(
    "pg:sperre-laeuft-ab",
    "nach elf Minuten darf dieselbe Mail wieder raus — DAS war der Fehler",
    (await uebernimm(a, 600_000)) === 1,
  );

  /*
   * Und die Uebernahme muss GENAU EINEN Gewinner haben. Sonst waere das
   * Ablaufen erkauft mit dem Rennen, gegen das die Sperre ueberhaupt da ist.
   */
  await a.query("UPDATE bench_versand SET created_at = now() - interval '11 minutes'");
  const beide = await Promise.all([uebernimm(a, 600_000), uebernimm(b, 600_000)]);
  p(
    "pg:sperre-ein-gewinner",
    "zwei gleichzeitige Uebernahmen — nur eine gewinnt",
    beide[0] + beide[1] === 1,
    `a=${beide[0]}, b=${beide[1]}`,
  );

  await a.query("DROP TABLE bench_versand");

  await a.end();
  await b.end();

  const PASS = faelle.filter((f) => f.ergebnis === "PASS").length;
  return { gesamt: faelle.length, PASS, PARTIAL: 0, FAIL: faelle.length - PASS, UNSAFE: 0, faelle };
}
