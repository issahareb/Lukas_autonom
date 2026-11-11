# Gesprächsnotizen und Creme-Dashboard

Jede SIP-Telefonsitzung mit serverseitig bekanntem Gesprächspartner bekommt eine
interne Gesprächsnotiz: eingehend oder ausgehend, öffentlich oder privat,
Kundenanfrage oder anderer Anlass. Die bestehende Authentifizierung schützt den
Telefonanfragen-Tab. Anrufer bekommen dadurch keine zusätzlichen Werkzeugrechte.

Die Notiz beschreibt die Aussagen und das Anliegen des Gesprächspartners.
`details.ergebnis` und `details.naechsteSchritte` enthalten belegte Ergebnisse und
vereinbarte nächste Schritte. Fehlende Angaben werden nicht erfunden. Ohne
Äußerung des Gesprächspartners wird ohne Modellaufruf festgehalten, dass kein
Anliegen erfasst wurde. Eine leere Modellnotiz wird als Auswertungsfehler behandelt.

`weitergabe=offen` verhindert die interne Notiz nicht. Die vorhandene automatische
E-Mail-Weiterleitung bleibt auf abgeschlossene Kundenanfragen mit ausdrücklicher
Weitergabefreigabe begrenzt. Eine ausdrückliche Ablehnung löscht weiterhin den
Inhalt und die Details im nächsten gespeicherten Stand. Die Oberfläche erklärt
diesen Fall. Weder Anrufauftrag noch Speicherbestätigung beweisen E-Mail-Versand,
Rückruf, Termin oder Zustimmung der anderen Person.

Es werden weiterhin keine Rohtranskripte im Anfragenspeicher abgelegt. Ältere
bereits verworfene Gesprächsinhalte werden nicht rekonstruiert. Bei fehlenden
Notizen, Auswertungsfehlern und unterbrochener Erfassung erscheint ein Hinweis.
Die getrennte, zustimmungsgebundene Telefon-Gedächtnisfunktion bleibt unverändert.

Das Dashboard nutzt eine gemeinsame helle Palette für Seiten, Karten, Felder,
native Auswahlfelder und Dialoge. Statusfarben haben dunkle Schrift. Die
Gedächtniskarte nutzt Creme als Canvas-Hintergrund und normales Alpha-Blending,
damit Knoten und Verbindungen auf hellem Hintergrund sichtbar bleiben.

## Abruf durch LUKAS

`lese_anfragen` liefert neben freigegebenen Kundenanfragen eine eigene paginierte
Liste `telefonnotizen`. Diese enthält auch sachliche interne Notizen bei offener
E-Mail-Freigabe und anderen Gesprächsanlässen. Fehlender Inhalt und noch offene
Weiterleitung werden separat gezählt. Die Listen überschneiden sich und dürfen
nicht als weitere Anrufe addiert werden. Ein weiterer Owner-Zustimmungsschritt
stellt keine bereits verworfenen Inhalte wieder her. Der Abruf ist nur lesend;
er ändert keine Freigaben und verschickt nichts.

## Prüfen

- `npm run test -w @workspace/lukas-ui -- --maxWorkers=2`
- `npm run build:ui`
- `cd artifacts/api-server && node scripts/check-telefon-anfragen.mjs`
- `cd artifacts/api-server && node scripts/check-telefon-anfragen-routes.mjs`
- `cd artifacts/api-server && node scripts/check-live-session.mjs`
- `node artifacts/lukas-ui/scripts/check-cream-dashboard.mjs`

Die Browserprüfung bedient ausschließlich einen lokalen Produktionsbuild mit
synthetischen Daten. Externe Requests werden blockiert. Sie prüft 16 Routen bei
390 und 1440 Pixeln, helle Karten und Auswahlfelder, Textkontrast, Dialoge,
Gesprächsnotizen sowie fehlende historische Inhalte. `CREAM_SCREENSHOTS` und
`CREAM_REPORT` legen die lokalen Belege fest. Die GitHub-Oberflächenprüfung führt
diesen Test aus und bewahrt Screenshots als Workflow-Artefakt auf.
