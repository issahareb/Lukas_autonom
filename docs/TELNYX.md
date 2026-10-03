# Telnyx-Telefonie

`LUKAS_TELEFON_ANBIETER=telnyx` aktiviert Telnyx. Ohne diesen Schalter bleibt Twilio aktiv.

Servervariablen: `TELNYX_API_KEY`, `TELNYX_NUMMER` (E.164), `TELNYX_APP_ID`, `TELNYX_PUBLIC_KEY`, vorhandener OpenAI-Key, `OPENAI_PROJECT_ID`, `OPENAI_WEBHOOK_SECRET`. `LUKAS_LIVE_MODEL=gpt-live-1` und `LUKAS_LIVE_VOICE=cedar` gelten gemeinsam für Telefon, Dashboard und Sprachwidget. Frühere `LUKAS_TELEFON_MODELL`-/`LUKAS_REALTIME_*`-Werte werden im Live-Pfad nicht verwendet.

Die TeXML-Anwendung benötigt ein aktives Outbound Voice Profile und eine zugeordnete Voice-Rufnummer. Ihre Voice URL ist `https://<LUKAS-DOMAIN>/api/telefon/telnyx/texml`, Methode POST. Das OpenAI-Projekt muss `live.transport.incoming` an `https://<LUKAS-DOMAIN>/api/telefon/eingehend` zustellen. Keine Aufzeichnung wird aktiviert.

Eingehende TeXML-Anfragen werden über Ed25519 und den Zeitstempel geprüft. Der exakte form-encoded Body bleibt dafür erhalten. Nur die konfigurierte Connection und Rufnummer werden akzeptiert. Die Antwort verbindet zum OpenAI-SIP-Ziel über TLS. Der signierte `X-Lukas-Context` korreliert Richtung, Teilnehmer und Anlass; OpenAI muss diesen SIP-Header im signierten Incoming-Webhook zustellen. Ein fehlender oder manipulierter Kontext wird im Telnyx-Modus abgewiesen. SIP-Caller-ID allein beweist weiterhin keine Identität: `LUKAS_TELEFON_STRENG` behält seine bestehende Wirkung.

Ausgehend prüft LUKAS zuerst die Kontaktfreigabe einschließlich Sperrstatus und dann den tatsächlichen Aktivierungsstatus der Telnyx-Nummer. `POST /v2/texml/calls/{connection_id}` erhält `From`, `To` und inline `Texml`. Der Teilnehmerkontext ist HMAC-signiert und drei Minuten gültig; er überlebt einen Serverneustart. OpenAI-Webhook-Duplikate derselben `live_…`-Session-ID teilen sich während der Annahme dieselbe Arbeit und werden nach Erfolg im Prozess für zehn Minuten ignoriert. Die Webhook-Antwort bestätigt erst nach erfolgreicher Verarbeitung. Realtime-Ereignisse werden ignoriert, damit nicht versehentlich das falsche Protokoll gewählt wird. Die Deduplizierung ist pro Prozess; bei mehreren Replikas muss sie in einen gemeinsam genutzten Speicher umziehen.

Das geschützte `GET /api/lukas/telefon/telnyx` und die Telefonseite unterscheiden technische Einrichtung und Rufnummerfreigabe. Ein Startup-Check protokolliert den Providerstatus ohne Schlüssel oder signierte TeXML-Inhalte. `requirement-info-pending` ist keine aktive Rufnummer; Unterlagen müssen bei Telnyx eingereicht und bestätigt werden.

Prüfung: `node scripts/check-telnyx.mjs` im API-Server testet Signaturen über Formdaten, abgelaufene/manipulierte Daten, falsche Connections, signierte Anrufzuordnung, Webhook-Duplikate, blockierte Rufnummern und den echten API-Vertrag mit gemocktem Provider. Ein abschließender Live-Gesprächstest für beide Richtungen ist erst nach Rufnummerfreigabe möglich.

## GPT Live anschließen

Im OpenAI-Projekt muss der bestehende Webhook unter derselben URL das Ereignis `live.transport.incoming` abonnieren. `realtime.call.incoming` allein genügt nicht. Der Signaturschlüssel bleibt `OPENAI_WEBHOOK_SECRET`. Es wird keine Aufzeichnung aktiviert.

Der Server nimmt mit `POST /v1/live/sessions/{session_id}/accept` an und verbindet einen authentifizierten Sideband-WebSocket. Schlüssel und private Backend-Anweisungen bleiben serverseitig. `cedar` ist die Standardstimme, `marin` kann über `LUKAS_LIVE_VOICE` ausgewählt werden.

GPT Live übernimmt den Gesprächsfluss. Wissensfragen werden serverseitig über Lukas' bestehenden Modellrouter beantwortet. Telefonate erhalten ausdrücklich keine Werkzeuge; die bisherige Caller-ID-Abwaegung berechtigt weiterhin nicht zu Aktionen. Der authentifizierte Dashboard-Sprachkanal kann dagegen Lukas-Werkzeuge über dessen bestehende Freigabeprüfung nutzen.

Vor dem ersten produktiven Gespräch sind die Freischaltung von GPT Live im OpenAI-Projekt, der Live-Webhook und eine aktive Telnyx-Nummer zu prüfen. Automatisierte Tests verwenden lokale Provider-Attrappen und lösen keine echten Anrufe aus.

## Telefonietest bei pausierter Autonomie

`LUKAS_BACKGROUND_PAUSED=true` stoppt die selbst gestarteten Railway-Laeufe:
Autonomie, Moltbook, Selbstheilung, Gedächtnis-Konsolidierung und automatische
Reflexion. Telefonie und ausdrücklich angeforderte Chat-Antworten bleiben verfügbar.
Die Einstellung gilt über Neustarts hinweg; ein Deployment beendet auch vorherige
Prozesse. Für die Wiederaufnahme müssen zusätzlich gegebenenfalls gesetzte
`LUKAS_AUTONOMY_ENABLED=false` und `LUKAS_HEILUNG_ENABLED=false` zurückgesetzt werden.

Mit `LUKAS_TELEFON_DIAGNOSE=true` prüft der Server beim Start ausschließlich
Metadaten: OpenAI-Modellzugriff, verfügbare Ereignisse, Webhook-Abonnement sowie
Telnyx-Nummer, TeXML-Voice-URL und Outbound-Profil. Das erzeugt keine Sprachsitzung.
Ein positives Ergebnis bestätigt weder Guthaben noch die Audioverbindung.

Die separaten Python-Agenten auf dem VPS benötigen eine eigene Pause. Der durch
`LUKAS_PAUSE_VPS_BACKGROUND=true` freigeschaltete Inventarhelfer prüft zunächst nur
die vorhandenen Prozesse und Startmechanismen über den bestehenden SSH-Zugang;
`mode=inventory, paused=false` ist ausdrücklich keine Stoppbestätigung.
Trading und Datenbanken sind nicht Teil dieser Prüfung.

`LUKAS_TELEFON_WEBHOOK_REPAIR=true` ist ein bewusst aktivierter Einrichtungsschritt:
Er ergänzt nur `live.transport.incoming` an genau einem bereits vorhandenen
Webhook mit der erwarteten URL und erhält dessen sonstige Ereignisse. Danach
prüft er den gespeicherten Stand und sendet ein harmloses Testereignis zur
Signaturprüfung. Es entstehen keine Anrufe. Nach erfolgreicher Einrichtung den
Schalter wieder auf `false` setzen.

## GPT Live benötigt verschlüsseltes SIP-Audio

Das gemeinsame TeXML für eingehende und ausgehende Anrufe verwendet `;transport=tls;secure=srtp` im OpenAI-SIP-Ziel. TLS schützt die Signalisierung, SRTP die Audiospur. TLS allein führt bei der Live-Annahme zu HTTP 400: `Live SIP calls require SRTP.` Der signierte `X-Lukas-Context` bleibt nach den URI-Parametern erhalten.

Der Telnyx-Hinweis „This is an automated call generated on the Telnyx platform …“ ist davon unabhängig: Er gilt laut Telnyx auch für Paid-Konten. Dafür ist die Kontoverifizierung auf Verified beziehungsweise Level 2 maßgeblich; eine Einzahlung allein entfernt den Hinweis nicht.

Quellen: [Telnyx SIP-URI-Verschlüsselung](https://github.com/team-telnyx/telnyx-node/blob/b697a5ac3b86173a2ca2c837dd51ab7ce7c4db25/src/resources/calls/calls.ts), [Paid-Beschränkungen](https://developers.telnyx.com/docs/account-setup/levels-and-capabilities/paid).
