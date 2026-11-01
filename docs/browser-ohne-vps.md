# Browser ohne VPS

`browse_page` und `browser_do` verwenden bei gesetzter `LUKAS_BROWSER_URL` den
separaten Dienst unter `services/browser`. Ein Ausfall führt nicht zu SSH oder
zu einer automatischen Wiederholung von Formularaktionen. Ohne die neue
Konfiguration bleibt der bisherige VPS-Adapter für andere Installationen erhalten.

Railway: eigener Dienst, Root `/services/browser`, Dockerfile `Dockerfile`,
Port 8080, Healthcheck `/healthz`, Volume `/data`, eine Instanz. Auf beiden
Diensten denselben zufälligen `LUKAS_BROWSER_TOKEN` setzen (mindestens 32 Zeichen).
Nur die Haupt-API bekommt `LUKAS_BROWSER_URL=http://<privater Host>:8080`.
Keine öffentliche Browser-Domain und keine SSH-, Datenbank- oder Modellschlüssel
an den Browser-Dienst geben. `LUKAS_BROWSER_STARTUP_CHECK=true` prüft von der
Haupt-API einmal je Start die komplette Render-Verbindung gegen example.com.

Sitzungsnamen wählen getrennte Profile. Geöffnete Seiten und Formulare bleiben
zwischen Werkzeugaufrufen erhalten. Nach zehn Minuten Inaktivität oder bei
Kapazitätsbedarf wird ein inaktives Profil geschlossen; Cookies/LocalStorage und
die letzte URL bleiben auf dem Volume. Ungesendete Formularinhalte überleben
keinen Neustart. Maximal zwei Aufträge gleichzeitig, drei offene Profile und
150 Sekunden je Auftrag. Keine automatische Wiederholung bei unklarem Ausgang.

Der Chromium-Prozess erhält keine Dienstschlüssel in seiner Umgebung. Sein
HTTP(S)-Verkehr läuft über einen Proxy, der ausschließlich öffentliche IPs auf
Port 80/443 zulässt und die geprüfte IP beim Verbindungsaufbau festhält. Das gilt
auch für Unterressourcen und Weiterleitungen. Interne Adressen, Dateien,
Metadaten-Endpunkte und URL-Zugangsdaten werden abgelehnt. Uploads sind auf
bereits vorhandene Dateien unter `/data/uploads` beschränkt; VPS-Pfade sind dort
nicht verfügbar. Geheimnisse werden erst im Browser-Dienst eingesetzt, im Text
redigiert und Screenshots für Sitzungen mit hinterlegten Geheimnissen unterdrückt.

`web_search` ist auch ohne Such-Schlüsselwort verfügbar. Scheitert die direkte
DuckDuckGo-Suche oder liefert sie keine lesbaren Treffer, werden Bing, Google und DuckDuckGo im Browser
versucht, bis verifizierbare Treffer vorliegen. CAPTCHA/Anmeldeschranken werden nicht umgangen; fehlende verifizierte
Ergebnisse werden als Fehler gemeldet. Dies repariert keinen fremden MCP-Server.

Prüfungen: `npm test --prefix services/browser` startet echten Chromium gegen
kontrollierte HTML-Fixtures (JS, Formulare über mehrere Aufrufe, Sitzungsisolation,
Persistenz, Geheimnisbehandlung). Der Docker-Build führt sie ebenfalls aus.
`check-browser-service.mjs` prüft API-Routing, Suche bei Providerfehlern und den
Ausschluss von SSH-Fallbacks. Die bestehende API-Typprüfung enthält diesen Check.
