# Testbericht 23.10.2026

Echtes Interview: **nicht gestartet**. Keine erneute Bewerbung und kein echter
Eva-Interviewlauf zum Debuggen. Die technische Gesamtfreigabe ist noch offen.

## Tatsächlich ausgeführt

Linux-Chromium/Playwright, PulseAudio und Python liefen lokal, in Docker und in
einem separaten Railway-Dienst. Produktiver LUKAS-Webdienst blieb unverändert.
Keine Fake-Audio-Geräte von Chromium; echte virtuelle Linux-Audiogeräte.

| Prüfung | Beobachtung |
| --- | --- |
| Beide Audiorichtungen | Bestanden, getrennte 440-/880-Hz-Signale |
| Echo/Rückkopplung | Kanaltrennung bestanden, zuletzt dokumentierter Eigenanteil −117,7 dB; keine eigenen Antworten als Nutzereingaben in den geprüften Modelltranskripten |
| Railway-Transportzeiten | 47,7 ms Browser→Worker und 109,9 ms Worker→Mikrofon in einem Lauf; ausschließlich Transport, keine KI-Reaktionszeit |
| Ausgabe abbrechen | Ausgabepuffer und Player werden verworfen; Test-Mikrofon erkannte Stille nach 493,1 ms einschließlich Analyser-Glättung |
| Satzanfänge | 100-ms-Eingangsmarker erhalten, erste 60 ms korrekt erkannt; keine globale Garantie für natürliche Sprache |
| Fehlerfälle | Sieben automatisierte Tests mit realem Browser/Audio und simuliertem Provider bestehen auf Railway; zuletzt 22,853 s |
| Eva-Startschutz | Zwei lokale Tests bestehen, einschließlich eigener Browser-Testseite für Sicherheits-/Identitäts-/Einwilligungssperren |
| Echte Modellverbindung | Mehrere GPT-Live-Sitzungen auf Railway mit geschützter OpenAI-Variablenreferenz |
| Anfangsvorstellung | Hörbare Vorstellung als LUKAS, Issas KI-Agent; ausdrücklich nicht Issa |
| Nutzerwissen | Smartphone-/Terminal-Arbeit, Codex/Claude, etwa ein Jahr und Quereinstieg korrekt verwendet |
| Projektwissen nach Kontextkorrektur | TaxiBB requestKey/Fingerprint/409, Express/React/Vite/PostgreSQL/Drizzle bei LUKAS, Zod/Loadout-Sharing bei GuardianGrid korrekt erläutert |
| Grenzen | Keine erfundenen Umsätze oder Bungie-Partnerschaft; keine administrativen Aktionen oder verbindlichen Vertragszusagen |
| Realer HTTP-Stopp | Bestanden, `reason=manual_stop`, `stop_http_ok=true`, `provider_finalized=true` |
| Realer Netzwerkabbruch | Echte Sitzung verbunden, Transport absichtlich abgebrochen, Browser/Capture/Playback beendet; `provider_finalization_confirmed=false` korrekt ausgewiesen |
| Railway→Eva-Oberfläche | Reguläres Fenster erreichbar; keine Einwilligung gesetzt, kein Start geklickt |

## Gemessene Modelllatenz

Messpunkt: geschätztes Ende des letzten nichtstillen Samples der synthetischen
Frage bis zur ersten erkannten Antwort am tatsächlichen Browser-Mikrofon.
Abtastung etwa 10 ms, Schwelle und Browserpuffer beeinflussen den Wert. Keine
akustische Präzisionsmessung und kein p95-/Produktionsversprechen.

Im dritten echten Lauf lagen sieben ungestörte Antworten bei
1327,0 / 1349,2 / 1416,4 / 1518,7 / 1628,1 / 1680,6 / 1706,0 ms.
Das ist ungefähr **1,33 bis 1,71 Sekunden**. Die absichtlich unterbrochene Antwort
hat keinen gültigen Erstbeginn-Messwert. Der 421,9-ms-Wert nach Unterbrechung
wird nicht als Qualitätsnachweis gezählt, weil noch Inhalt der alten Antwort kam.
Frühere 58/89-ms-Werte sind ausschließlich lokale Transportzeiten.

## Gefundene Probleme und Korrekturen

- Reine Pulse-Monitorquellen erschienen nicht als Browser-Mikrofon: remap-source.
- Anfangsvorstellung im Session-Input allein blieb stumm: dokumentiertes
  `session.commentary.append` ergänzt; danach hörbar geprüft.
- VAD löschte pro Wort: Hysterese ergänzt, PCM-Eingang bleibt kontinuierlich.
- Delegations-Fallback enthielt keine konkreten Fakten: geprüfte lokale Angaben
  per `session.thinking.append` nachgereicht; danach konkrete Projekte beantwortet.
- Unterbrechung konnte alte delegierte Inhalte fortsetzen: explizites
  `session.instructions.append` zum Abbruch ergänzt; vierter echter Modelllauf bestätigt den Wechsel zur neuen Frage ohne Fortsetzung der alten technischen Antwort.
- Ein Zwischenlaut wie „Einen Moment“ zählt als gesprochener Antwortbeginn. Die
  fachliche Antwort folgt später. Antworten waren teils länger als drei Sätze.
- Synthetische Spracherkennung verwechselte gelegentlich GuardianGrid und Zahlen;
  technische Transporttests allein garantieren keine Transkriptionsgenauigkeit.

## Letzter echter Modelllauf

Deployment `1762ea2c-2b94-4ae7-a9c5-c7a52ca1b7dd`, Code `93d25913c72e536bcf9d183f35c4aa6961432b39`:
202 Sekunden; HTTP-Stopp erfolgreich; Remote-Schließung bestätigt. Die offene
Vorstellung, drei geprüfte Projektantworten, Ablehnung von Owner-Aktionen und
verbindlichen Gehaltszusagen bestanden erneut. Beim Unterbrechen wurde die alte
technische Antwort nicht fortgesetzt; die neue Umsatzfrage erhielt keinen erfundenen Wert.

Sieben ungestörte Antwortanfänge am Browser-Mikrofon: **1095,9 / 1324,5 / 1165,3 /
1271,3 / 1144,7 / 1350,4 / 1312,5 ms**, also etwa **1,10–1,35 Sekunden**.
Nach Unterbrechung: 1500,3 ms; nicht mit ungestörten Antworten zusammengefasst.
Der Transkriptionsdienst verwechselte im Umsatztest den Projektnamen. LUKAS bezog
seine Antwort deshalb teilweise auf TaxiBB. Das bleibt ein Qualitätsproblem;
keine Behauptung vollständig fehlerfreier Spracherkennung oder fachlicher Zuordnung.

Die abschließenden lokalen neun Tests stehen in `final-nine-tests.log` im privaten
Nachweisverzeichnis. Kein echter Eva-Lauf war Teil dieser Tests.

## Einsatzgrenzen

Railway reicht für den Audio-/Browserprozess aus. Die echte Eva-Oberfläche verlangt
Cloudflare Turnstile; im lokalen und Railway-Browser blieb dessen Ergebnis leer.
Keine Umgehung versucht. Im neuen Browser sind Identitätsfelder leer und die
vorhandene Bewerbung noch nicht eindeutig verknüpft. Der echte ElevenLabs-Widget-
Audiofluss nach Freigabe und Mikrofon-Vorprüfung ist daher noch nicht abgenommen.

Die verlinkten Datenschutzhinweise wurden gelesen: vollständige Gesprächsaufnahme,
Transkript, KI-Auswertung, menschliche Bewerbungsentscheidung, Löschung/Anonymisierung
180 Tage nach Abschluss; Widerruf per info@everlastconsulting.de. Keine ausdrückliche
KI-Agenten-Zulassung oder persönliche Durchführungspflicht gefunden. Issas Aussage
zur Demo-Zulassung bleibt als Nutzerangabe gekennzeichnet. Einwilligung zur Aufzeichnung dieser einen offenen Demo wurde inzwischen vom Nutzer ausdrücklich erteilt und privat dokumentiert.

Private Nachweise liegen außerhalb des Repositorys in `/workspace/demo-private`.
Die echten Testtranskripte enthalten nur synthetische Fragen und freigegebene
Kontextantworten. Keine zusätzlichen Gesprächsaufnahmen wurden gespeichert.

## Bedienzugang, Fortsetzung am Abend des 23.10.2026

Ein eigener HTTPS-Zugang mit separatem Passwort steuert einen grafischen Chromium
unter Xvfb im gleichen Audio-Worker. Cloudflare wird nicht automatisch bedient.
API-Schlüssel bleiben serverseitig. Neue Bewerbungs-POSTs und der Telefonanrufpfad
sind blockiert; ein Widget-Session-Anlegeversuch wird erst nach LUKAS-Verbindung
und höchstens einmal pro Lauf erlaubt. Der Sofort-Stopp wartet nicht auf laufende
Browserbedienung. Dreizehn lokale Tests bestanden in 22,758 Sekunden; nach der
Korrektur des UI-Ladewartens bestanden die sechs betroffenen Tests erneut.

Der erste echte Containerstart zeigte eine Lade-Race-Condition bei der Eva-CTA;
das Warten auf die sichtbare Schaltfläche wurde ergänzt. Bei gesperrter Vorbereitung
bleibt der Browser nun zur manuellen Bedienung offen. Der lokale Docker-Browser
braucht die bereitgestellte Proxy-CA in seiner Zertifikatsdatenbank; keine TLS-Prüfung
wurde abgeschaltet. Der Railway-Zugang ist im Deployment f455e6a8-dd7a-4c55-89f1-b139e2798bb6 mit SUCCESS und OPERATOR_READY bestätigt: ohne Authentifizierung liefert /screen 401, mit Authentifizierung liefern /status und das Browserbild 200. Name/E-Mail sind ausgefüllt, die zwei exakten Einwilligungen angehakt. Cloudflare zeigt eine manuell zu bedienende Prüfung. Kein Widget-Session-Startversuch wurde ausgelöst.

Der Browser-Frontendtest lud das Live-Bild ohne JavaScript-Fehler. Ein Klick auf den Stopp-Schalter schloss den lokalen Container-Browser; der externe Railway-Browser blieb für den Nutzer offen. Aktueller letzter Status: `prepared=true`, `identity_fields_empty=false`, `consent_recorded=true`, `security_check_complete=false`, `attempt_used=false`, Interview nicht gestartet.
