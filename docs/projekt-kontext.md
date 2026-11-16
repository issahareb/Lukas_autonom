# Projektkontext im kanonischen Gedächtnis

`projekt-aliasse.ts` enthält bereits die geprüfte Identität von TaxiBB. Sie verbindet Namen, Domain und Repository mit dem vorhandenen Schlüssel `taxibb`. Dieser Schlüssel bleibt für bestehende Claims und Graphknoten kompatibel; es gibt keine zweite Projektdatenbank.

Die Ergänzung `projekt-kontext.ts` formatiert die bereits abgerufenen Gedächtnisquellen zu einer begrenzten Projektansicht. Fragen nach offenen Punkten priorisieren Aufgaben und Blocker, technische Fragen die technischen Quellen. Zustand, Entscheidungen und weitere Quellen bleiben als gespeicherte Aussagen mit Quellenart, ID und, soweit verfügbar, Beobachtungszeit erkennbar. Unbelegte, widersprüchliche oder zurückgezogene Aussagen behalten ihre Kennzeichnung. Fehlende Quellen bedeuten unbekannten Stand, niemals erledigte Arbeit.

Der gesamte Kontext bleibt auf 6.000 Zeichen begrenzt, der Projektteil auf 3.000. Das sind Zeichengrenzen, keine Tokenmessung. Dieselbe Quelle erscheint nicht erneut im übrigen Kontext. Die bestehende Retrieval-Auswahl, Graphdatenbank, Aufbewahrung und Zugriffskontrolle bleiben zuständig; der Formatierer führt keine zusätzlichen Datenbank- oder Modellaufrufe aus. Verwandte Projekte eines gemeinsamen Eigentümers werden nicht allein deshalb zum Projektzustand erklärt.

HTTP(S)-Projektadressen werden über die geparste Authority aufgelöst. Unterseiten der bekannten Domain gehören zum selben Projekt. Fremde Hosts, Userinfo und abweichende Ports werden nicht als Projektidentität akzeptiert. Ein Verweis auf einen fremden URL-Pfad namens TaxiBB ist kein Identitätsbeleg. Fuzzy Matching ist weiterhin ausgeschlossen.

Regressionen: `check-verbrauch-projekte.mjs` prüft Namen, Domain, Repository, Unterseiten, URL-Verwechslungen, fragerelevante Reihenfolge, Quellenbezug, fehlenden Zustand, Deduplizierung und Zeichengrenzen. `check-memory-graph.mjs` prüft die Verbindung beider Kantenrichtungen und fremde Projekte. Reale produktive Projektvollständigkeit wird damit nicht behauptet.
