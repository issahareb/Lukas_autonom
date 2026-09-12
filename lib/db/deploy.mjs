/*
 * Der Schema-Schritt beim Deploy: Basislinie setzen, dann migrieren.
 *
 * WARUM ES DIESES SKRIPT GIBT. Bis hierher lief der Deploy auf `db:push`:
 * drizzle vergleicht Schema und Datenbank und gleicht an — ohne Verlauf, ohne
 * Zurueck, ohne Datei, die jemand vorher liest. Der Umstieg auf Migrationen
 * scheiterte an einem einzigen Schritt: `0000` enthaelt `CREATE TABLE` ohne
 * `IF NOT EXISTS` und wuerde auf der bestehenden Datenbank, wo alles schon
 * steht, sofort scheitern.
 *
 * Der Ausweg ist nicht, `0000` umzuschreiben — die Datei soll genau das
 * bleiben, was sie auf einer leeren Datenbank tut. Der Ausweg ist, die
 * bestehende Datenbank EINMAL als "ist schon auf diesem Stand" zu markieren.
 * Danach laeuft alles Weitere normal durch.
 *
 * WARUM ALLE EINTRAEGE, NICHT NUR `0000`. `push` gleicht die Datenbank an das
 * AKTUELLE Schema an — also an den Stand, den die JUENGSTE Migration
 * beschreibt. Wer `generate` laufen liess und danach `push`, hat deren
 * Aenderungen bereits in der Datenbank. Nur `0000` zu markieren wuerde diese
 * Migrationen erneut anwenden und auf bereits existierende Spalten laufen.
 *
 * DREI ZUSTAENDE, EINE ENTSCHEIDUNG:
 *
 *   Journal hat Zeilen        -> schon uebernommen, nur migrieren.
 *   Journal leer + Tabellen   -> bestehende Datenbank: Basislinie, dann
 *                                migrieren (ab der naechsten neuen Migration).
 *   Journal leer + leer       -> frische Datenbank: normal migrieren, `0000`
 *                                legt alles an.
 *
 * Das Skript ist damit in allen drei Faellen dasselbe und mehrfach
 * ausfuehrbar — wichtig, weil ein Deploy auch mal zweimal laeuft.
 *
 * WAS ES NICHT TUT. Es fasst kein Schema an und legt keine Tabelle an. Es
 * schreibt ausschliesslich in `drizzle.__drizzle_migrations` und ruft danach
 * `drizzle-kit migrate` auf. Schlaegt irgendetwas fehl, endet es mit einem
 * Code ungleich null — der Server startet dann nicht.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import pg from "pg";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONEN = path.join(HIER, "migrations");

/*
 * Tabellennamen, an denen eine bestehende Installation erkannt wird.
 *
 * Bewusst dieselben Praefixe wie `tablesFilter` in der drizzle-Konfiguration:
 * auf einer geteilten Datenbank (Railway-Postgres einer Webseite) duerfen
 * fremde Tabellen weder das Ergebnis beeinflussen noch angefasst werden.
 */
const EIGENE_TABELLEN = "(table_name LIKE 'lukas\\_%' OR table_name IN ('trades','bankroll_history'))";

/*
 * Genau der Hash, den drizzle selbst bildet: sha256 ueber den vollstaendigen
 * Dateiinhalt (drizzle-orm/migrator.js). Weicht er ab, haelt drizzle die
 * Migration fuer eine andere und spielt sie erneut ein.
 */
function journalEintraege() {
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONEN, "meta/_journal.json"), "utf8"));
  return journal.entries.map((e) => {
    const sql = fs.readFileSync(path.join(MIGRATIONEN, `${e.tag}.sql`), "utf8");
    return { tag: e.tag, when: e.when, hash: crypto.createHash("sha256").update(sql).digest("hex") };
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("FEHLER — DATABASE_URL fehlt.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // Dieselbe Anlage wie drizzle sie vornimmt — gleiche Namen, gleiche
    // Spalten. Beides IF NOT EXISTS, also unschaedlich wenn es schon steht.
    await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
    await client.query(
      'CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" ' +
        "(id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)",
    );

    const { rows: journalZeilen } = await client.query(
      'SELECT count(*)::int AS anzahl FROM "drizzle"."__drizzle_migrations"',
    );
    const schonUebernommen = journalZeilen[0].anzahl > 0;

    const { rows: tabellenZeilen } = await client.query(
      `SELECT count(*)::int AS anzahl FROM information_schema.tables
         WHERE table_schema = 'public' AND ${EIGENE_TABELLEN}`,
    );
    const bestehendeInstallation = tabellenZeilen[0].anzahl > 0;

    if (schonUebernommen) {
      console.log(`Schema: Migrationen bereits uebernommen (${journalZeilen[0].anzahl} im Journal).`);
    } else if (!bestehendeInstallation) {
      console.log("Schema: frische Datenbank — die Migrationen legen alles an.");
    } else {
      const eintraege = journalEintraege();
      // Eine Transaktion: entweder steht die ganze Basislinie, oder keine.
      // Eine halbe waere schlimmer als keine — dann liefe ein Teil erneut.
      await client.query("BEGIN");
      try {
        for (const e of eintraege) {
          await client.query(
            'INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ($1,$2)',
            [e.hash, e.when],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
      console.log(
        `Schema: bestehende Datenbank (${tabellenZeilen[0].anzahl} eigene Tabellen) als Basislinie ` +
          `markiert — ${eintraege.length} Migration(en) gelten als angewendet, ohne ausgefuehrt zu werden.`,
      );
    }
  } finally {
    await client.end();
  }

  // Erst jetzt migrieren. Auf einer frischen Datenbank laeuft alles, auf einer
  // uebernommenen nur, was nach der Basislinie dazukam.
  const lauf = spawnSync("npx", ["drizzle-kit", "migrate", "--config", path.join(HIER, "drizzle.config.ts")], {
    stdio: "inherit",
    cwd: HIER,
  });
  process.exit(lauf.status ?? 1);
}

main().catch((err) => {
  console.error("FEHLER — Schema-Schritt abgebrochen:", err.message);
  process.exit(1);
});
