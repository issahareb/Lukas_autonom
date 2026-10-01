# Modellrouting und Kosten

Die Auswahl erfolgt lokal, ohne zusaetzlichen Modellaufruf.

| Aufgabe | Profil | Standard | Ausgabe inkl. Denken |
|---|---|---|---:|
| Kurze Fragen und Definitionen | fast | gpt-6-luna | 2048 |
| Allgemeine Unterhaltung | general | gpt-5.6-terra | 4096 |
| Bilder/Video/PDF | vision | gpt-5.6-terra | 4096 |
| Analyse/Planung | reasoning | gpt-6-sol | 16384 |
| Code/Debugging | code | gpt-6.1-sol | 16384 |
| Eingaben ueber 12000 Zeichen | long_context | gpt-6.1-sol | 16384 |

„Was ist Python?“ bleibt auf Luna, „Fix den Fehler in router.ts“ geht auf 6.1 Sol. Kurze Fortsetzungen verwenden den vorherigen Auftrag; neue Themen erben nicht dessen teures Profil. Das ist eine Heuristik, kein Qualitaetsbeweis. Bei Bildern/PDFs hat Eingabefaehigkeit Vorrang.

Astra ist bewusst kein Standard und kein automatischer Ersatz fuer einfache Fragen. Explizit waehlbar mit LUKAS_MODEL_REASONING=openai:gpt-6-astra. Alle Profile sind ueber LUKAS_MODEL_<PROFIL> konfigurierbar. Den alten LUKAS_CORE_MODEL-Override fuer automatische Auswahl leer lassen. LUKAS_PUBLIC_MODEL steuert nur das Portfolio-Widget.

## Ersatz und Verfuegbarkeit

Unverfuegbare IDs werden pro Provider eine Stunde uebersprungen. Einfache Profile fallen auf gpt-4.1-mini, schwere auf gpt-4.1 zurueck (dort ggf. zuerst ein expliziter CORE). LUKAS_MODEL_FALLBACK_<PROFIL> setzt einen eigenen Ersatz. Jeder Kandidat wird hoechstens einmal versucht; OpenAI-Auth-, Quoten-, Rate-Limit-, Server- und normale Payloadfehler loesen keinen Modellwechsel aus. SDK-Transportwiederholungen bleiben davon getrennt.

Die 6-/6.1-IDs sind im offiziellen SDK aufgefuehrt: https://github.com/openai/openai-node/blob/main/src/resources/shared.ts (2026-10-01). Die Freischaltung im produktiven Account wurde dadurch nicht bewiesen. Auch Ersatzmodelle brauchen Zugriff.

## Tokenverbrauch

- Fertige Antworten werden direkt ausgegeben. LUKAS_VOICE_POLISH=true aktiviert einen optionalen zweiten Formulierungsaufruf mit Luna.
- GPT-5/6: low Reasoning bei einfachen, medium bei schweren Profilen. Optional LUKAS_REASONING_EFFORT_<PROFIL>=low|medium|high.
- Aufruflimit vor Profil- vor globalem Limit. Ausgabelimits begrenzen auch Denken; zu kleine Limits koennen Antworten verhindern. Limits sind keine vorab berechneten Kosten.
- Alte Werkzeugergebnisse werden in allen zentralen Pfaden verdichtet, auch im Dashboard.
- Alte Dialogzuege werden ganz entfernt, aktuelle Nutzerfragen und Werkzeugpaare bleiben zusammen. Systemprompt/aktueller Zug duerfen das Kontextziel von 60000 Zeichen ueberschreiten. Die Originalhistorie bleibt erhalten.
- Reflexion, Moltbook und Studio-Prompts verwenden denselben Client samt Providerwahl, Ersatz und Verbrauchserfassung.
- Der Tageszaehler erfasst frische Eingabe, Cache-Lesen/-Schreiben und Ausgabe jeweils einmal. Fuer bezahltes kompatibles Hosting LUKAS_LOCAL_BILLABLE=true setzen.

Das Tagesbudget misst Tokens, keine Euro. Ohne LUKAS_TAGESBUDGET_STOPP bleibt der Tagesstopp deaktiviert; er pausiert autonome Laeufe, nicht private Nutzerauftraege. Laufende Zuege koennen die Schwelle ueberschreiten. Realtime-Sprache und das oeffentliche Portfolio-Widget haben eigene Modellpfade. Konkrete Euroersparnisse brauchen produktive Verbrauchsdaten und aktuelle Anbieterpreise.

## Verifikation

npm run typecheck -w @workspace/api-server prueft Profilwahl, Request-Limits, Reasoning, Ersatzmodelle, Sperrablauf, optionale Politur, Kontext und Buchhaltung. CI verwendet Providerattrappen, keine kostenpflichtigen Live-Aufrufe.

npm run models:check -w @workspace/api-server liest mit dem Deployment-Key nur den OpenAI-Modellkatalog und zeigt konfigurierte Primaer-/Ersatzmodelle. Im Deployment oder mit Projekt-.env ausfuehren. Keine Generierung und keine Keys in der Ausgabe. Andere Provider bleiben separat zu pruefen. Eine gelistete ID ersetzt keinen Live-Funktionstest mit Werkzeugen.
