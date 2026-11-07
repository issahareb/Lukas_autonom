# LUKAS: belegbare Token-Effizienz

Stand der Umsetzung: 7. November 2026. Studienprotokoll Version 2. Noch kein Ergebnis einer bezahlten Testserie und keine bestätigte Produktionsersparnis.

## Fragestellung und bisheriger Befund

Wird derselbe LUKAS bei vergleichbaren, erfolgreich erledigten Aufgaben sparsamer, ohne die Qualität zu verschlechtern? Chat-Coding, Telefonie, öffentliche Website und autonome Hintergrundarbeit sind verschiedene Bereiche. Ein geringerer Gesamtverbrauch bei weniger Nutzung beantwortet diese Frage nicht.

Ein geringerer Gesamtverbrauch kann durch weniger Nutzung entstehen. Öffentliche Testfälle verwenden ausschließlich synthetische Beispielzahlen; reale Messberichte und Ergebnisse gehören nicht in das Repository.

## Daten und Zuordnung

- Persistente Tagesaggregate bleiben erhalten. Zusätzlich erhalten Aufträge Messversion, Aufgabenart, Hash der Eingabe, Deployment-Revision und optional eine vorab definierte Serie/Fall-ID mit Abnahmekriterium.
- Jeder zentrale Modellversuch speichert Auftrag/Root/Unterauftrag, Kanal, Modell/Provider, Routingprofil, Phase, Status, Dauer und disjunkte Eingabe-/Ausgabe-/Cachewerte. Erreichbare Provider-Antwort-IDs, gemeldetes Modell und numerische rohe Usage-Felder bilden den Nachweis. Reasoning bleibt eine Teilmenge der Ausgabe.
- Regeln/Wissen, Dialog, Werkzeugergebnisse und Schemas werden als Kontextgrößen in Zeichen erfasst. Das sind **keine** exakten Tokenanteile. Provider melden nicht für jeden Promptabschnitt einen eigenen Tokenzähler. Solche Anteile werden nicht erfunden.
- Direkte Website-Aufrufe, die nur einen Usage-Beleg liefern, erhalten einen ausdrücklich als `nurBeleg` markierten Einzelbeleg. Fehlende oder ungültige Providerwerte werden niemals zu gemessenen Nullkosten. Ein fehlgeschlagener oder unterbrochener Stream kann unbeobachteten Verbrauch enthalten.
- Auftragsarten sind eine kostenlose heuristische Beschreibung, keine Behauptung gleicher Schwierigkeit. Keine zusätzlichen Klassifikationsmodellaufrufe.

## Abnahme und Kennzahl

`antwort` bedeutet nur „Antwort erstellt“. Eine unabhängige Abnahme muss über die authentifizierte Owner-API mit Prüfer und Beleg separat gespeichert werden. Die Einträge sind append-only; Korrekturen ergänzen einen neueren Eintrag. Es gibt kein Modellwerkzeug, das sich selbst Erfolg bescheinigt.

Hauptkennzahl pro identischem Fall: **alle gemessenen Tokens der zugehörigen Versuche geteilt durch die Zahl unabhängig bestätigter Erfolge**. Fehlgeschlagene Versuche, Ausgabeformulierung und Unteragenten bleiben im Zähler. Unterauftrag und Parent werden nicht doppelt addiert. Daneben stehen Erfolgsquote, Aufruf-/Fallback-/Fehlerzahlen, Modellmix, Zeit und Cachewerte.

Ein beschreibendes Urteil `besser`, `schlechter` oder `aehnlich` verlangt:

1. Gleicher Kanal, Aufgabenart, Serien-/Fall-ID, Eingabehash und wortgleiches vorab festgelegtes Abnahmekriterium.
2. Mindestens drei Wiederholungen in jedem Fenster und mindestens einen bestätigten Erfolg je Fenster.
3. Alle Aufträge einschließlich Unteraufträgen abgeschlossen, alle Versuche vollständig gemessen und alle Ergebnisse abgenommen. Grenzüberschreitende oder offene Aufträge verhindern das Urteil für ihre Gruppe.
4. Zwei abgeschlossene, gleich lange UTC-Fenster. Standard sind die letzten sieben abgeschlossenen UTC-Tage und die sieben davor.

Mehr als 5 % weniger Tokens je Erfolg heißt im untersuchten Fall „besser“, mehr als 5 % mehr heißt „schlechter“. Innerhalb ±5 % heißt „ähnlich“. Eine gesunkene Erfolgsquote ergibt bei sonst vollständigen Daten „schlechter“. Die 5 % sind eine vorab definierte deskriptive Toleranz, kein statistischer Signifikanztest. Drei Wiederholungen sind eine Mindestprüfung, keine verlässliche Schätzung für alle Aufgaben.

Ohne diese Voraussetzungen lautet das Urteil `nicht_belastbar`, mit konkreten Gründen. Normale Chatwochen ohne identische abgenommene Fälle erhalten keine erfundene Aussage. Sie liefern weiterhin eine nach Bereichen aufgeschlüsselte Verbrauchsbeobachtung.

Dynamisches Gedächtnis, wechselnde Modelle/Prompts und externe Zustände können das Resultat verändern. Auch identische Aufgaben im normalen Produktivsystem beweisen daher keine kausale Wirkung einer einzelnen Optimierung. Für einen kausalen A/B-Test wären eingefrorene Zustände und ein gesondert kontrolliertes Experiment nötig; das wäre ein anderer Test als die normale Nutzung.

## Zugriff und Nachweis

Die Auswertung ist über dieselbe geschützte Datenquelle für Dashboard, Agent und CLI abrufbar. Anfang und Ende sowie ein eigener früherer Basiszeitraum lassen sich explizit wählen. Fenster müssen gleich lang und dürfen nicht überlappend sein. Maximal 90 Tage je Fenster und 180 Tage Abstand; mehr als 20.000 Belege werden nicht still gekürzt.

Vollständige Exporte enthalten einen SHA-256 über das JSON ohne `nachweis`, mit rekursiv lexikographisch sortierten Objektschlüsseln und unveränderter Arrayreihenfolge. Der CLI prüft den Hash vor dem Speichern. Er belegt Unverändertheit eines gesicherten Exports, keine unabhängige Beglaubigung des Providers. Ein gemeinsamer Datenbanklesestand verbindet Aggregate, Einzelbelege und Abnahmen. Der interne Summenabgleich nennt Differenzen ausdrücklich; das ist kein Rechnungsabgleich.

### Prüfung ohne Dashboard-Anmeldung

30 Sekunden nach Serverstart und danach stündlich prüft ein reiner Datenbanklauf das Tagesarchiv. Pro UTC-Tag wird genau ein unveränderlicher Bericht dauerhaft in `lukas_verbrauch_berichte` abgelegt. Mehrere Prozesse/Neustarts benutzen dieselbe Tages-ID. Erfolgreiche Berichte werden wiederverwendet; Fehler werden stündlich erneut versucht. Es wird kein Modell aufgerufen.

Zusammenfassungen stehen als `LUKAS_EFFIZIENZ` im privaten Railway-Laufzeitlog: `art=gesamt`, `bereich` oder `vergleich`, jeweils mit identischer Berichts-ID, Stand und SHA-256. Diese Logzeilen sind über die bereits verbundene Railway-App ohne Dashboard-Login lesbar. Sie enthalten keine Prompt-/Antworttexte, Kriterien, Telefonnummern oder Zugangsdaten. Vollständige Rohbelege bleiben in der geschützten API bzw. unter `GET /api/lukas/verbrauch/archiv/:id` abrufbar. Wenn Archiv/Logs fehlen oder veraltet sind, wird die Lücke gemeldet; nicht aus Code auf funktionierende Produktion schließen.

## Nutzbare Testaufgaben und 20-Euro-Rahmen

`faelle.json` definiert vier Aufgaben samt nutzbaren Ergebnissen: Tracker-Auswertungscode, Messanalyse, Anfrage-/Projektbriefvorlagen und SEO-Berichtsplan. Je Bereich sind höchstens 5 Euro vorgesehen. Gleichwertigkeit entsteht durch gleiche Aufgaben und Kriterien, nicht durch das absichtliche Ausgeben gleicher Beträge.

Der Testclient spricht **dieselbe** authentifizierte Chat-API wie das Dashboard an, erstellt normale Gespräche und ändert weder Routing, Werkzeuge, Gedächtnis noch Freigabeprüfungen. Fallstudienmetadaten werden getrennt vom Prompt gespeichert. Es gibt keine Test-KI und keine künstlichen Erfolgsmarkierungen. Das Ergebnis erscheint auch im normalen Chatverlauf.

```sh
# Nur Plan oder ein kostenfreier Trockenlauf
node scripts/lukas-fallstudie.mjs plan
node scripts/lukas-fallstudie.mjs test --case tracker-auswertung

# Authentifizierten Bericht sichern, inklusive Hashprüfung
node scripts/lukas-fallstudie.mjs report --von 2026-10-24 --bis 2026-11-06 --out case-study-results/baseline.json

# Genau eine kostenpflichtige Aufgabe, erst nach bestätigter Aufladung
# und laufender Budgetkontrolle durch den Operator.
node scripts/lukas-fallstudie.mjs test --case tracker-auswertung --execute --funding-confirmed --supervised-budget --out case-study-results/tracker-01.json

# Erst nach unabhängiger Ergebnisprüfung; evidence ist ein tatsächlich geprüftes Artefakt/Prüflog.
node scripts/lukas-fallstudie.mjs accept --auftrag AUFTRAGS_ID --result erfolgreich --evidence case-study-results/tracker-01-tests.txt
```

Zugangstokens kommen aus der vorhandenen sicheren Umgebung, nicht aus dem Prompt oder Quellcode. `test --execute` braucht `LUKAS_API_TOKEN`; `report` kann den optionalen Lesetoken benutzen. Exporte sind privat und standardmäßig vom Git ausgeschlossen.

**Noch kein automatisch erzwingbarer Eurodeckel:** Der Client führt absichtlich nur eine beaufsichtigte Aufgabe aus und wiederholt Fehler nicht blind. Die genannten Schalter sind keine technische Euro-Kostensperre. Vor bezahlten Läufen müssen Aufladung, gültige Providerpreise, Währungsumrechnung und Reserve für weitere Aufrufe geklärt sein. Fehlende Kostenbelege stoppen die Serie. Ohne diese Voraussetzungen wird kein automatischer 20-Euro-Lauf gestartet und keine exakte Euroabrechnung aus Tokenzahlen behauptet. Nicht benötigtes Budget muss nicht verbraucht werden.

Telefonie verlangt einen gesonderten realen Audiotest. Eine Chat-Simulation ist kein Telefonietest. Die Chatfälle werden deshalb nicht als Nachweis besserer Telefonie ausgegeben.

## Bekannte Grenzen der Gesamtabdeckung

GPT Live meldet in diesem System gemessene Sekunden; diese bleiben separat von Texttokens. Audio-Transkription, Telnyx und ElevenLabs sind nicht vollständig als Token-/Eurobelege integriert. Direkte Python-Anbieteraufrufe auf dem VPS fehlen in der zentralen Einzelmessung und werden nicht rückwirkend erfunden. SDK-interne Versuche ohne eigene Usage-Antwort sind nicht einzeln messbar. Alte Zeiträume ohne Einzelbelege lassen sich nicht nachträglich in kontrollierte Fälle umwandeln.

Diese Umsetzung verbessert den überprüfbaren Zugriff und ermöglicht die Fallstudie; sie beweist noch keine flächendeckende Verbrauchs- oder Kostensenkung.

## Validierung

Lokal: vollständiger Typecheck/Regressionslauf, 133 UI-Tests und Builds von API, Dashboard, Landingpage und Mockup. Neue Regressionen prüfen feste Zeiträume, Kanäle, identische Fälle, Fehler-/Unterauftragskosten, fehlende Abnahmen, fehlende Providerwerte, Kontextgrenzen und die Berechtigungen des optionalen Lesetokens. Nutzungsbelege mit fehlenden Werten oder unmöglicher Cachemenge werden separat zurückgewiesen. CLI im Trockenlauf und gegen einen lokalen HTTP-Testserver geprüft: normale Chat-API, unveränderter Prompt, separate Abnahme, keine doppelte Ausführung bei vorhandenem Export, kein Start ohne Aufladungs-/Budgetkontroll-Schalter. Kein bezahlter Modellaufruf.

Lokaler nativer PostgreSQL-Lauf bestanden: Neuinstallation, Upgrade, Teilupgrade, asynchrone Auftrags-/Aufrufmessung, Abnahmespeicherung, Summenabgleich, quellseitiger Exporthash und nach JSONB-Speicherung weiterhin verifizierbarer kanonischer Archivhash sowie Wiederverwendung des unveränderten Tagesarchivs. Die CI ist ergänzt, aber noch nicht auf dem Remote-Branch ausgeführt. Sie prüft zusätzlich die Migrationskette und die echte PostgreSQL-Persistenz von Aufträgen, Einzelbelegen, Abnahmen, Summenabgleich, Exporthash und unveränderlichem Tagesarchiv. Deployment und echter Produktionsabruf werden getrennt verifiziert und erst danach als erfolgreich bezeichnet.

## Auslieferungsstand

Der Stand ist lokal implementiert und geprüft, noch nicht produktiv ausgerollt. Der Push in das öffentliche Repository wurde vom automatischen Freigabecheck wegen der Veröffentlichung technischer Betriebsdokumentation blockiert. Es wurden keine bezahlten Aufgaben ausgeführt. Eine Freigabe zur Veröffentlichung des Branches/PR ist noch erforderlich. Die Auswertung für den 15. November 2026 ist als einmaliger Zusatz zum bestehenden LUKAS-Wochenbericht hinterlegt; ein zusätzlicher Termin konnte wegen des Limits von fünf aktiven Aufgaben nicht angelegt werden.

Browserprüfung: Die Komponententests bestehen. Ein echter Chromium-Lauf wurde versucht, scheitert lokal aber an der untersagten Unix-Socket-Erzeugung. Deshalb ist keine visuelle Browserabnahme behauptet.
