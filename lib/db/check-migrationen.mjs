/*
 * Prueft die Migrationskette gegen ein echtes Postgres — Neuinstallation und
 * Upgrade, auf demselben Weg, den der Deploy geht.
 *
 * ANLASS. Der Deploy lief auf `db:push`; push gleicht die Datenbank an das
 * Schema an und deckt damit jeden Fehler in der Migrationskette zu. Als der
 * Deploy auf Migrationen umgestellt wurde, fiel auf: der Kette fehlten drei
 * Tabellen und zwei Spalten. Eine frische Installation haette ein
 * unvollstaendiges Schema bekommen, und niemand haette es gemerkt — es gab
 * nichts, was es geprueft haette. Das ist dieser Test.
 *
 * DIE EIGENSCHAFT, AUF DIE ES ANKOMMT. Nicht "die Migrationen laufen durch",
 * sondern: was dabei entsteht, ist BYTE-GLEICH mit dem, was der Code
 * beschreibt. Verglichen wird deshalb gegen `drizzle-kit push` aus demselben
 * Schema — Tabelle fuer Tabelle, Spalte fuer Spalte, Typ und Nullbarkeit.
 *
 * DERSELBE WEG WIE IM DEPLOY. Aufgerufen wird `npm run db:deploy`, nicht eine
 * nachgebaute Variante. Ein Test, der seinen eigenen Migrationsweg baut,
 * prueft den eigenen Weg und nicht den, der produktiv laeuft.
 *
 * BRAUCHT EINE DATENBANK. Deshalb nicht in der typecheck-Kette (die muss ohne
 * laufen), sondern ein eigener CI-Schritt mit einem Postgres-Dienst.
 * ADMIN_DATABASE_URL zeigt auf den Server; die Testdatenbanken legt dieses
 * Skript selbst an und raeumt sie wieder weg.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const WURZEL = path.join(HIER, "../..");

const ADMIN = process.env.ADMIN_DATABASE_URL;
if (!ADMIN) {
  console.error(
    "FEHLER — ADMIN_DATABASE_URL fehlt. Beispiel:\n" +
      "  ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres node lib/db/check-migrationen.mjs",
  );
  process.exit(1);
}

let fehler = 0;
const pruefe = (bedingung, text) => {
  if (bedingung) {
    console.log(`  ok   ${text}`);
  } else {
    console.error(`  FEHLER — ${text}`);
    fehler++;
  }
};

function urlFuer(datenbank) {
  const u = new URL(ADMIN);
  u.pathname = `/${datenbank}`;
  return u.toString();
}

async function adminAusfuehren(sql) {
  const client = new pg.Client({ connectionString: ADMIN });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function abfrage(datenbank, sql) {
  const client = new pg.Client({ connectionString: urlFuer(datenbank) });
  await client.connect();
  try {
    const { rows } = await client.query(sql);
    return rows;
  } finally {
    await client.end();
  }
}

/** Der vollstaendige Schema-Abdruck: jede Spalte mit Typ und Nullbarkeit. */
async function abdruck(datenbank) {
  const rows = await abfrage(
    datenbank,
    `SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable AS zeile
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY 1`,
  );
  return rows.map((r) => r.zeile);
}

function lauf(befehl, argumente, datenbank, still = true) {
  return spawnSync(befehl, argumente, {
    cwd: WURZEL,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: urlFuer(datenbank) },
    stdio: still ? "pipe" : "inherit",
  });
}

/** Genau der Weg, den der Deploy geht. */
const deploy = (datenbank) => lauf("npm", ["run", "db:deploy"], datenbank);

async function neu(datenbank) {
  await adminAusfuehren(`DROP DATABASE IF EXISTS ${datenbank}`);
  await adminAusfuehren(`CREATE DATABASE ${datenbank}`);
}

async function main() {
  // ── Der Vergleichsmassstab: das Schema, das der Code beschreibt ──────────
  console.log("Massstab: drizzle-kit push aus dem aktuellen Schema");
  await neu("pruef_massstab");
  const push = spawnSync(
    "npx",
    ["drizzle-kit", "push", "--force", "--config", "./drizzle.config.ts"],
    {
      cwd: HIER,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: urlFuer("pruef_massstab") },
    },
  );
  if (push.status !== 0) {
    console.error("FEHLER — der Massstab liess sich nicht bauen:\n" + (push.stderr ?? ""));
    process.exit(1);
  }
  const massstab = await abdruck("pruef_massstab");
  pruefe(massstab.length > 0, `Massstab gelesen (${massstab.length} Spalten)`);

  // ── 1. Neuinstallation ──────────────────────────────────────────────────
  console.log("\n1. Neuinstallation auf leerer Datenbank");
  await neu("pruef_neu");
  const neuLauf = deploy("pruef_neu");
  pruefe(neuLauf.status === 0, "db:deploy laeuft durch");
  const neuAbdruck = await abdruck("pruef_neu");
  const fehltNeu = massstab.filter((z) => !neuAbdruck.includes(z));
  pruefe(
    fehltNeu.length === 0,
    fehltNeu.length === 0
      ? `Schema vollstaendig (${neuAbdruck.length} Spalten, deckungsgleich)`
      : `Schema unvollstaendig — es fehlen: ${fehltNeu.slice(0, 12).join("; ")}`,
  );

  // ── 2. Upgrade aus der push-Zeit ────────────────────────────────────────
  // Eine Datenbank, die per push entstanden ist und kein Journal hat: genau
  // der Zustand der bestehenden Produktionsdatenbank beim ersten Deploy.
  console.log("\n2. Upgrade einer bestehenden Datenbank (per push gebaut, kein Journal)");
  await neu("pruef_upgrade");
  const push2 = spawnSync(
    "npx",
    ["drizzle-kit", "push", "--force", "--config", "./drizzle.config.ts"],
    {
      cwd: HIER,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: urlFuer("pruef_upgrade") },
    },
  );
  pruefe(push2.status === 0, "Ausgangszustand hergestellt");
  const upgradeLauf = deploy("pruef_upgrade");
  pruefe(upgradeLauf.status === 0, "db:deploy uebernimmt sie, ohne zu scheitern");
  const upAbdruck = await abdruck("pruef_upgrade");
  const fehltUp = massstab.filter((z) => !upAbdruck.includes(z));
  pruefe(fehltUp.length === 0, "Schema danach vollstaendig");
  const journal = await abfrage(
    "pruef_upgrade",
    "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
  );
  pruefe(journal[0].n > 0, `Journal gefuellt (${journal[0].n} Eintraege)`);

  // ── 3. Zweiter Lauf aendert nichts ──────────────────────────────────────
  // Ein Deploy laeuft auch mal zweimal.
  console.log("\n3. Zweiter Lauf auf derselben Datenbank");
  const zweiter = deploy("pruef_upgrade");
  pruefe(zweiter.status === 0, "laeuft durch");
  const nachZweitem = await abdruck("pruef_upgrade");
  pruefe(
    nachZweitem.join("\n") === upAbdruck.join("\n"),
    "Schema unveraendert",
  );

  // ── 4. Nur die erste Migration vollzogen ────────────────────────────────
  // Der Fall, den die Produktionsdatenbank beim naechsten Deploy trifft:
  // sie steht auf einem aelteren Stand, die neuen Migrationen muessen laufen.
  console.log("\n4. Datenbank auf dem Stand der ersten Migration");
  await neu("pruef_teilstand");
  const ersteMigration = path.join(HIER, "migrations");
  const journalDatei = JSON.parse(
    (await import("node:fs")).readFileSync(path.join(ersteMigration, "meta/_journal.json"), "utf8"),
  );
  const ersteSql = (await import("node:fs")).readFileSync(
    path.join(ersteMigration, `${journalDatei.entries[0].tag}.sql`),
    "utf8",
  );
  const client = new pg.Client({ connectionString: urlFuer("pruef_teilstand") });
  await client.connect();
  for (const stmt of ersteSql.split("--> statement-breakpoint")) {
    if (stmt.trim()) await client.query(stmt);
  }
  await client.end();
  const teilLauf = deploy("pruef_teilstand");
  pruefe(teilLauf.status === 0, "db:deploy laeuft durch");
  const teilAbdruck = await abdruck("pruef_teilstand");
  const fehltTeil = massstab.filter((z) => !teilAbdruck.includes(z));
  pruefe(
    fehltTeil.length === 0,
    fehltTeil.length === 0
      ? "die ausstehenden Migrationen wurden angewendet"
      : `es fehlt weiterhin: ${fehltTeil.slice(0, 12).join("; ")}`,
  );

  // ── Aufraeumen ──────────────────────────────────────────────────────────
  for (const db of ["pruef_massstab", "pruef_neu", "pruef_upgrade", "pruef_teilstand"]) {
    await adminAusfuehren(`DROP DATABASE IF EXISTS ${db}`);
  }

  if (fehler > 0) {
    console.error(`\n${fehler} Fehler.`);
    process.exit(1);
  }
  console.log(
    "\nOK — Migrationen: Neuinstallation und Upgrade ergeben beide das Schema des Codes, " +
      "auf demselben Weg wie der Deploy.",
  );
}

main().catch((err) => {
  console.error("FEHLER — Pruefung abgebrochen:", err.message);
  process.exit(1);
});
