# Aufgabenbedarf statt bloßer Stichwörter

Die Praxistests vom 7. November 2026 zeigten unnötige Startauswahl: Eine reine Codeantwort lud Telefonregeln, eine E-Mail-Vorlage Postfach-/Versanddefinitionen und ein fiktiver Übergabevermerk Telefonanleitungen. Die bisherige Suche nach `ruf.*an` konnte auch „Aufrufe“ treffen. Ein alleinstehendes „zurück“ lud Telefonregeln bei gewöhnlichen Rückgabewerten.

Die neue konservative Bedarfserkennung trennt klar erkennbare Textvorlagen und ausdrücklich auf die Chatantwort begrenzte Aufgaben von tatsächlichen Aktionen. Nur in diesem Fall starten Gedächtnisabfrage und die beiden Werkzeuge zum gezielten Nachladen. Der gesamte stabile Instruktionskern bleibt bytegleich. Spezialanleitungen zum Bedienen externer Systeme entfallen beim Entwurf. Ein kurzer Hinweis stellt klar, dass erwähnte Funktionen keine auszuführenden Aktionen sind und eine hier erledigte Antwort kein neues Ziel braucht.

Echte oder gemischte Anweisungen wie Versand, Anrufe, Rückrufe, Recherche, Ausführung, Repositoryzugriffe und Veröffentlichung behalten die normale Auswahl. Mehrdeutige und überlange Aufträge fallen auf den bisherigen Pfad zurück. Wortgrenzen verhindern die nachgewiesenen Telefon-Fehlzuordnungen. Bestehende Nachlade- und Freigabeprüfungen gelten weiterhin.

## Reproduzierbarer Vergleich

Aus `artifacts/api-server`: `node bench/bedarf-vergleich.mjs`. Die zwei eingefrorenen Auswahlquellen sind bytegleich mit dem bisherigen Produktionsstand `446b6fafffe3ef99c4d131a0c4aa73b8f0008e3f`; dies wurde gegen GitHub geprüft. Die vier Originalprompts des synthetischen Praxistests sind enthalten. Gemessen werden ausgewählte statische Promptteile und die durch den echten Request-Serializer erzeugten Werkzeugdefinitionen, mit einem isolierten Provider ohne bezahlte Modellaufrufe.

| Fall | Promptzeichen vorher | nachher | Werkzeuge vorher | nachher | Schema-Bytes vorher | nachher |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Analyse | 15.607 | 15.972 | 6 | 3 | 3.757 | 1.955 |
| Kundenanfrage-Vorlagen | 19.120 | 15.972 | 9 | 3 | 5.494 | 1.955 |
| Codeantwort | 32.383 | 15.972 | 13 | 3 | 9.786 | 1.955 |
| Übergabevermerk | 26.007 | 15.972 | 11 | 3 | 6.584 | 1.955 |

Über diese vier Fälle: 31,4 % weniger Zeichen in den ausgewählten Promptteilen und 69,5 % weniger serialisierte Schema-Bytes. Bei der Analyse erhöht der spezifische Hinweis den Prompt um 365 Zeichen; dafür entfallen drei Definitionen. Das sind **keine gemessenen Einsparungen bei abgerechneten Tokens oder Eurokosten** und kein allgemeiner Qualitätsnachweis. Vollständiger Laufzeitkontext mit dynamischen Erinnerungen und Status ist hier nicht Teil der Größenmessung. Einzelwerte und Grenzen stehen in `bedarf-vergleich.json`.

## Kontext und Regressionen

Nachrichten, Archiv, Memory-Retrieval, Modellrouting, Freigaben und Kontextbudgets werden nicht verändert. Die bereits vorhandene Verdichtung bleibt: ältere Werkzeugergebnisse über 4.000 Zeichen werden unter Schonung der zwei jüngsten Ergebnisse auf Anfang/Ende gekürzt; lange Chats werden in vollständigen Dialogzügen in ein begrenztes Fenster gepackt. Das ist eine verlustbehaftete Auswahl für den Aufruf mit weiter verfügbarem Originalarchiv, keine verlustfreie Zusammenfassung. Diese Grenzen werden nicht abgesenkt.

`check-aufgaben-bedarf.mjs` prüft Antwortaufgaben, echte und gemischte Aktionen, unveränderten Kern, weiter verfügbares Gedächtnis/Nachladen sowie Telefon-Falschpositive und echte Rückrufsprache. Der Vergleich läuft zusätzlich in der regulären Typecheck-Prüfung. Bestehende Tests prüfen die HTTP-Chat-/Brain-Schleife, Nachladen vollständiger Definitionen, Telefonie, Rückrufe, Freigaben, Modellrouting, Cache und Verdichtung.

Ein reduzierter Startkatalog ist keine Entfernung einer Fähigkeit. Falls der konkrete Auftrag doch eine zusätzliche Quelle oder Operation benötigt, kann Lukas sie weiterhin gezielt entdecken; die normale Ausführungsprüfung entscheidet unverändert über ihre Zulässigkeit. Die Erkennung ist bewusst konservativ und verspricht keine perfekte semantische Klassifikation beliebiger Texte.
