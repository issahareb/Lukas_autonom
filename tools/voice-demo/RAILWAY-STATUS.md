# Railway, 23.10.2026

Produktivdienst `Portfolio_v2` blieb unverändert. Separater Worker
`lukas-voice-demo` (9c6f1789-253b-4813-b93a-7716373dcd96) wurde gebaut und hat
Chromium, PulseAudio und echte GPT-Live-Sitzungen erfolgreich ausgeführt.
Railway reicht für diese Laufzeit aus; ein VPS fehlt nicht.

Der Produktivdienst hat `AI_INTEGRATIONS_OPENAI_API_KEY`,
`AI_INTEGRATIONS_OPENAI_BASE_URL`, `OPENAI_PROJECT_ID` und `LUKAS_API_TOKEN`.
`OPENAI_API_KEY` existiert dort nicht unter diesem Namen. Der Worker verwendet
Variablenreferenzen auf die bestehenden OpenAI-Variablen; echte API-Anrufe
bestätigen deren Funktionsfähigkeit. Kein neuer Schlüssel ist erforderlich.
OAuth lieferte redigierte Werte, keine als sealed ausgewiesenen Variablen.
Schlüsselwerte wurden weder ausgegeben noch committed.

`LUKAS_API_TOKEN` schützt die private API insgesamt und ist kein Read-only-Token.
Der Voice-Worker bekommt ihn nicht. Ein separater einmaliger Prüfjob hatte nur
fest codierte GET-Suchen im Gedächtnis. Der öffentliche Zugriff ergab 403; über
das authentifizierte Railway-Privatnetz auf Port 8080 bestand die Prüfung.
Unter CorporateLLM, EVERLAST, Bewerbung, Eva und der Demo-ID wurde kein passendes
Demo-Briefing gefunden, nur ein älterer allgemeiner Kandidat. Keine abgeschnittenen
Suchergebnisse, keine Schreiboperation. Die Token-Referenz des Prüfjobs wurde
anschließend geleert. Der vollständige Kontext liegt privat in der Worker-Variable
`DEMO_CONTEXT_JSON` und lokal außerhalb des Repositorys.

Beide zusätzlichen Dienste haben keine öffentliche Domain und Restart NEVER.
Der Prüf-Dienst wird nach dem Audit für den lesenden Eva-Oberflächencheck verwendet;
er hat dabei kein produktives Token und keinen Modell-Key. Für einen separaten echten Netzwerkabbruchtest wurden OpenAI- und Kontextreferenzen kurzzeitig gesetzt und anschließend wieder geleert.

Railway-Einstellungen werden direkt am Dienst verwaltet. `Dockerfile` ist für
Railway; `Dockerfile.cloud` enthält nur für die verwaltete lokale Umgebung den
BuildKit-CA-Mount. Keine TLS-Prüfung wurde deaktiviert.

Geschützter Eingabeort bei späterem Schlüsselwechsel:
Railway → Projekt LUKAS → production → lukas-voice-demo → Variables → OPENAI_API_KEY.
Aktuell besteht dort die funktionierende Referenz; keine Eingabe nötig.

Deployment-Erfolg allein ist kein Testerfolg. Tatsächliche Ergebnisse stehen in
TEST-REPORT.md. Das echte Interview wurde nicht gestartet.
