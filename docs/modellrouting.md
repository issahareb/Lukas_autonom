# Modellrouting und Kosten

Die Auswahl erfolgt lokal, ohne zusaetzlichen Modellaufruf.

| Aufgabe | Profil | Standard | Ausgabe inkl. Denken |
|---|---|---|---:|
| Kurze Fragen und Definitionen | fast | gpt-6.1-terra | 2048 |
| Allgemeine Unterhaltung | general | gpt-6.1-terra | 4096 |
| Bilder/Video/PDF | vision | gpt-6.1-terra | 4096 |
| Analyse/Planung | reasoning | gpt-6.1-sol | 16384 |
| Code/Debugging | code | gpt-6.1-sol | 16384 |
| Eingaben ueber 12000 Zeichen | long_context | gpt-6.1-sol | 16384 |

„Was ist Python?“ bleibt auf 6.1 Terra, „Fix den Fehler in router.ts“ geht auf 6.1 Sol. Kurze Fortsetzungen verwenden den vorherigen Auftrag; neue Themen erben nicht dessen teures Profil. Das ist eine Heuristik, kein Qualitaetsbeweis. Bei Bildern/PDFs hat Eingabefaehigkeit Vorrang.

Astra ist kein Standard und kein Verfuegbarkeitsersatz. Nur schwere Profile (code/reasoning/long_context) duerfen nach wiederholtem belegtem Stillstand eskalieren. LUKAS_ASTRA_ESCALATION=false schaltet das ab. Alle Profile sind ueber LUKAS_MODEL_<PROFIL> konfigurierbar. Den alten LUKAS_CORE_MODEL-Override fuer automatische Auswahl leer lassen. LUKAS_PUBLIC_MODEL steuert nur das Portfolio-Widget.

## Ersatz und Verfuegbarkeit

Unverfuegbare IDs werden pro Provider eine Stunde uebersprungen. Einfache Profile fallen auf 6.1 Sol, schwere auf 6.1 Terra zurueck. LUKAS_MODEL_FALLBACK_<PROFIL> setzt einen eigenen Ersatz. Jeder Kandidat wird hoechstens einmal versucht; OpenAI-Auth-, Quoten-, Rate-Limit-, Server- und normale Payloadfehler loesen keinen Modellwechsel aus. SDK-Transportwiederholungen bleiben davon getrennt.

Die 6-/6.1-IDs sind im offiziellen SDK aufgefuehrt: https://github.com/openai/openai-node/blob/main/src/resources/shared.ts (2026-10-01). Die Freischaltung im produktiven Account wurde dadurch nicht bewiesen. Auch Ersatzmodelle brauchen Zugriff.

## Tokenverbrauch

- Fertige Antworten werden direkt ausgegeben. LUKAS_VOICE_POLISH=true aktiviert einen optionalen zweiten Formulierungsaufruf mit 6.1 Terra.
- GPT-5/6: low Reasoning bei einfachen, medium bei schweren Profilen. Optional LUKAS_REASONING_EFFORT_<PROFIL>=none|low|medium|high|xhigh|max.
- Aufruflimit vor Profil- vor globalem Limit. Ausgabelimits begrenzen auch Denken; zu kleine Limits koennen Antworten verhindern. Limits sind keine vorab berechneten Kosten.
- Alte Werkzeugergebnisse werden in allen zentralen Pfaden verdichtet, auch im Dashboard.
- Alte Dialogzuege werden ganz entfernt, aktuelle Nutzerfragen und Werkzeugpaare bleiben zusammen. Systemprompt/aktueller Zug duerfen das Kontextziel von 60000 Zeichen ueberschreiten. Die Originalhistorie bleibt erhalten.
- Reflexion, Moltbook und Studio-Prompts verwenden denselben Client samt Providerwahl, Ersatz und Verbrauchserfassung.
- Der Tageszaehler erfasst frische Eingabe, Cache-Lesen/-Schreiben und Ausgabe jeweils einmal. Fuer bezahltes kompatibles Hosting LUKAS_LOCAL_BILLABLE=true setzen.

Das Tagesbudget misst Tokens, keine Euro. Ohne LUKAS_TAGESBUDGET_STOPP bleibt der Tagesstopp deaktiviert; er pausiert autonome Laeufe, nicht private Nutzerauftraege. Laufende Zuege koennen die Schwelle ueberschreiten. Realtime-Sprache und das oeffentliche Portfolio-Widget haben eigene Modellpfade. Konkrete Euroersparnisse brauchen produktive Verbrauchsdaten und aktuelle Anbieterpreise.

## Verifikation

npm run typecheck -w @workspace/api-server prueft Profilwahl, Request-Limits, Reasoning, Ersatzmodelle, Sperrablauf, optionale Politur, Kontext und Buchhaltung. CI verwendet Providerattrappen, keine kostenpflichtigen Live-Aufrufe.

npm run models:check -w @workspace/api-server liest mit dem Deployment-Key nur den OpenAI-Modellkatalog und zeigt konfigurierte Primaer-/Ersatzmodelle. Im Deployment oder mit Projekt-.env ausfuehren. Keine Generierung und keine Keys in der Ausgabe. Andere Provider bleiben separat zu pruefen. Eine gelistete ID ersetzt keinen Live-Funktionstest mit Werkzeugen.

## Denkaufwand und Verarbeitungsstufe

Alle neuen Standardpfade und Verfuegbarkeitsersatzpfade nutzen 6.1 Terra/Sol. Explizite bestehende Profil-Overrides bleiben erhalten. Die spezialisierten Live-Audio-Modelle werden nicht durch Textmodelle ersetzt.

- Leichte Profile starten low, schwere medium. `none` gilt nur fuer Terra, Sol/Astra erhalten mindestens low. Der UI-Alias `ultra` wird explizit auf `max` abgebildet; er aktiviert weder Ultrafast noch Parallelagenten.
- Dashboard und nicht-streamende Arbeitsschleife erkennen identische aufeinanderfolgende Lese-Batches mit identischen Ergebnissen. Nach je zwei weiteren Wiederholungen steigt der Denkaufwand. Schwere Profile erreichen erst high, xhigh und max; Astra wird fruehestens nach zehn unveraenderten Wiederholungen eingesetzt. Neue Ergebnisse setzen das Signal zurueck. Shell-/Schreibaufrufe, Fehler, Freigabe- und Zugangsbarrieren sind keine Eskalationsbelege. Das ist eine konservative Wiederholungsheuristik, keine allgemeine Erfolgspruefung.
- Vordergrund nutzt explizit Standard (`default`). Zeitunkritische Quellen autonomie/reflexion/moltbook verwenden Flex. `LUKAS_SERVICE_TIER_<QUELLE>` gewinnt gegen `LUKAS_SERVICE_TIER`; Fast ist gezielt zuschaltbar. Ultrafast wird nur fuer 6.1 Sol/Astra gesendet, auf Terra auf Standard begrenzt. Telefon/Sprache verwenden niemals Flex. Nichtstandardstufen nur fuer dokumentierte moderne OpenAI-Modelle.
- Ein Flex-Kapazitaetsfehler bleibt ein sichtbarer Fehler; kein stiller teurerer Wiederholungsaufruf. Auth-, Budget- oder Rate-Limitfehler eskalieren nicht das Modell.
- Jeder zentrale OpenAI-Aufruf speichert Denkaufwand, angeforderte und vom Anbieter gemeldete Verarbeitungsstufe sowie Routing-/Eskalationsgrund im bestehenden JSON-Beleg. Fehlende Anbieterfelder bleiben unbekannt. Rohbelege sind ueber den geschuetzten Fallstudienexport verfuegbar. Geschwindigkeit ist kein Nachweis besserer Ergebnisqualitaet.

Offizielle Kompatibilitaetsquellen (Stand 2026-11-07):
- https://developers.openai.com/api/docs/guides/latest-model
- https://developers.openai.com/api/docs/guides/fast-mode
- https://developers.openai.com/api/docs/guides/ultrafast-mode
- https://developers.openai.com/api/docs/guides/flex-processing
