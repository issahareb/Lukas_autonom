# Telnyx-Telefonie

`LUKAS_TELEFON_ANBIETER=telnyx` aktiviert Telnyx. Ohne diesen Schalter bleibt Twilio aktiv.

Servervariablen: `TELNYX_API_KEY`, `TELNYX_NUMMER` (E.164), `TELNYX_APP_ID`, `TELNYX_PUBLIC_KEY`, vorhandener OpenAI-Key, `OPENAI_PROJECT_ID`, `OPENAI_WEBHOOK_SECRET`. `LUKAS_TELEFON_MODELL=gpt-realtime` verwendet ein zum bestehenden Realtime-SIP-Endpunkt passendes Modell; die separate Browser-Stimme bleibt unverändert.

Die TeXML-Anwendung benötigt ein aktives Outbound Voice Profile und eine zugeordnete Voice-Rufnummer. Ihre Voice URL ist `https://<LUKAS-DOMAIN>/api/telefon/telnyx/texml`, Methode POST. Das OpenAI-Projekt muss `realtime.call.incoming` an `https://<LUKAS-DOMAIN>/api/telefon/eingehend` zustellen. Keine Aufzeichnung wird aktiviert.

Eingehende TeXML-Anfragen werden über Ed25519 und den Zeitstempel geprüft. Der exakte form-encoded Body bleibt dafür erhalten. Nur die konfigurierte Connection und Rufnummer werden akzeptiert. Die Antwort verbindet zum OpenAI-SIP-Ziel über TLS. Der signierte `X-Lukas-Context` korreliert Richtung, Teilnehmer und Anlass; OpenAI muss diesen SIP-Header im signierten Incoming-Webhook zustellen. Ein fehlender oder manipulierter Kontext wird im Telnyx-Modus abgewiesen. SIP-Caller-ID allein beweist weiterhin keine Identität: `LUKAS_TELEFON_STRENG` behält seine bestehende Wirkung.

Ausgehend prüft LUKAS zuerst die Kontaktfreigabe einschließlich Sperrstatus und dann den tatsächlichen Aktivierungsstatus der Telnyx-Nummer. `POST /v2/texml/calls/{connection_id}` erhält `From`, `To` und inline `Texml`. Der Teilnehmerkontext ist HMAC-signiert und drei Minuten gültig; er überlebt einen Serverneustart. OpenAI-Webhook-Duplikate derselben call_id werden im Prozess für zehn Minuten ignoriert. Die Deduplizierung ist pro Prozess; bei mehreren Replikas muss sie in einen gemeinsam genutzten Speicher umziehen.

Das geschützte `GET /api/lukas/telefon/telnyx` und die Telefonseite unterscheiden technische Einrichtung und Rufnummerfreigabe. Ein Startup-Check protokolliert den Providerstatus ohne Schlüssel oder signierte TeXML-Inhalte. `requirement-info-pending` ist keine aktive Rufnummer; Unterlagen müssen bei Telnyx eingereicht und bestätigt werden.

Prüfung: `node scripts/check-telnyx.mjs` im API-Server testet Signaturen über Formdaten, abgelaufene/manipulierte Daten, falsche Connections, signierte Anrufzuordnung, Webhook-Duplikate, blockierte Rufnummern und den echten API-Vertrag mit gemocktem Provider. Ein abschließender Live-Gesprächstest für beide Richtungen ist erst nach Rufnummerfreigabe möglich.
