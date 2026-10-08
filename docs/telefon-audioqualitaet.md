# Telefon-Audioqualität

Telefon-Audio läuft direkt zwischen Telnyx und OpenAI Live über SIP/SRTP. Der PCMU-Stream zum Dashboard ist eine unabhängige Mithörkopie.

- `TELNYX_SIP_REGION`: Standard `Europe`. Erlaubt: `US`, `Europe`, `Canada`, `Australia`, `Middle East`.
- `TELNYX_MEDIA_ANCHOR`: Standard `Frankfurt, Germany` bei europäischer SIP-Region, sonst `Latency`. Weitere unterstützte Werte: `Amsterdam, Netherlands`, `London, UK`.
- `TELNYX_AUDIO_OPTIMIZE=false` deaktiviert die einmalige Anbieter-Konfiguration beim Start. Bereits gespeicherte Anbieterwerte bleiben erhalten; die SIP-Region bleibt separat konfiguriert.

Die Einrichtung prüft die vorhandene aktive Rufnummer und ihre Anwendungszuordnung. HD Voice wird nur bei explizit deaktiviertem `hd_voice_enabled` eingeschaltet. Der Medienstandort wird an der bestehenden TeXML-Anwendung gesetzt; Namen, Webhook-Adresse und übrige Felder bleiben erhalten. Änderungen werden per GET nachgeprüft. Ein Fehler blockiert weder Serverstart noch Anrufe und aktiviert keine autonomen Worker.

Telnyx verwendet bei TeXML im Modus `Latency` die Webhook-IP für die Medienstandortwahl. Ein US-Webserver soll nicht den Medienstandort europäischer Telefonate vorgeben. Es werden keine undokumentierten Codec-Attribute ergänzt; Live SIP handelt den Codec per SDP aus.

HD Voice an der Nummer garantiert keine durchgängige HD-Übertragung: Zielnetz, Carrier und ausgehandelter Codec bestimmen die tatsächlich verfügbare Bandbreite.

Referenzen:
- https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/dial
- https://developers.telnyx.com/api-reference/texml-applications/update-a-texml-application
- https://developers.telnyx.com/docs/voice/sip-trunking/routing/anchorsite-configuration
- https://developers.telnyx.com/api-reference/phone-number-configurations/update-a-phone-number
- https://developers.openai.com/api/docs/guides/voice-sip

`npm run typecheck` umfasst die TeXML-Webhooks und die isolierte Anbieterprüfung für HD, Region, Nummernbindung, Verifikation und Fehlerfälle; es werden keine Testanrufe ausgelöst.
