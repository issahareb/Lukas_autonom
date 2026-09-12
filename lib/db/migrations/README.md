# Migrationen

Bis hierher lief das Schema über `db:push`: drizzle vergleicht Schema und
Datenbank und gleicht an. Bequem beim Entwickeln — aber ohne Verlauf, ohne
Zurück und ohne Datei, die jemand vorher liest. Eine versehentlich
zerstörende Änderung fällt erst im Betrieb auf.

```bash
npm run db:generate   # Schemaänderung → nummerierte SQL-Datei hier
npm run db:migrate    # offene Migrationen der Reihe nach einspielen
```

`migrate` merkt sich in `drizzle.__drizzle_migrations`, was schon lief.
Geprüft: auf einer frischen Datenbank entstehen daraus alle 26 `lukas_*`
Tabellen (`bench/integration`).

## Der Umstieg auf der bestehenden Datenbank

**`0000` darf dort nicht einfach laufen.** Die Datei enthält `CREATE TABLE`
ohne `IF NOT EXISTS` — auf einer Datenbank, wo alles schon steht, scheitert
sie. Das ist nachgestellt und bestätigt: nacktes `drizzle-kit migrate` gegen
eine per `push` aufgebaute Datenbank endet mit Code 1.

`0000` wird deshalb **nicht umgeschrieben** — die Datei soll genau das bleiben,
was sie auf einer leeren Datenbank tut. Stattdessen wird die bestehende
Datenbank einmalig als „ist schon auf diesem Stand" markiert. Das erledigt
`npm run db:deploy` (`lib/db/deploy.mjs`) von selbst, es gibt keinen manuellen
Schritt mehr:

| Zustand | Was passiert |
|---|---|
| Journal hat Zeilen | schon übernommen — nur migrieren |
| Journal leer, eigene Tabellen vorhanden | Basislinie eintragen, dann migrieren |
| Journal leer, keine Tabellen | frische Datenbank — alles läuft normal |

Markiert werden **alle** Einträge des Journals, nicht nur `0000`: `push` gleicht
die Datenbank an das *aktuelle* Schema an, also an den Stand der jüngsten
Migration. Nur `0000` zu markieren würde die übrigen erneut anwenden.

Der Eintrag geht in einer Transaktion raus — eine halbe Basislinie wäre
schlimmer als keine.

### Was geprüft ist

Gegen ein echtes Postgres 16, nicht gegen eine Attrappe:

- frische Datenbank → 26 `lukas_*`-Tabellen, ein Journal-Eintrag
- per `push` aufgebaute Datenbank → Basislinie gesetzt, Tabellen unberührt,
  `created_at` deckt sich mit `meta/_journal.json`
- zweiter Lauf → erkennt die Übernahme, ändert nichts (Deploys laufen auch mal doppelt)
- **neue Migration nach der Basislinie** → wird angewendet, Journal wächst;
  die Basislinie blockiert künftige Änderungen also nicht
- mehrere Einträge im Journal bei der Übernahme → alle markiert
- ohne `DATABASE_URL` → Code 1, der Server startet nicht

`start:deploy` ruft `db:deploy` statt `db:push`. Die Eigenschaft von vorher
bleibt: schlägt der Schema-Schritt fehl, startet der Server **nicht** — sonst
liefe er gegen ein Schema, das nicht zum Code passt, und die Fehler tauchten
verstreut in den Logs auf statt beim Deployment.
