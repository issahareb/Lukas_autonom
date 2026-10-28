# PC-Sprachbrücke – Prüfstand 28.10.2026

Lokale Prüfung unter Linux mit echtem Chromium, simuliertem Sprachanbieter und
synthetischem Mikrofon. Kein Eva-Aufruf und kein echter Interviewstart.

`python -m unittest test_pc_voice test_operator.TestOperatorSecurity test_archive test_eva_surface test_latency -v`

17 Tests bestanden (13,739 Sekunden):

- Browser: getUserMedia, AudioWorklet, WebSocket, PCM-Wiedergabe und aufgezeichnete Renderausgabe.
- Privater Kontext wird vor Audio gesendet; keine Owner-Tools im Sitzungsauftrag.
- Eingangs- und Ausgangsspur getrennt; eigene Ausgangsdaten werden nicht an den Modelleingang zurückgeführt.
- Unterbrechung verwirft ältere Ausgabe; Antwortanfang wird während kurzer VAD-Nachlaufzeit gepuffert.
- Stopp beendet Ausgabe, Mikrofon und Provider-Sitzung; Verbindungsabbruch schließt den simulierten Provider.
- Falsche Framefolge wird abgebrochen und als Fehler dokumentiert.
- Authentifizierung, Einmalticket, Aufnahmefreigabe, HTTPS-Origin und gesperrter Interviewmodus.
- Neustart einer lokalen Anwendungsinstanz: fertige WAVs und Archiv weiterhin authentifiziert abrufbar; ohne Anmeldung HTTP 401.
- Bestehende Interview-/Bewerbungssperren und gezielte Faktenübergabe.

Grenzen: Kein Nachweis der tatsächlichen Windows-/Voicemeeter-Treiber, keiner
physischen Lautsprecherausgabe, keiner Eva-Verbindung und keiner Cloudflare-
Freigabe. Der lokale Provider ist simuliert, daher keine Modellqualität oder
Modelllatenz aus diesen Tests ableitbar. Railway- und echte Modelltests werden
separat mit ihren tatsächlichen Ergebnissen dokumentiert. Die automatische
Abschrift ist bis zum Abhören beider Tonspuren ein ungeprüfter Entwurf.
