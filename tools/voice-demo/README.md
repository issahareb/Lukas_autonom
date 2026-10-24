# Isolierte LUKAS-Voice-Demo

Stand 23.10.2026: Docker-Audio und echte OpenAI-Sprachgespräche auf Railway
getestet. Der echte Eva-Lauf wurde nicht gestartet; die manuelle Sicherheitsprüfung ist offen.
Ein VPS ist für den getesteten Browser-/Audio-Worker nicht erforderlich.

## Betrieb

Railway-Projekt LUKAS, Umgebung production, separater Dienst `lukas-voice-demo`:
Root Directory `/tools/voice-demo`, Dockerfile `Dockerfile`, Start Command
`/usr/bin/tini -- /app/operator-entrypoint.sh`, Restart Policy NEVER,
2 vCPU / 2 GB. Das gepinnte Deployment aus Branch `codex/isolated-voice-demo`
öffnet das geschützte Vorbereitungsfenster. Ein Redeploy startet weder Modell noch Interview. Für einen zusätzlichen Simulatorlauf kann der Start Command ausdrücklich auf `/usr/bin/tini -- /app/entrypoint.sh railway_test.py` gesetzt werden; dieser Modelltest ist kostenpflichtig.

Geschützte Variables:

- `OPENAI_API_KEY`: Referenz `${{Portfolio_v2.AI_INTEGRATIONS_OPENAI_API_KEY}}`
- `OPENAI_BASE_URL`: Referenz `${{Portfolio_v2.AI_INTEGRATIONS_OPENAI_BASE_URL}}`
- `OPENAI_PROJECT_ID`: Referenz `${{Portfolio_v2.OPENAI_PROJECT_ID}}`
- `DEMO_CONTEXT_JSON`: privat gespeicherter, geprüfter Bewerbungskontext.

Keine Schlüssel im Chat, Repository, Build-ARG oder Browser hinterlegen.
`LUKAS_API_TOKEN` ist weitreichend und wird dem Voice-Worker nicht übergeben.

## Start und Stopp

Lokaler Start mit geschützt bereitgestelltem Key und privatem Kontext:

```sh
cd /workspace/Lukas_autonom/tools/voice-demo
. /workspace/demo-private/runtime.env
python worker.py --context /workspace/demo-private/application-context.json \
  --private-dir /workspace/demo-private --max-seconds 660
```

Ohne `--test-script` wartet der lokale Simulator auf Audio. Für reproduzierbare
Fragen zusätzlich `--test-script /workspace/demo-private/questions/script.json`.
Bei nicht laufendem PulseAudio zuerst `/workspace/demo-private/start-audio.sh`.

Status und sofortiger Stopp aus derselben Laufzeit:

```sh
python control.py status --private-dir /workspace/demo-private
python control.py stop --private-dir /workspace/demo-private
```

Im Railway-Testcontainer ist das private Verzeichnis `/tmp/lukas-demo-private`.
Die Befehle dort über eine autorisierte Railway-Shell ausführen. Alternativ den
Deployment-Stopp im Railway-Dashboard verwenden. SIGTERM beendet lokale Audio-
und Browserprozesse; die Modellschließung wird bis zu 15 Sekunden bestätigt.
`provider_finalized=false` bedeutet ausdrücklich keine bestätigte Remote-Schließung.
Die lokale Steuerseite http://127.0.0.1:8765 enthält Status und Stopp-Schalter;
ihr kurzlebiges Token liegt nur in `control.token`, nicht in Logs/URL-Parametern.
Die direkte Steuer-API bleibt lokal; die separate HTTPS-Bedienseite ist passwortgeschützt.

Maximal 660 Sekunden pro Worker, Testlauf 300 Sekunden, Stille-Timeout 90 Sekunden,
kein automatischer Wiederanruf. GPT-Live-Dokumentation: 0,05 USD/Minute;
11 Minuten entsprechen ungefähr 0,55 USD Modellzeit, zuzüglich Railway.
Dies ist ein Laufzeitlimit, keine kontoübergreifende harte Kostenobergrenze.

## Signalweg und Isolation

Browser → eva_out.monitor → parec PCM16/24 kHz mono → GPT-Live WebSocket →
pacat → lukas_out.monitor → eva_mic → Browser. Pulse-Geräte laufen mit 48 kHz.
Keine Mikrofon-Lautsprecher-Rückführung. Lokale Turn-Erkennung verwirft beim
Unterbrechen gepufferte Ausgabe, ohne die ersten Eingangsframes abzuschneiden.

Der gleiche GPT-Live-Anbieter wie in LUKAS wird in einem separaten Worker genutzt.
Das ist eine isolierte Demo-Persona mit LUKAS-Kontext, keine Freigabe des
produktiven Owner-Agenten. Es gibt keinen Tool-Dispatcher. Interne Rückfragen
bekommen ausschließlich geprüfte lokale Fakten, in kurzen API-konformen Teilen.
Keine zusätzliche dauerhafte Audioaufzeichnung; Test-WAVs sind synthetische Fragen.

## Eva

`python eva_probe.py` lädt ausschließlich die reguläre Danke-Seite, wählt nur
notwendige Cookies und öffnet das Interviewfenster. Es bestätigt keine Einwilligung
und startet kein Gespräch. Cloudflare-Sicherheitsprüfungen werden nicht bedient.

`--eva-review PRIVATE.json --browser-state PRIVATE.json` ist eine vorbereitete,
noch nicht durch einen echten Eva-Audiolauf abgenommene Anbindung. Sie benötigt
die bestehende Bewerbungszuordnung, bestandene Tests, explizite Einwilligungen,
den geprüften Oberflächen-Hash und die reguläre Mikrofon-Vorprüfung. Ein frischer
Browser mit leeren Identitätsfeldern oder ungelöster Sicherheitsprüfung hält an.
Ein Playwright-Storage-State allein enthält kein sessionStorage; die bestehende
Bewerbungszuordnung darf nicht erfunden oder durch eine neue Bewerbung ersetzt werden.

Die tatsächliche Widget-Audioinitialisierung nach diesen Sperren ist noch offen.
Keine automatische Freigabe durch erfundene `true`-Werte im Review-Bericht.
Siehe TEST-REPORT.md und RAILWAY-STATUS.md.

## Geschützter Bedienzugang (Fortsetzung)

https://lukas-voice-demo-production.up.railway.app

Benutzername `issa`. Das eigene Bedienpasswort steht ausschließlich unter
Railway → LUKAS → production → lukas-voice-demo → Variables →
`DEMO_OPERATOR_PASSWORD`. Es ist kein OpenAI-Key und kein LUKAS-Owner-Token.
Nicht in den Chat kopieren. Der Zugang läuft pro Deployment nach einer Stunde ab;
ein Modellgespräch ist zusätzlich auf elf Minuten begrenzt.

1. Anmelden und die echte Browseransicht prüfen. Die ausdrücklich freigegebenen
   Einwilligungen sowie die bestätigten Identitätsdaten werden im normalen
   Interviewformular vorbelegt. Keine Bewerbung wird abgeschickt.
2. Eine angezeigte Cloudflare-Prüfung selbst im Browserbild bedienen. Falls die
   Seite dadurch erst zugänglich wird, „Interviewfenster vorbereiten“ drücken.
3. „LUKAS verbinden“ erst nach erfolgreicher Vorbereitung. Der private Kontext
   wird vor der Modellsitzung geladen. Der Browser bleibt derselbe; Cookies und
   Sicherheitsprüfung werden nicht exportiert oder erfunden.
4. Reguläre Mikrofon-Vorprüfung der Eva-Oberfläche bedienen. Der Knopf
   „4 Sekunden Mikrofon-Testton“ prüft ausschließlich das virtuelle Mikrofon
   vor dem Interview; danach ist er gesperrt.
5. Den echten Start ausschließlich in der regulären Interviewoberfläche auslösen.
   Der Worker erlaubt höchstens einen Widget-Session-Anlegeversuch pro Lauf und
   blockiert neue Bewerbungen sowie den alten Telefonanrufpfad. Fehler bei der
   Bewerbungszuordnung nicht durch eine neue Bewerbung oder Wiederholungsversuche lösen.
6. „Sofort stoppen“ beendet Browser und Audio; die Modellschließung wird separat
   bestätigt. Ein Klick auf Start ist keine Abschlussbestätigung.

Railway-Start Command für diesen bedienbaren Modus:
`/usr/bin/tini -- /app/operator-entrypoint.sh`. Ein Redeploy öffnet nur das
Vorbereitungsfenster; weder Modell noch echtes Interview starten automatisch.
Der frühere Simulator-Start bleibt über `railway_test.py` verfügbar.

Zusätzliche private Variablen: `DEMO_APPLICANT_JSON`, `DEMO_CONSENT_JSON`,
`DEMO_OPERATOR_PASSWORD`. Sie werden weder committed noch an Chromium als
Umgebungsvariablen weitergereicht. Das Browserbild und die Steuerung benötigen
Authentifizierung; Zugriffslogs der Bedienanwendung sind deaktiviert.


### Latenzvergleich und Inhaltsbeginn

Authentifizierte POST-Aktionen `voice-test-baseline` und `voice-test` spielen
je dieselben fünf lokalen Fragen ab. Jede Variante ist einmal pro Prozess
zulässig; Tests dürfen nicht parallel oder während eines Interviews laufen.
Baseline verwendet die frühere Faktenübergabe und Audio-Unterdrückung.
Die reguläre Verbindung nutzt gezielte Fakten und puffert den Antwortbeginn
während der kurzen Stille nach einer Unterbrechung. Die Vorstellung benennt
LUKAS ausdrücklich als KI-Agent, ohne nach Erlaubnis zur Übernahme zu fragen.
Ausdrückliche Ablehnung bzw. eine Pflicht zur persönlichen Durchführung gilt weiter.

`test-report.json` unterscheidet Browser-Frageende, erstes stimmhaftes
Provider-Audio, Übergabe an PulseAudio und Erkennung am Browsermikrofon.
Die Browseruhr wird gegen die monotone Prozessuhr kalibriert; die halbe
Messdauer wird als Unsicherheit angegeben. WebSocket-Ping ist nur RTT,
keine separate Messung der Modelllaufzeit. Browsermessung: 10-ms-Abtastung
mit 2048 Samples bei 48 kHz, daher keine samplegenauen Zeitangaben.

Wortzeitstempel aus `content-timing.json` sind rohe ASR-Schätzungen und können
halluzinieren oder vor dem tatsächlichen Tonbeginn liegen. Sie sind KEINE
validierten Messwerte. `content-review.json` entfernt diese aus dem Bericht
und schätzt den Inhaltsbeginn konservativ aus aufgenommenen Sprachabschnitten,
wobei reine Füllsätze ausgeschlossen werden. Gemischte und unterbrochene
Abschnitte bleiben ungeklärt. Menschliche Hörprüfung bleibt erforderlich.
Die authentifizierte Aktion `review-test-timing` kann bestehende abgeschlossene
Vergleichstests ohne neue API-Aufrufe prüfen; Originalberichte bleiben erhalten.
Alle Aufnahmen, Transkripte und Diagnoseberichte bleiben privat. Der echte
Interviewstart bleibt durch `DEMO_REAL_INTERVIEW_ENABLED=0` gesperrt.
