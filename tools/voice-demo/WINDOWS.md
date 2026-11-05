# Windows: lokaler Browser und LUKAS als Mikrofon

Eva läuft später im selbst bedienten Chrome auf dem PC. Edge öffnet die
geschützte LUKAS-Sprachseite. Railway stellt nur den begrenzten Demo-Kontext,
die Modellverbindung und das private Archiv bereit. Telnyx ist hier nicht beteiligt.
Die vorhandene Owner-Telefonie und der produktive Chat werden nicht freigegeben.

## Zuerst mit Mikrofon und Kopfhörern testen

1. In aktuellem Microsoft Edge `https://lukas-voice-demo-production.up.railway.app/pc`
   öffnen. Benutzer `issa`, vorhandenes Bedienpasswort. Falls nötig liegt es unter
   Railway → Projekt LUKAS → production → lukas-voice-demo → Variables →
   `DEMO_OPERATOR_PASSWORD`. Nicht in Chat oder URL eintragen.
2. „Audiogeräte freigeben und laden“ anklicken. Das eigene Mikrofon als Eingang,
   Kopfhörer als Ausgabe wählen. Aufnahme bestätigen, LUKAS starten.
3. Nach Vorstellung, Arbeitsweise und einem Projekt fragen. Unbekannte Zahlen
   muss LUKAS als unbekannt kennzeichnen. Während einer Antwort unterbrechen.
4. „Sofort stoppen“ beendet lokale Ausgabe und Mikrofon. Den bestätigten
   Sitzungsabschluss abwarten; danach Aufnahme und automatische Abschrift laden.
   Letztere bleibt bis zur Hörprüfung ein Entwurf.

## Zwei getrennte virtuelle Audiowege

[Voicemeeter Banana vom Hersteller](https://vb-audio.com/Voicemeeter/banana.htm)
installieren und Windows neu starten. Banana bietet die beiden benötigten Busse
B1 und B2. A1 auf Kopfhörer stellen.

| Anwendung | Ausgabe | Mikrofon/Eingang |
| --- | --- | --- |
| Chrome: zunächst Testpartner, später Eva | Voicemeeter Input | Voicemeeter Out B2 |
| Edge: LUKAS-PC-Seite | Voicemeeter AUX Input | Voicemeeter Out B1 |

Ältere Treibernamen: B1 = „Voicemeeter Output“, B2 = „Voicemeeter AUX Output“.
VAIO-Strip: **B1 an, B2 aus**. AUX-Strip: **B2 an, B1 aus**.
A1 kann bei beiden an sein, damit beide Stimmen im Kopfhörer hörbar sind.
Kein Hardware-Mikrofon auf B1/B2 mischen, Windows „Dieses Gerät als
Wiedergabequelle verwenden“ ausschalten. Keine Lautsprecher für den Test nutzen.

Chromes Ausgabe unter Windows → System → Sound → Lautstärkemixer einstellen.
Die LUKAS-Seite hat eigene Eingangs- und Ausgangswahl. In Eva B2 in der
regulären Mikrofonwahl wählen; ohne solche Auswahl Chrome → Einstellungen →
Datenschutz und Sicherheit → Website-Einstellungen → Mikrofon verwenden.

## Vollständiger Test ohne Eva

In Chrome `https://lukas-voice-demo-production.up.railway.app/pc/partner` öffnen.
B2 auswählen und „Empfang prüfen“ aktivieren. In Edge LUKAS mit B1/AUX starten.
Die Testpartner-Fragen einzeln abspielen. Während der Frage muss B1 an LUKAS
ausschlagen und B2 still bleiben. Bei LUKAS' Antwort muss B2 am Testpartner
ausschlagen und B1 still bleiben. So wird die tatsächliche Windows-Trennung
geprüft; ein Server-Test allein kann das nicht belegen.

Frage 3 während einer laufenden Antwort abspielen: alte Ausgabe muss abbrechen,
neue Frage vollständig verarbeitet werden. Beide Stimmen über A1 anhören.
LUKAS in Edge stoppen und danach den Testpartner stoppen. Testaufnahme privat
laden und beide Spuren anhören. „Eva.wav“ enthält in diesem Test die Testfragen.

## Zugang und Grenzen

Die neue PC-Seite bietet ausschließlich technische Tests. Sie öffnet, verifiziert
oder startet Eva nicht. Ein normaler lokaler Browser kann die reguläre
Cloudflare-Prüfung bestehen; das ist nicht garantiert. Keine Challenge-Cookies
exportieren oder Schutzmechanismen umgehen. Keine neue Bewerbung absenden.
Der echte Interviewstart bleibt serverseitig deaktiviert und darf auch im
lokalen Chrome noch nicht betätigt werden. Vor einem echten Lauf sind Zugang,
Einwilligungen und die vollständige Verbindung separat zu bestätigen.

Serverseitig: `DEMO_PC_ONLY=1`, `DEMO_REAL_INTERVIEW_ENABLED=0`, vorhandene
geschützte OpenAI-Referenzen und das private Volume `/data`. Der PC erhält
keinen API-Key und keinen LUKAS-Owner-Token. Maximal drei manuell gestartete
Tests pro Dienststart, jeweils elf Minuten; Stille-Timeout 90 Sekunden.
Das Portal bleibt für Einrichtung und Downloads erreichbar, auch wenn gerade
keine Sprachsitzung läuft. Kein automatischer Interview- oder Modellstart.

Aufnahme: PCM16, 24 kHz mono, getrennte Eingangs- und gerenderte Ausgangsspur
mit gemeinsamem Sampletakt. Der Ausgang wird vor dem Windows-Treiber erfasst;
das beweist allein noch keinen Empfang bei Eva. Verbindungsverlust stoppt die
Sitzung, kann aber letzte Audioframes verlieren. Das Archiv kennzeichnet den
Endgrund; automatische Texte ergänzen keine nachgewiesen fehlenden Wörter.
Downloads und WebSocket-Sitzungsreservierung benötigen Authentifizierung;
kurzlebige Einmaltickets werden nur als HttpOnly-Cookie übertragen.
