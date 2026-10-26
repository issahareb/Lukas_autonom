# Zuverlässige Aufträge – Prüfung vom 25.10.2026

Geprüfte Grundlage: `a889f51` (aktueller main). Schwerpunkt: der Weg vom
Telefonauftrag über GPT Live, Backend-Delegation, Werkzeugauswahl und Policy
bis zum Telefonanbieter; außerdem Chat, Lernergebnisse, Datenbankmigrationen,
Hintergrundpause und die Telefonoberfläche. Kein vollständiges Sicherheitsaudit
aller Integrationen und kein Nachweis universeller Agentenzuverlässigkeit.

## Konkrete Befunde und Änderungen

- Es gab ausschließlich sofortiges `ruf_an`, keinen persistenten Zeitauftrag.
  `save_memory` und `create_goal` können keine Fünf-Minuten-Zusage einlösen.
  Neu: `plane_rueckruf`, `rueckruf_status`, `storniere_rueckruf`, eine eigene
  PostgreSQL-Tabelle und ein alle fünf Sekunden laufender Ausführungsdienst.
- Sowohl Werkzeug- als auch Promptauswahl erkannten „ruf mich … zurück“ nicht
  zuverlässig als Telefonauftrag. Beide wählen jetzt auch Rückrufformulierungen.
- Die überprüfte Owner-Kontakt-ID blieb in der Sprachsitzung hängen. Sie wird
  jetzt serverseitig bis zum Werkzeug weitergereicht. „Mich“ wird darüber
  aufgelöst; eine bloße Identitätsbehauptung erteilt keine Berechtigung.
- Chat-Schritte und Gefühlsauswertung setzten normale Werkzeugrückgaben
  pauschal auf gelungen, auch wenn die Rückgabe eine Ablehnung enthielt.
  Eine gemeinsame Auswertung erkennt konkrete Fehler-/Blockiert-/Unklar-
  Ergebnisse. Sie bleibt für ältere Freitextwerkzeuge eine Heuristik.
- Arbeitsregeln priorisieren tatsächliche Ausführung und bestätigte Ergebnisse.
  Die falsche feste Replit-Angabe und pauschale Browser-Erfolgsgarantie sind
  entfernt. Modellname und Stimme wurden nicht als Ersatz für Infrastruktur
  geändert.

## Verhalten des Rückrufdienstes

Ein Auftrag wird erst nach erfolgreichem Datenbank-Commit bestätigt. Er ist
unabhängig von der ursprünglichen Sprachverbindung und vom Pausenschalter für
unaufgeforderte autonome Arbeit. Ein Neuladen oder Neustart verliert ihn nicht.

Erlaubt sind eindeutig gespeicherte Kontakte mit bestehender Anruffreigabe.
Die Freigabe und die unveränderte Nummer werden bei Ausführung erneut geprüft.
Neue Kontakte/Berechtigungen werden durch das Werkzeug nicht angelegt. Für
einen Kontakt ist höchstens ein geplanter oder gerade startender Auftrag
zulässig. Ein zweiter Auftrag nennt den vorhandenen, statt unbemerkt umzubuchen.
Absolute Zeiten benötigen eine Zeitzone; relative Minuten werden serverseitig
berechnet. Grenze: 30 Tage im Voraus, mindestens eine Minute relativ.

Mehrere Worker konkurrieren über PostgreSQL-Zeilensperren. Der Claim wird
**vor** dem externen Anruf persistiert. Ein Crash oder eine verlorene
Anbieterantwort kann deshalb „unklar“ bedeuten; es erfolgt kein automatisches
erneutes Wählen. Genau-einmal-Zustellung an einen Telefonanbieter ist damit
nicht garantiert. Ein Crash zwischen Claim und Wählen kann einen Anruf
verhindern; die offene Ungewissheit wird gemeldet, statt einen Doppelanruf zu
riskieren. Unklare Starts nach zwei Minuten und um mehr als 15 Minuten
überfällige Pläne werden sichtbar markiert. Kurze Ausfälle werden aufgeholt.

Nach dem Wählversuch steht das Ergebnis zusätzlich unter Meldungen. Die
Telefonseite zeigt Rückrufzeit, Status, Ergebnis und – bei vorhandener
Anruf-ID – den getrennten Gesprächsstatus. Geplant ist nicht gestartet;
gestartet ist nicht angenommen oder erfolgreich erledigt. Stornieren ist nur
vor dem Claim möglich. Eine laufende Verbindung beendet der Storno-Knopf nicht.

## Geprüft

- Vollständiger `npm run typecheck`: Backend-Prüfskripte und 128 Frontendtests.
- API- und UI-Produktionsbuild erfolgreich.
- `ADMIN_DATABASE_URL=… node lib/db/check-migrationen.mjs`: Neuinstallation,
  Upgrade, Wiederholung und Teilstand über den echten Deploy-Migrationspfad;
  Schema stimmt mit dem Drizzle-Modell überein.
- `BENCH_DATABASE_URL=… node scripts/check-rueckrufe.mjs` aus api-server:
  tatsächliches PostgreSQL, relative Zeit exakt +300000 ms, kein Frühstart,
  parallele Planung und Ausführung ohne Doppelanruf, Storno, Widerruf,
  unklare Anbieterantwort ohne Wiederholung, überfällige Aufträge,
  Crash-Recovery und Ausführung durch einen neuen Node-Prozess. Der Dialer
  ist eine Attrappe; es wird keine echte Nummer angerufen.
- Authentifizierte HTTP-Abfrage/Stornierung: ohne Token 401, bekannte geplante
  Aufgabe stornierbar, bereits gestartete nicht fälschlich stornierbar.
- Live-Tests prüfen, dass nur die bestätigte Owner-Kontakt-ID beim Backend
  ankommt; öffentliche Gesprächspartner behalten ein leeres Werkzeugangebot.
- UI-Test prüft Fälligkeit/Status, authentifizierten Storno und verhindert
  versehentliche Testanrufe.

## Verbleibende Grenzen / Abnahme

Diese Änderung schafft die fehlende Rückruf-Infrastruktur. Der konkrete alte
Anruf wurde nicht anhand seines Transkripts rekonstruiert. Es ist daher kein
Beweis, welcher zusätzliche Laufzeitfehler damals vorlag.

Vor einem echten Abnahmeanruf müssen Owner-Erkennung, Anruffreigabe des
Kontakts und Anbieter-Konfiguration produktiv stimmen. Der End-to-End-Test
„als Owner anrufen → Rückruf in fünf Minuten beauftragen → auflegen →
Telefon klingelt → LUKAS spricht“ steht aus. Es wurde kein solcher Erfolg
behauptet und kein unaufgeforderter echter Anruf ausgelöst.

Allgemeine lange Aufgaben erhalten hier noch keinen dauerhaften Job-Executor.
Laufende Backend-Delegationen werden beim Auflegen weiterhin abgebrochen;
nur bereits persistierte Rückrufaufträge überleben. Andere Zeitaktionen
müssen ausdrücklich als noch nicht unterstützt behandelt werden. Die
Freitext-Ergebnisheuristik ersetzt langfristig keine strukturierten Ergebnisse
für jedes einzelne Werkzeug. Die neue Migration ist additiv; ein Rollback des
Codes lässt die Tabelle und gespeicherte Aufträge bestehen.

## Ergänzung 26.10.: Informationen am Owner-Telefon

Die Oberfläche konnte Telefonanfragen lesen, aber im Agenten-Werkzeugkasten
fehlte ein entsprechender Datenbankabruf. Zusätzlich wurde jeder eingehende
Anruf als Firmenempfang behandelt, einschließlich des freigegebenen Owners.
Dadurch bekamen Owner-Sitzungen widersprüchliche Rollenhinweise.

Neu ist das gemeinsame, rein lesende Werkzeug `lese_anfragen` für privaten
Chat und Owner-Telefon. Es liefert Telefon- und Website-Anfragen mit Quelle,
Zeitfenster, Anzahl, Status und begrenzten Zusammenfassungen. Default: letzte
30 Tage, alle Bearbeitungsstände, fünf Einträge; weitere Seiten und bis zu
90 Tage sind möglich. Abgelehnte Telefonweitergaben sind ausgeschlossen.
Ungeklärte/fehlgeschlagene Auswertungen werden separat ausgewiesen. E-Mail und
WhatsApp sind andere Datenquellen; das Ergebnis behauptet keine vollständige
kanalübergreifende Postfachauskunft. Kundentext bleibt untrusted Inhalt.

Die Owner-Prüfung ist jetzt identisch für die hörbare Rollenbeschreibung und
die Backend-Werkzeugfreigabe. Nur nach der bestehenden serverseitigen Prüfung
bekommt die Sprachsitzung den privaten Assistentenmodus. Sie startet dann keine
Kundenanfrage-Erfassung und erhält keine Empfangsanweisungen zur Qualifizierung
eines Neukunden. Öffentliche/fremde Anrufe behalten ihre getrennten Regeln.
Es werden keine Kontaktdaten oder Zugriffsrechte aufgrund gesprochener
Identitätsbehauptungen geändert.

Tests: tatsächliche PostgreSQL-Abfragen einschließlich Quelle, Consent,
Zeitfenster, offener Auswertung, Zählung und Pagination; Datenbankfehler werden
nicht zu einem leeren Ergebnis. Die SIP-Tests prüfen den Owner-Modus bereits
im Accept-Payload und die Verweigerung für fremde/ungültige Owner-Kontexte.
Zusätzliche Betriebslogs nennen nur `ownerTools` und `businessReception`, keine
Nummern oder Gesprächsinhalte. In der letzten geprüften Produktions-Startdiagnose
vom 24.10. war die Owner-Konfiguration eindeutig, privat und aktiviert. Das
beweist nicht, wie ein konkreter späterer Anruf zugeordnet wurde.

Diese Ergänzung ist Code mit getesteten Schnittstellen, kein bereits
bestätigter Modell-/Telefon-End-to-End-Erfolg. Die produktive Freischaltung
und der echte Owner-Anruf bleiben ein eigener Abnahmeschritt.

## Rückmeldungen bei langen Telefonaufträgen

Die Live-Delegation hatte während des Backend-Abrufs keine Statusrückmeldung.
Ihr 120-Sekunden-Signal galt erst ab dem Modellaufruf; ein hängender Aufbau des
privaten Kontexts davor konnte unbegrenzt warten. Ein geschriebenes
`session.commentary.append` wurde zudem nicht mit seiner Anbieterbestätigung
korreliert.

Jetzt umfasst das Zeitlimit den gesamten Auftrag, einschließlich Kontext und
Gedächtnisabruf. Nach acht und dreißig Sekunden kann die Sitzung einen ehrlichen
Zwischenstand an das Sprachmodell senden. Eine kurze Anwesenheitsfrage erhält
während der Arbeit unmittelbar Statuskontext, ohne einen weiteren Backendauftrag
auszulösen. Diese Hinweise sind auf höchstens einen in fünf Sekunden begrenzt.
Verspätete Resultate nach Timeout oder Auflegen werden nicht mehr ausgespielt;
begonnene externe Aktionen können dennoch stattgefunden haben. Daher gibt es
keine automatische Wiederholung, und die Ungewissheit bleibt im Gesprächskontext.

Jede Antwort erhält eine Ereignis-ID. Passende `session.commentary.appended`-
Ereignisse messen die Zustellzeit; fehlende Bestätigungen werden nach zehn
Sekunden protokolliert. Eine Zustellbestätigung ist ausdrücklich kein Nachweis
hörbarer Wiedergabe. Inhalt, Schlüssel und Telefonnummern stehen nicht in diesen
neuen Diagnoseeinträgen. Alle Timer werden bei Sitzungsende aufgeräumt.

Die Telefon-Konfigurationsdiagnose zeigt nun die tatsächlich für SIP ausgewählte
Stimme, einschließlich `LUKAS_TELEFON_LIVE_VOICE`, statt nur der Dashboard-Stimme.
Stimme, Codec und Telnyx-Routing wurden durch diese Ergänzung nicht geändert.

Geprüft mit simuliertem Live-Anbieter: hängender Kontext, hängendes Backend,
Statusfrage ohne zweiten Auftrag, Timeout vor Modellstart, Unterdrückung später
Ergebnisse, passende/fremde/doppelte Zustellbestätigungen und Timer-Cleanup.
Die bisherigen SIP-, Telefonmedien-, Telnyx- und Konfigurationstests bestehen.
Vollständiger Typecheck mit 128 UI-Tests und API-Produktionsbuild erfolgreich.
Ein erneuter realer Modell-/Telefon-Abnahmetest steht weiter aus. Ein hörbarer
Qualitätsgewinn oder die konkrete Ursache eines früheren Aussetzers ist damit
nicht nachgewiesen.

API-Vertrag geprüft am 26.10.2026:
https://developers.openai.com/api/docs/guides/live-delegation
