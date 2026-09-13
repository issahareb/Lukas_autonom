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

Markiert wird **jede Migration einzeln und nur, wenn sie nachweislich vollzogen
ist**: `deploy.mjs` liest aus jeder Migrationsdatei, welche Tabellen und Spalten
sie anlegt, und prüft sie in der Datenbank nach. Beim ersten Eintrag, der nicht
vollzogen ist, hört es auf — alles ab dort läuft normal.

Das ist wichtiger, als es klingt. Pauschal alle zu markieren war die erste
Fassung und war falsch: eine Datenbank kann auf dem Stand von `0000` stehen,
während `0001` aussteht. Pauschal markiert wäre `0001` **für immer
übersprungen** und die fehlenden Tabellen kämen nie.

Ist eine Migration nur *teilweise* vorhanden, bricht der Schritt ab. Die
Datenbank steht dann auf keinem Stand, den eine Migration beschreibt — das zu
entscheiden ist Handarbeit, automatisch wäre es geraten.

Der Eintrag geht in einer Transaktion raus — eine halbe Basislinie wäre
schlimmer als keine.

### Was geprüft ist

`lib/db/check-migrationen.mjs` läuft in CI gegen ein echtes Postgres 16 und
benutzt **denselben Weg wie der Deploy** (`npm run db:deploy`), nicht einen
nachgebauten. Verglichen wird gegen `drizzle-kit push` aus demselben Schema —
Spalte für Spalte, mit Typ und Nullbarkeit:

1. **Neuinstallation** auf leerer Datenbank → 260 Spalten, deckungsgleich
2. **Upgrade** einer per `push` gebauten Datenbank ohne Journal → übernommen,
   Schema danach vollständig
3. **Zweiter Lauf** → Schema unverändert (Deploys laufen auch mal doppelt)
4. **Datenbank auf dem Stand der ersten Migration** → die ausstehenden
   Migrationen werden angewendet

Gegenprobe: nimmt man `0001` aus dem Journal, wird die Prüfung rot und benennt
die fehlenden Spalten einzeln. Ein Test, der nicht rot werden kann, wäre keiner.

Zusätzlich von Hand nachgestellt: ein **Teilstand** (eine von drei Tabellen
einer Migration vorhanden) — dort bricht `db:deploy` mit einer Begründung ab,
statt zu raten, und ohne `DATABASE_URL` endet es mit Code 1, sodass der Server
nicht startet.

`start:deploy` ruft `db:deploy` statt `db:push`. Die Eigenschaft von vorher
bleibt: schlägt der Schema-Schritt fehl, startet der Server **nicht** — sonst
liefe er gegen ein Schema, das nicht zum Code passt, und die Fehler tauchten
verstreut in den Logs auf statt beim Deployment.
