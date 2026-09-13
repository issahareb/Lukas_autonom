import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  /*
   * Versionierte Migrationen neben `push`.
   *
   * `push` gleicht das Schema an und ist beim Entwickeln bequem — aber es gibt
   * keinen Verlauf, kein Zurueck und keine Datei, die jemand vorher liest. Eine
   * versehentlich zerstoerende Aenderung faellt erst im Betrieb auf.
   *
   * `drizzle-kit generate` schreibt hierher SQL-Dateien mit fortlaufender
   * Nummer und einem Journal. `migrate` spielt sie in Reihenfolge ein und
   * merkt sich in __drizzle_migrations, was schon lief.
   */
  /*
   * RELATIV, nicht absolut — und das ist kein Schoenheitsfehler.
   *
   * Hier stand `path.join(__dirname, "./migrations")`. `migrate` kam damit
   * zurecht, `generate` nicht: es stellt dem Wert ein "./" voran und sucht
   * dann unter `.//home/user/.../meta/0000_snapshot.json` — einem relativen
   * Pfad, den es nie gibt. `generate` brach also jedes Mal ab.
   *
   * Die Folge war nicht nur eine Fehlermeldung: es ist der Grund, warum der
   * Migrationskette drei Tabellen und zwei Spalten fehlten. Wer nichts
   * generieren kann, schiebt die Schemaaenderung eben per `push` nach — und
   * weil `push` funktionierte, fiel es bis zur Umstellung des Deploys nicht
   * auf. Bleibt relativ; die npm-Skripte laufen ohnehin mit diesem Ordner
   * als Arbeitsverzeichnis.
   */
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Sicherheitsnetz für geteilte Datenbanken (z.B. Railway-Postgres einer
  // Webseite): push fasst AUSSCHLIESSLICH diese Tabellen an und schlägt für
  // fremde Tabellen niemals Drops vor.
  tablesFilter: ["lukas_*", "trades", "bankroll_history"],
});
