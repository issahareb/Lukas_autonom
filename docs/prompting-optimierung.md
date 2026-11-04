# LUKAS: Werkzeug- und Kontextoptimierung, 4. November 2026

Vergleichsbasis: `0f7e3a0` auf `main`. LUKAS nutzt weiterhin seine bestehende
OpenAI-Anbindung und Modellwahl. Anthropics
[Prompting-Empfehlungen](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
dienen als Architekturquelle; es wurde kein Anbieterwechsel eingebaut.

## Implementierung

- Dashboard und `runLukasTurn` verwenden dieselbe Fortsetzungsregel für
  Modellwahl, Tool-Auswahl und Promptmodule. Neue Themen erben keine
  Werkzeuge des letzten Auftrags. „Weiter“ behält den ursprünglichen Auftrag.
  Das Kontextziel richtet sich ebenfalls nach diesem aktiven Auftrag.
- Kein vollständiger Katalog bei fehlendem Aufgabenparameter. Der Grundumfang
  besteht aus `mcp_find_tool` und `mcp_call`. Einfache Begrüßungen brauchen keine
  Tools und keinen zusätzlichen Journalzugriff. Fachmodule kommen nach Bedarf
  hinzu; beispielsweise bekommt eine Postfachabfrage kein Versandwerkzeug.
- Discovery lädt bis zu acht vollständige weitere Definitionen pro Zug nach.
  Explizite Werkzeuglisten von Unteragenten und öffentliche Gesprächsgrenzen
  werden nicht erweitert. Nach Zugangsfehlern gesperrte Tools werden nicht
  durch Discovery wieder aktiviert. MCP-Risikostufen werden weiter geladen;
  die bestehenden Policy-Gates bleiben im Dispatcher.
- Unabhängige, geprüfte Lesezugriffe laufen mit standardmäßig vier parallelen
  Aufrufen. Ergebnisse behalten die Zuordnung und Reihenfolge der Modellaufrufe.
  Schreibaktionen, Shell, Browserbedienung, unbekannte Tools und MCP-Aufrufe
  bilden sequenzielle Grenzen. Auch `email_read` bleibt geordnet, weil es die
  Herkunft von Mail-Links für spätere Freigabeprüfungen vermerkt.
- Modulare Prompts enthalten kurze XML-Blöcke für Tool-Ausführung sowie
  passende Code-/Telefonbeispiele. Vorhandene OpenAI-Denkstufen, Caching,
  Ergebnisverdichtung und Gedächtnisabrufe werden weiterverwendet.
- `lukas_arbeitsfortschritt` speichert den aktuellen privaten Auftrag und seine
  tatsächlichen Tool-Schritte. Planung und Start werden vor der Aktion
  bestätigt gespeichert, Ergebnisse danach. Eine Sitzungssperre verhindert
  gleichzeitige Bearbeitung desselben Journalbereichs über mehrere Prozesse.
  „Weiter“ lädt begrenzte Belege nach. Ein nach einem Absturz unklarer Schritt
  wird `uncertain`, ohne gespeicherte Aktionen automatisch erneut auszuführen.
  Eine Toolantwort heißt `returned`, eine formulierte Antwort `answered`:
  keiner dieser Zustände behauptet fachlichen Aufgabenerfolg.
  Chat-Journale sind per Fremdschlüssel gebunden und werden beim Löschen des
  Chats mitgelöscht; ein laufender Zug kann sie danach nicht neu anlegen.
- Das Journal gilt für Owner-Chats und autonome Läufe. Explizite fremde
  Systemprompts erhalten keinen privaten Journalinhalt. Einfache Smalltalkzüge
  umgehen es. Die neue versionierte Migration gehört vor den Serverstart.
  `LUKAS_WORK_PROGRESS=false` deaktiviert das Journal;
  `LUKAS_TOOL_CONCURRENCY=1` deaktiviert parallele Tool-Ausführung.

## Messungen und Grenzen

`npm run bench:tools -w @workspace/api-server` baut den bisherigen und den neuen
Auswahlpfad aus den echten Quelldateien. Beide verwenden identische eingebaute
Schemas und die tatsächliche OpenAI-Responses-Serialisierung. Es werden zwölf
unterschiedliche Aufgaben untersucht. Alle Ergebnisse stehen in
[tool-routing-results.json](tool-routing-results.json).

Die dort angegebene prozentuale Verringerung bezieht sich auf die Summe der
serialisierten UTF-8-Bytes in diesen gleichgewichteten Fällen, nicht auf die
Häufigkeitsverteilung produktiver Anfragen. Der Fall ohne Aufgabenparameter
wird gesondert ausgewiesen, weil er vorher den gesamten Katalog lieferte.
Schemas können Tokens sparen; aus Bytezahlen folgt aber keine identische
Token-, Kosten- oder Latenzersparnis. Die gemessene lokale Auswahl- und
Serialisierungszeit ist keine Live-Antwortzeit.

Die bestehende Verbrauchserfassung speichert bereits Anbieter-Tokens,
Cacheanteile und Dauer pro Modellaufruf. Für OpenAI werden jetzt zusätzlich
Toolanzahl, Schema-Zeichen und UTF-8-Bytes nach der tatsächlichen
Responses-Serialisierung erfasst. Tool- oder Promptinhalte werden dabei nicht
in die Telemetrie geschrieben.

`npm run bench:tools:live -w @workspace/api-server -- --allow-paid` ist ein
separater, begrenzter OpenAI-Vergleich mit drei Wiederholungen pro Fall,
wechselnder Ausführungsreihenfolge, berichteten Tokens, Cacheanteilen,
Aufgabenerfolg und Median-Latenz. Tools liefern dabei kontrollierte Testdaten;
Telefonate, Nachrichten und Produktionsänderungen werden nicht ausgeführt.
Kosten aller Versuche fließen in Tokens pro erfolgreicher Aufgabe ein. Ein
Vergleich gilt nur bei vollständigen Paaren mit denselben tatsächlichen
Modellen. Der Lauf startet niemals automatisch in CI.

Lokal ist kein bestehender OpenAI-Zugang konfiguriert. Der Live-Lauf ist deshalb
in [tool-live-results.json](tool-live-results.json) ausdrücklich als übersprungen
vermerkt. Reale Tokenersparnis, produktive Latenz und produktiver Aufgabenerfolg
sind hiermit weiterhin nicht nachgewiesen. Es wurden keine Zugangsdaten geändert.

## Verifikation

Die Regressionen prüfen beide echten Einstiegspunkte, Themenwechsel,
Fortsetzungen, Discovery, parallele Lesezugriffe, Ergebniszuordnung,
Freigaben und private Overrides. Zusätzliche Tests prüfen Schreibgrenzen,
Abbruchverhalten, Wiederaufnahme, unbekannte Aktionsausgänge,
Journal-Schreibfehler und Quellenbegrenzung.

Der Integrationslauf führt nach den echten Deploy-Migrationen außerdem einen
PostgreSQL-Test mit zwei Prozessen aus: laufende Arbeit sperrt den zweiten
Prozess, SIGKILL gibt die Verbindungssperre frei, und ein neuer Prozess sieht
den unklaren gespeicherten Schritt. Modell- und Telefon-End-to-End-Prüfungen
werden dadurch nicht ersetzt.
