# PR #36: Integration und Produktionsabnahme am 01.11.2026

## Geprüfte Ausgangslage

- PR: https://github.com/issahareb/Lukas_autonom/pull/36
- PR-Kopf vor dieser Arbeit: `b51552a8048c12d9080a52f1ba05dd667a50a688`, offen und Draft.
- Hauptbranch und produktiver API/UI-Dienst: `8d6f4838e62bd09dc1ec151950d51a1ac9670771`.
- PR war beim Beginn weder im Hauptbranch noch im produktiven API/UI-Deployment enthalten.
- Railway-Projekt LUKAS: `afbe7fbd-564b-4fbc-b312-92f4fd1450cc`, Umgebung production `505624b8-c017-4017-86b8-52acafc3ee75`.
- API/UI-Dienst `Portfolio_v2`, ID `d5bd758f-8c29-44c0-9297-a9783927975f`: Deployment `536177e1-77a6-4632-9501-bc44bf7bc554`, SUCCESS vom 27.10.2026. Domain https://lukas.issahareb.me.
- Der separate Browserdienst läuft auf `e896e6c`; die Voice-Demo auf `9306411`, Memory-Audit auf eigenem Demo-Branch. Diese Dienste sind keine Belege für einen produktiven Rollout von PR #36.
- Produktions-Healthcheck lieferte vor der Integration HTTP 200; der private Rückrufpfad ohne Anmeldung HTTP 401.

## Integration mit dem aktuellen Hauptbranch

Vier Konflikte wurden inhaltlich zusammengeführt: Backend-Prüfkette, Soul, Werkzeugregistrierung und Werkzeugauswahl. Die unabhängige Railway-Browsersuche, ihre zusätzlichen Suchbegriffe sowie `set_expression` und die aktuelle Roboterbeschreibung bleiben erhalten. Hinzu kommen die dauerhaften Rückrufe und der Anfrageabruf aus PR #36. Es werden keine Anruffreigaben, Kontakte, Anbieter, Stimmen oder Webhook-Schlüssel geändert.

Der bisherige Oberflächenlauf von PR #36 war tatsächlich rot: Im mobilen Browser war der erste Kontakt wegen der vorgeschalteten Rückrufliste zu weit unten. Rückrufe bekommen deshalb einen eigenen Telefon-Tab. Kontakt-, Anruf- und Aufnahmeansicht bleiben erreichbar. Der Browsertest erhält eine explizite leere Rückrufantwort; der bestehende Stornotest nutzt den neuen Tab.

## Testgrenzen und zusätzliche Abnahmefälle

Automatisierte Typ-, Backend-, Sicherheits- und UI-Prüfungen laufen vor einer Freigabe des Hauptbranches. Der endgültige CI-Stand wird im PR mit dem geprüften Commit verknüpft.

Die PostgreSQL-Tests verwenden eine wegwerfbare lokale Datenbank im CI, Migrationen über `db:deploy` und eine simulierte Wählfunktion. Sie prüfen:

- gespeicherten Auftrag, danach abgebrochenes Gesprächssignal, anschließend Ausführung in einem neuen Node-Prozess;
- relative Fälligkeit, keinen Frühstart, konkurrierende Planung und Worker ohne zweiten Wählaufruf;
- erfolgreiche Stornierung vor dem Claim;
- nach dem Claim abgewiesene Stornierung bei gleichzeitigem zweiten Worker;
- vor dem Wählen dauerhaft gespeicherten Status `startet`;
- widerrufene Anruffreigabe und nachträglich geänderte Zielnummer;
- verlorene Anbieterantwort und ausdrücklich unklaren Anbieterstatus ohne automatische Wiederholung;
- verpasste Termine, unterbrochenen Start und sichtbare Ergebnisse.

Die Live-/SIP-Tests simulieren den Modellanbieter. Sie prüfen Owner-Kontext und Werkzeuge nur bei serverseitig bestätigtem Owner. Öffentliche Anrufer, andere private Kontakte, fehlender signierter Kontext, verweigerte Werkzeuge, strenger Modus und ungültige Owner-Konfiguration erhalten keine privaten Owner-Werkzeuge. Authentifizierte Rückrufrouten, Anfrage-Consent, bestehende Telefonie, Aufnahmen, Mithören und Webhook-Signaturen bleiben Teil der Regressionen.

Ein SQL-Commit plus simulierter Wählaufruf ist kein echter Telefonanruf. Das Abbruchsignal stellt Gesprächsende für die Persistenzprüfung nach; es ist kein durch einen Telefonanbieter bestätigtes Auflegen. Die tatsächliche hörbare Modell-/Telefon-Kette ist damit nicht nachgewiesen.

## Produktionsstatus und Nachweise

Dieses Dokument beschreibt den integrierten Prüfstand vor dem Merge. Den anschließend beobachteten Merge-Commit, CI-Lauf und Railway-Rollout mit Deployment-ID hält die aktuelle Beschreibung von PR #36 fest. Ein offener oder geschlossener PR allein ist kein Deploymentnachweis. Maßgeblich sind erfolgreicher Dienstrollout des passenden Commitstands, erfolgreiche Migration, aktiver Rückrufdienst und HTTP-Prüfungen.

Für die echte Telefonabnahme wurde in diesem Auftrag kein ausdrücklich als Testkontakt freigegebener Empfänger benannt. Es wird kein Kundenkontakt als Testziel verwendet und kein echter Testanruf behauptet. Die ausstehende Abnahme lautet: freigegebener Owner ruft an, beauftragt Rückruf, beendet das Gespräch; nach Fälligkeit klingelt ausschließlich der freigegebene Testkontakt und LUKAS ist hörbar. Ein zweiter geplanter Rückruf wird vor Fälligkeit storniert und darf nicht klingeln.

## Betrieb und Rücknahme

Die Migration `0011_green_rhino.sql` ist additiv. Ein Code-Rollback entfernt weder Tabelle noch Aufträge. Der Rückrufworker startet unabhängig von der Pause für unaufgeforderte autonome Arbeit; gespeicherte Benutzeraufträge dürfen daher nicht mit diesem Pausenschalter verwechselt werden. Bei Rücknahme des Codes führt der alte Stand diese Aufträge nicht aus. Vor erneuter Aktivierung den Zustand geplanter und unklarer Aufträge prüfen.

`gestartet` belegt nur den Wählstart, nicht Annahme oder Gesprächserfolg. Nach unklarem Start erfolgt keine automatische Wiederholung. Eine manuelle Neuplanung verlangt vorherige Prüfung des Anbieter-/Anrufstatus. Allgemeine Backendaufträge erhalten durch PR #36 keinen dauerhaften Executor.
