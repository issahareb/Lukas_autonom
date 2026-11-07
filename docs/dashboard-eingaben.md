# Dashboard: zuverlässige Navigation und Eingaben

Die Hero-Eingabe übergab bisher Text an `/chat`, legte aber kein Gespräch an. Der Chat entfernte den Übergabetext sofort aus dem Zwischenspeicher, obwohl auf Mobilgeräten noch die Gesprächsliste ohne Eingabefeld offen war.

Jetzt öffnet Senden ein neues Gespräch und übergibt den unveränderten Text einmalig an dessen Nachrichtenendpunkt. Die Übergabe bleibt bis zur Bestätigung erhalten. Eine unbestätigte Zustellung wird nach Neuladen nicht blind wiederholt. Der Anhang-Einstieg öffnet ein neues Gespräch als Entwurf und sendet den Text dabei noch nicht. Entwürfe werden pro Gespräch sowie auf der Startseite gesichert; der zuletzt ausgewählte Chat wird beim Zurückkehren wieder geöffnet.

Ein abgewiesener Sendeversuch erhält Text und Anhangauswahl. Das Entfernen eines Anhangs wird erst nach Serverbestätigung in der Oberfläche übernommen. Veraltete Anhangabfragen können nach einem Gesprächswechsel nicht mehr die neue Ansicht überschreiben. Gesprächswechsel während Senden/Upload werden gesperrt. Fehler beim Anlegen eines Chats werden sichtbar angezeigt.

Das Navigationsmenü entfernt beim Schließen seinen Dialog einschließlich Fokus-/Klicksperre sofort. Auch die Auswahl des bereits geöffneten Bereichs schließt das Menü. Der mobile Browsertest prüft wiederholtes Öffnen und Schließen, Seitenwechsel und anschließende Bedienbarkeit. Eine perfekte Diagnose jedes gemeldeten Hängers oder aller Safari-Versionen wird damit nicht behauptet.

## Rückfragen

Das interne Werkzeug `frage_issa` liefert eine strukturierte Frage für genau das zugehörige private Gespräch. Ein Fragefenster bietet ein bis drei Fragen, optional zwei bis vier Auswahlmöglichkeiten und immer Freitext. Die Antwort geht als nächste Nutzernachricht an denselben Chat. Ein später geschlossenes Fenster lässt sich wieder öffnen; Eingaben bleiben bei einem Fehler erhalten. Nach bestätigter Antwort öffnet dieselbe Frage nicht erneut. Passwörter und Schlüssel werden nicht über dieses Fenster erfragt. Telefonische Rückfragen bleiben mündlich; Hintergrundarbeit nutzt weiterhin Meldungen.

Lukas wird angewiesen, das Werkzeug bei fehlenden notwendigen Angaben zu nutzen und es bei Bedarf gezielt nachzuladen. Es gibt keine unsichere Heuristik, die beliebigen Text mit einem Fragezeichen als Eingabefenster interpretiert.

## Prüfungen

- Tests der tatsächlichen React-Chatseite unter StrictMode: Hero-Übergabe, einmaliges Anlegen/Senden, Erstellungsfehler, Anhang-Einstieg, getrennte Entwürfe, fehlgeschlagenes Senden ohne automatische Doppelzustellung und Antwort auf eine strukturierte Rückfrage.
- Rückfrage-Komponente: Schließen/Wiederöffnen, Fehlererhalt, Erfolg und Gesprächszuordnung.
- Backend: Frageschema, begrenzte Auswahl, Ablehnung von Zugangsdaten, private Gesprächsbindung und Telefonfallback.
- Echter mobiler Chromium-Browser in CI mit gebauter Oberfläche und lokalen API-Fixtures. Testet Hero, Menü, Seitenwechsel, Entwürfe, Rückfrage und HTTP-Fehler ohne bezahlte Modellaufrufe.
- Bestehende API-, UI-, Freigabe-, Telefonie- und Integrationsprüfungen bleiben Teil der Freigabe.
