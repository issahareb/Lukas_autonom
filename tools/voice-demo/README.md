# Isolierte LUKAS-Voice-Demo

Stand 23.10.2026: Docker-Audio und echte OpenAI-Sprachgespräche auf Railway
getestet. Der echte Eva-Lauf ist noch nicht freigegeben und wurde nicht gestartet.
Ein VPS ist für den getesteten Browser-/Audio-Worker nicht erforderlich.

## Betrieb

Railway-Projekt LUKAS, Umgebung production, separater Dienst `lukas-voice-demo`:
Root Directory `/tools/voice-demo`, Dockerfile `Dockerfile`, Start Command
`/usr/bin/tini -- /app/entrypoint.sh railway_test.py`, Restart Policy NEVER,
2 vCPU / 2 GB. Das gepinnte Deployment aus Branch `codex/isolated-voice-demo`
führt einmalig den Simulator aus und beendet sich. Ein Redeploy startet einen
weiteren kostenpflichtigen Modelltest, niemals das echte Interview.

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
Keine öffentlich zugängliche Steuerdomain ist eingerichtet.

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
