# Owner-Zugang am Telefon

Der private Dashboard-Zugang und öffentliche Telefonate bleiben getrennt.
Ein ausdrücklich konfigurierter Owner-Kontakt kann im eingehenden Telefonat
das Lukas-Backend mit den vorhandenen Werkzeugen verwenden, beispielsweise
`github_read_path` für den eigenen Code in `Lukas_autonom`.

## Konfiguration

1. `LUKAS_TELEFON_OWNER_CONTACT_LOOKUP` dient ausschließlich einer lesenden
   Diagnose: exakt nach dem gespeicherten Kontaktnamen suchen, Mehrdeutigkeiten
   ablehnen und nur Kontakt-ID, Stufe und Konfigurationsstatus protokollieren.
   Diese Variable allein vergibt keine Werkzeugrechte.
2. Die bestätigte ID in `LUKAS_TELEFON_OWNER_CONTACT_ID` konfigurieren.
   Der Kontakt muss im Dashboard auf `privat` stehen.
3. Die Annahme prüft den signierten eingehenden Telefonkontext, die exakte
   Nummernzuordnung zum Kontakt und dessen ID. Öffentliche, gesperrte,
   ausgehende und nicht zugeordnete Anrufe erhalten keine Owner-Werkzeuge.
   Der Live-Manager prüft die interne Freigabe und die konfigurierte ID erneut.

`LUKAS_TELEFON_STRENG=true` verhindert die Freigabe für eingehende Anrufe.
Die bestehende Owner-Entscheidung lässt diesen Schalter standardmäßig aus:
Provider-Signaturen sichern die Zustellung, authentifizieren aber nicht die
Person hinter einer Rufnummer. Der Zugang beruht weiterhin auf der vom Owner
gewählten Rufnummernzuordnung. Namen aus SIP-Headern oder Gesprächsaussagen
können keine Rechte vergeben. Änderungen der Nummer des konfigurierten
Kontakts sind deshalb Änderungen an dieser Zugangsregel.

Die vorhandene Werkzeug-Policy bleibt wirksam. Das Freischalten der
Telefonwerkzeuge startet keine Hintergrundläufe und ändert keine
Autonomiepause. Konkrete Aufgaben werden an das Backend delegiert; Ergebnisse
werden erst nach dem Werkzeugergebnis bestätigt.

## Gesprächsstart und Prüfung

Der private Systemkontext wird erst bei einer Backend-Aufgabe geladen und
blockiert die Annahme nicht. Die Begrüßung wird einmal auf Deutsch mit
ausdrücklichem Sofortstart angefordert. Bereits begonnene Sprache verhindert
eine zweite, unterbrechende Begrüßung.

Die Logs unterscheiden gesendete Begrüßung, zugehörige Provider-Bestätigung
und erste Audio-/Text-Ereignisse. Sie enthalten keine Gesprächsinhalte.
Eine Bestätigung beweist noch keine hörbare Ausgabe auf dem Telefon.
Die Startdiagnose prüft zusätzlich lesend, ob der konfigurierte GitHub-Zugang
eine echte Quelldatei vom laufenden Branch lesen kann.
