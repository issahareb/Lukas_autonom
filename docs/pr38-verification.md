# Prüfung von PR #38, 5. November 2026

## Geprüfter Stand

- PR: https://github.com/issahareb/Lukas_autonom/pull/38
- Ausgangsstand: `0f7e3a0b599e31f07225219e8a7f75c54a8ca7fa`.
- Letzter PR-Commit: `68953dea39185bd34b98addc23b579f081b6ee0f`.
- Aktuelles `main` bei der Prüfung: `724c7e375ce34142f65a1ab50dc7cefcc03cd508`.
- PR #38 ist seit dem 4. November 2026 um 01:10:48 UTC gemergt, nicht mehr geöffnet.
  `git diff 68953dea 724c7e3` ist leer: PR-Endstand und aktueller Hauptbranch haben denselben Baum.
- Diese Prüfung ändert `main` nicht. Korrekturen liegen auf einem separaten Branch.

## Bestätigte Messungen

Der vorhandene Benchmark wurde zuerst gegen seine mitgelieferte Baseline und nach den
Korrekturen zusätzlich direkt gegen die vollständige ursprüngliche Git-Referenz ausgeführt:

```sh
cd artifacts/api-server
LUKAS_BENCH_BASELINE=0f7e3a0b599e31f07225219e8a7f75c54a8ca7fa \
  node bench/tool-routing.mjs --output=/tmp/lukas-routing-git-baseline.json
```

Die archivierte Baseline enthält extrahierte Deklarationen statt der vollständigen
`lukas-tools.ts`. Der zusätzliche Lauf mit der langen SHA umgeht dieses Archiv
und liest die Originaldateien mit `git show`. Beide Läufe liefern dieselben Größen.
Die verwendeten eingebauten Schemas werden im Test per `deepEqual` verglichen.

| Vergleich | Vorher | Nachher | Verringerung |
| --- | ---: | ---: | ---: |
| 12 gleichgewichtete Fälle, Schema-Bytes | 127.360 | 30.991 | 75,6666 % |
| 11 Fälle mit konkreter Aufgabe, Schema-Bytes | 95.506 | 29.588 | 69,0197 % |
| Website-Anfragen, Definitionen | 11 | 3 | 8 weniger |
| Fehlender Aufgabenparameter, Definitionen | 42 | 2 | 40 weniger |

Alle zwölf benötigten Schemaauswahlen bestehen. Die Messung nutzt die echte
OpenAI-Responses-Serialisierung, aber simuliert den Provider. Die zwei Bytes `[]`
beim werkzeugfreien Fall gehören zur Benchmark-Zählweise; die Telemetrie zählt
beim ausgelassenen Toolfeld null Bytes. Das berührt die berichtete Größenordnung
nicht, ist aber beim Abgleich mit Produktions-Telemetrie zu berücksichtigen.

Nicht bestätigt sind bezahlte Tokens, Euro-Kosten, Cachegewinn, tatsächlicher
Modellerfolg oder produktive Antwortzeit. Der Fallmix ist keine produktive
Häufigkeitsverteilung. Es wurden keine bezahlten Modellaufrufe oder Telefonate
für diese Prüfung gestartet. Der vorhandene Live-Bericht meldet einen übersprungenen
Lauf und liefert keinen Produktionsnachweis.

## Zwei nachgewiesene Probleme und Korrekturen

### Wiederaufnahme wählt das falsche Modellprofil

Bei einer Fortsetzung mit leerem Gesprächsverlauf, aber vorhandenem Arbeitsjournal
wurden Tools und Promptmodule aus dem gespeicherten Codeauftrag geladen. Die
Modellwahl erhielt dagegen nur `weiter` und keinen früheren Auftrag und wählte
`fast` statt `code`. Der neue Test gegen die echte Dashboard-Route schlug mit
`'fast' !== 'code'` fehl.

Dashboard und `runLukasTurn` übergeben jetzt den bereits aufgelösten `routingTask`
als Fortsetzungsauftrag an den Modellrouter. Auch der Abschlussaufruf der
zentralen Schleife nutzt diesen Auftrag. Explizite Profilvorgaben bleiben erhalten.
Der neue Test besteht für beide Einstiegspunkte mit Journal und ohne History.

### Discovery reaktiviert zuvor ausgelassene Zugangsgeschwister

Bei `Lies mein E-Mail-Postfach` wurde `email_send` anfangs korrekt ausgelassen.
Nach `EMAIL_USER fehlt` speicherten die Schleifen aber nur die Namen der gerade
angebotenen und entfernten Schemas in ihrer Sperrliste. Eine anschließende
Discovery konnte daher `email_send` neu als Schema aufnehmen. Der neue Test
reproduzierte dies in der echten Dashboard-Schleife.

Die Zugangssperre liefert jetzt die vollständige betroffene Werkzeuggruppe,
auch für anfangs ausgelassene Mail-/SSH-Werkzeuge. Beide Schleifen verwenden
diese Namen beim Zusammenführen entdeckter Schemas. Die bestehende Ausnahme
für einen unabhängig konfigurierten Browser bleibt erhalten. Neue Tests
bestehen für beide Einstiegspunkte. Diese Änderung betrifft Schema-Promotion;
sie ersetzt keine Zugangskontrolle im Dispatcher und behauptet keinen neuen
Dispatcher-weiten Ausführungsblock.

## Ausgeführte Prüfungen

Lokale Umgebung: Node `24.22.1`, npm `11.9.0`, Installation aus dem Lockfile mit
`npm ci --no-audit --no-fund`. Die vorhandene GitHub-CI verwendet Node 22.

| Prüfung | Ergebnis und Grenze |
| --- | --- |
| `npm run typecheck` auf unverändertem Merge | Exit 0; Bibliotheken, API, vorhandene Regressionen und 131 UI-Tests aus 22 Dateien bestanden |
| `npm run typecheck` mit Korrekturen | Exit 0; einschließlich der neuen Tests in `check-chat-access.mjs` und erneut 131 UI-Tests |
| `npm run build --workspaces --if-present` | Exit 0; API, Dashboard, Landingpage und Mockup gebaut; vorhandene Vite-Warnungen zu großen Chunks |
| `node scripts/check-chat-access.mjs` | Echte HTTP-/Brain-Schleifen; Routing, Themenwechsel, Discovery, parallele Reads und Ergebnisreihenfolge; neue Fehlerfälle bestanden |
| `check-tool-batch.mjs`, `check-work-progress.mjs` innerhalb der API-Suite | Bounded Reads, Schreibgrenzen, Stop/Abort, Abwarten laufender Geschwister; Journal vor Dispatch, Unsicherheit, Quellenbegrenzung, Sperre und Fehlerfälle bestanden |
| `npm run bench:offline` | Exit 0; 97,2/100 auf 57 von 100 gemessenen Gewichtspunkten; kein vollständiger Erfolgsnachweis |
| Offline-Teilergebnisse | Zwei Gedächtnisfälle nur Rang 2; Technik meldet 29 moderate Abhängigkeiten. Kein durch PR #38 bestätigter neuer Defekt daraus abgeleitet |
| `npm run bench:integration` lokal | Exit 127 vor den Migrationen: `initdb: command not found`; lokales echtes PostgreSQL nicht verfügbar |
| `python3 -m compileall -q vps/` und `python3 vps/check-requirements.py` | Exit 0; bestehende Hinweise auf optionale, nur auf dem Server vorhandene Module |
| `git diff --check` | Bestanden |

Der ursprüngliche CI-Lauf am letzten PR-Commit wurde einschließlich der Joblogs
geprüft: https://github.com/issahareb/Lukas_autonom/actions/runs/41751816145

Dort sind Neuinstallation/Upgrade der Migrationen, echtes Telefon-Gedächtnis und
der PostgreSQL-/Browser-Integrationslauf erfolgreich. Das Log bestätigt ausdrücklich
`PASS PostgreSQL work progress`: deploytes Schema, Zwei-Prozess-Sperre,
SIGKILL-Freigabe und persistierter unklarer Schritt nach Prozessneustart.
Das ist ein vorhandener CI-Nachweis am Originalstand, kein erneut lokal erzieltes
SQL-Ergebnis für die Korrekturen. Der ebenfalls erfolgreiche Routing-CI-Lauf ist
https://github.com/issahareb/Lukas_autonom/actions/runs/41751816116 .
Das bisherige automatische Code-Review bezog sich nur auf `334d36b`, nicht auf
den letzten PR-Commit; es ersetzt diese Prüfung nicht.

## Aufrufpfade und verbleibende Integrationsrisiken

| Bereich | Bestätigt im Code / in Regressionen | Verbleibende Grenze oder Risiko |
| --- | --- | --- |
| Modellrouting | Dashboard und zentrale Schleife nutzen bestehende Profile und Fallbacks; Journal-Fortsetzung jetzt konsistent; explizite Profile und Vision bleiben aktiv | Modellverfügbarkeit und tatsächliche Aufgabenqualität wurden nicht live gemessen. Zusätzliche Discovery-Runden können Zeit und Tokens kosten |
| Freigaben | `executeLukasTool` löst eingebaute `mcp_call`-Aliase rekursiv auf und prüft die kanonische Werkzeug-Policy mit unverändertem Kontext. MCP-Risikostufen werden beim Katalogladen aktualisiert; Policy-/Consent-Regressionen bestehen | Kleinere Schemalisten sind keine Berechtigungsgrenze. `mcp_call` bleibt ein generischer Dispatcher; serverseitige Freigaben und Kontaktprüfungen bleiben nötig. Explizite Tools werden nicht automatisch durch Schema-Discovery erweitert |
| Lese-Batches | Nur die feste Allowlist darf überlappen, standardmäßig vier und maximal acht. Ergebnisse bleiben in Modellreihenfolge. `email_read`, Browser, Shell, Versand, Anruf, unbekannte Tools und MCP-Aufrufe bilden Grenzen | Nur bereits vom Modell zusammen angeforderte Reads profitieren; keine automatische Zerlegung abhängiger Aufgaben. Die Klassifizierung muss bei Änderungen an Werkzeug-Nebeneffekten gepflegt werden |
| Telefonie | Auswahl für Anruf, Rückrufstatus, Planung und Stornierung geprüft. `ruf_an` erreicht weiter `starteAnruf`, Kontakt-/Anrufberechtigung und bestehende Owner-Grants; Schreibpfade werden nicht parallelisiert | Kein Live-Telnyx-/SIP-Nachweis. Die Live-Session nutzt `systemPromptOverride` und bekommt absichtlich kein privates Arbeitsjournal. Haltbarkeit über Telefon-Prozessabstürze folgt daraus nicht |
| Wiederaufnahme | Dashboard und private Brain-Konversationen sowie `autonomie` erreichen `withWorkProgress`. Planung/Start werden vor Dispatch gespeichert, `started` wird nach Neustart `uncertain`; kein direkter automatischer Replay. Conversation-FK löscht Journal mit Chat | `returned`/`answered` belegen keinen fachlichen Erfolg. Das Modell muss externe Statusbelege prüfen; der Journalcode garantiert keine genau einmal ausgeführte externe Aktion |
| Betrieb | Versionierte Migration 0012; `start:deploy` führt `db:deploy` vor API-Start aus. SQL-CI am Originalstand erfolgreich | Fehlende Tabelle oder ausgefallene Journal-DB blockiert private Arbeitszüge mit aktivem Journal. Pro aktivem Scope wird eine zusätzliche PostgreSQL-Verbindung gehalten; keine Produktionslastmessung |

Die Schalter `LUKAS_TOOL_CONCURRENCY=1` und `LUKAS_WORK_PROGRESS=false` sind vorhanden.
Es wurden keine Produktionskonfigurationen, Zugangsdaten oder Hauptbranch-Refs geändert.
