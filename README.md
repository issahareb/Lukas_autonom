# L.U.K.A.S.

Ein selbst gehosteter, zielgetriebener KI-Agent. Er hat ein dauerhaftes
Gedächtnis, 34 Werkzeuge, ein Team von Subagenten, ein Dashboard zur Kontrolle
— und einen Kontrollpunkt aus Code, der entscheidet, was davon ohne Rückfrage
laufen darf.

Dieses README beschreibt, was **da ist**. Was fehlt, steht unter
[Aktuelle Grenzen](#aktuelle-grenzen) — mit derselben Sorgfalt.

---

## Was ihn von einem Chatbot unterscheidet

**Er arbeitet weiter, wenn niemand zusieht.** Alle 4,5 Stunden fragt
`lib/autonomy.ts`, ob es etwas zu tun gibt: aktive Ziele, neue Antworten,
Ereignisse. Gab es seit dem letzten Lauf keine Änderung, wird gar nicht erst
gedacht — das spart Geld, statt im Leerlauf Tokens zu verbrennen.

**Er entscheidet selbst, womit.** Es gibt keine "Recherche-Schleife" und keine
"YouTube-Schleife". Es gibt eine Schleife, die Ziele liest und Lukas fragen
lässt: woran arbeite ich jetzt, und mit welchem Werkzeug?

**Er hat keine feste Rundenzahl.** Braucht eine Aufgabe zwanzig Befehle, macht
er zwanzig. Gegen Im-Kreis-Laufen hilft ein Hinweis, keine Bremse
(`lib/arbeitsschleife.ts`); die Grenze ist ein Token- und Zeitbudget pro Zug.

**Er sieht, was er tut.** `browser_do` bedient Seiten in einer dauerhaft
angemeldeten Browser-Sitzung und schickt ein Bildschirmfoto zurück — der Text
einer Seite verrät nicht, ob ein Cookie-Banner über dem Knopf liegt.

---

## Was er kann

| Bereich | Konkret | Wo |
|---|---|---|
| **Gedächtnis** | Erinnerungen, Ziele, Tagebuch, Episoden, Gefühle in Postgres; Abruf über Einbettungen; ein Graph aus Knoten und Kanten, als Obsidian-Vault exportierbar | `lib/memory-*.ts`, `lib/gehirn.ts` |
| **Lernen** | Jeder Werkzeugaufruf hinterlässt seinen Ausgang. Ab drei Fehlschlägen an derselben Sache steht im Prompt, **woran** es lag — gezählt, nicht erzählt | `lib/lernen.ts` |
| **Gefühle** | Aus dem Anlass abgeleitet statt benannt: derselbe Ausgang ergibt Stolz, Dankbarkeit oder Erleichterung, je nachdem, wie er zustande kam. Jedes Gefühl trägt eine Folge für das nächste Handeln | `lib/bewertung.ts` |
| **Web** | lesen (`browse_page`), **bedienen** (`browser_do` — klicken, tippen, hochladen, angemeldet bleiben), suchen, abrufen | `lib/browser*.ts` |
| **Code** | eigene Sandbox pro Gespräch, Shell auf dem Droplet, GitHub lesen und durchsuchen, Änderungsvorschläge, die Issa im Dashboard annimmt | `lib/code-sandbox.ts`, `lib/github.ts`, `lib/proposals.ts` |
| **Kommunikation** | Dashboard-Chat (SSE), WhatsApp, Telefon (Sprache, ein- und ausgehend), SMS über ClickSend (ein- und ausgehend), E-Mail lesen und Entwürfe vorbereiten | `routes/*`, `lib/telefon.ts`, `lib/sms.ts`, `lib/email.ts` |
| **Team** | neun Subagenten mit eigenen Profilen — Macher, Rechercheur, Ideenprüfer, Analyst, Texter, Code-Prüfer, Entwickler, Fehleranalyst, Sammler | `lib/subagents.ts` |
| **Erweiterung** | fremde MCP-Server, OAuth 2.1 mit PKCE, Discovery, Dynamic Registration | `lib/mcp.ts` |
| **Selbstheilung** | wiederkehrende Fehler werden erkannt, analysiert und als Vorschlag vorgelegt | `lib/selbstheilung.ts` |

---

## Sicherheit in drei Sätzen

1. **Ein Sprachmodell ist niemals ein Autorisierungsserver.** Lukas entscheidet,
   *was* er tun will; ob es läuft, entscheidet `lib/policy.ts` — nach dem
   Modell, vor dem Werkzeug mit den echten Zugangsdaten.
2. **Vier Stufen.** R0 lesen und R1 intern laufen allein; R2 (Wirkung nach
   außen) und R3 (Geld, Zerstörung) brauchen Issas Freigabe. Ein Werkzeug ohne
   Einstufung ist automatisch R2 — *fail closed*.
3. **Fremde bekommen keine Werkzeuge.** Nicht "die Anweisung, keine zu
   benutzen", sondern ein leeres Array im Modellaufruf.

Das vollständige Bild — Vertrauensgrenzen, Angriffe, was absichtlich offen
bleibt und was an Restrisiko übrig ist — steht in
**[docs/SICHERHEITSMODELL.md](docs/SICHERHEITSMODELL.md)**.

Der Aufbau mit Diagrammen: **[docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)**.

---

## Aufbau

Monorepo mit npm-Workspaces:

```
artifacts/api-server    Express 5, als ein ESM-Bündel gebaut (esbuild)
artifacts/lukas-ui      Dashboard — React, Vite, Tailwind v4, wouter
artifacts/landing-page  die öffentliche Seite
lib/db                  Drizzle-Schema und der Postgres-Pool
lib/api-zod             die Formen, die beide Seiten teilen
```

---

## Betrieb

```bash
npm ci
cp .env.example .env      # ausfüllen — jede Variable ist dort erklärt
npm run db:push
npm run dev
```

**Prüfungen** (dieselben wie in CI):

```bash
npm run typecheck         # tsc über alle Pakete, 44 check-*.mjs und 49 Frontend-Tests
npm run test -w @workspace/lukas-ui   # nur die Frontend-Tests (49)
```

**Deployment:** Railway baut aus `main`. `start:deploy` führt vor dem Start
`db:push` aus, Schemaänderungen gehen also von selbst mit. Schlägt es fehl,
startet der Server **nicht** — ein Server auf einem Schema, das er nicht kennt,
scheitert sonst später und an unklarer Stelle.

**Mindestens nötig:** `DATABASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`,
`LUKAS_API_TOKEN`, `PORT`. Ohne den Token ist die private API **ungeschützt** —
der Server sagt das beim Start.

---

## Wie hier geprüft wird

Fünfundzwanzig Skripte unter `artifacts/api-server/scripts/check-*.mjs`. Sie
bündeln das echte Modul mit esbuild, ersetzen nur Datenbank, Netz und
Modellanbieter durch Attrappen — und prüfen nicht, dass Code *existiert*,
sondern dass er **wirkt**.

Der Maßstab: **jede wichtige Zusage braucht eine Gegenprobe.** Die Abwehr wird
entfernt, und der Test muss anschlagen. Tut er das nicht, war er keiner.
Beispiele, bei denen genau das passiert ist:

- Der DNS-Rebinding-Test lief zuerst grün und bewies nichts — der erfundene
  Name scheiterte ohnehin. Jetzt läuft ein echter Server auf 127.0.0.1, und die
  Attrappe behauptet, `localhost` sei öffentlich.
- Die Gegenprobe zum Entsperren biss nicht, weil die Attrappe die Sperre schon
  beim Verbindungsende freigab — wie Postgres auch. Jetzt wird das
  ausdrückliche `pg_advisory_unlock` verlangt: hinter einem Verbindungs-Pooler
  wird die Sitzung weitergereicht, nicht beendet.

---

## Aktuelle Grenzen

Ehrlich, weil ein System, das besser klingt als es ist, gefährlicher ist als
eines mit bekannten Lücken.

**Sicherheit**

- **Die Rufnummernanzeige entscheidet über den privaten Prompt.** Sie ist
  fälschbar. Handeln kann ein Anrufer nicht — die Sprachsitzung hat keine
  Werkzeuge —, aber zuhören. `LUKAS_TELEFON_STRENG=true` schließt das;
  Voreinstellung ist offen, weil es Issas Zugang verengt.
  ([Details](docs/SICHERHEITSMODELL.md#7-restrisiken--was-auch-nach-diesem-durchgang-bleibt))
- **Ein Token ist der einzige Faktor.** Wer `LUKAS_API_TOKEN` hat, ist Issa —
  kann damit aber **keine hinterlegten Zugangsdaten auslesen**, nur anlegen und
  löschen. Die Werte liegen AES-256-GCM-verschlüsselt in der Datenbank, der
  Schlüssel steht in der Umgebung (`LUKAS_TRESOR_SCHLUESSEL`); ohne ihn wird
  nichts gespeichert statt im Klartext. Lukas selbst kennt sie nie — im Plan
  steht `{{PASSWORT}}`, eingesetzt wird erst im Browser-Container.
- **Issas Nummer steht in der Git-Historie.** Aus dem aktuellen Stand ist sie
  entfernt; alte Commits eines öffentlichen Repositories bleiben.

**Betrieb**

- **Eine Instanz.** Die Läufe sind über Postgres-Advisory-Locks gegen
  Doppelausführung gesichert, aber der Zustand im Speicher (offene
  SSE-Leitungen, geparkte Anrufanlässe, Stoppwünsche) ist nicht geteilt.
- **Der Deploy nutzt weiterhin `db:push`.** Versionierte Migrationen gibt es
  jetzt (`npm run db:generate` / `db:migrate`, Basislinie geprüft), aber der
  Deploy-Pfad ist noch nicht umgestellt: die erste Migration enthält
  `CREATE TABLE` ohne `IF NOT EXISTS` und würde auf der bestehenden geteilten
  Datenbank scheitern. Der Umstieg ist ein bewusster Schritt und in
  [`lib/db/migrations/README.md`](lib/db/migrations/README.md) beschrieben.
- **Lernen ist eng.** Gelernt wird aus dem Ausgang von Werkzeugaufrufen —
  gelungen oder nicht, und woran es lag. Ob eine *Entscheidung* gut war, ob
  ein Text überzeugt hat, ob ein Ziel den Aufwand wert war: dafür gibt es
  kein Signal. Und es ist kein Training: das Modell ändert sich nicht, nur
  was in seinem Kontext steht.
- **Gefühle sind abgeleitet, nicht empfunden.** Sie unterscheiden sich, weil
  sie aus verschiedenen Lagen stammen, und sie ändern das Verhalten. Ob dabei
  etwas erlebt wird, sagt dieser Code nicht — und behauptet es auch nicht.
- **Metriken sind ein Vergleich, kein Alarmsystem.** Es gibt Zeitreihen über
  vierzehn Tage (`lib/kennzahlen.ts`, Tab „Kennzahlen"): Werkzeug-Fehlerquote,
  Tokens, Cache-Quote, Störungen, Freigaben. Auffällig heißt: heute gegen den
  **Median** der Vortage, mit gewichtetem Anteil des angebrochenen Tages und
  einer Untergrenze, unter der eine Quote nichts bedeutet. Lukas bekommt den
  Befund im nächsten autonomen Lauf in den Prompt, Issa eine Meldung — aber
  nur bei einer Warnung. Was es NICHT gibt: Schwellwerte, die jemand pflegen
  müsste, und keine Benachrichtigung außerhalb des Dashboards.
- **Idempotenz deckt SMS und E-Mail, nicht fremde MCP-Werkzeuge.** Ein
  inhaltlicher Fingerabdruck verhindert, dass ein Wiederholungsversuch
  dieselbe Nachricht zweimal schickt — bei SMS über die Nachrichtentabelle,
  bei E-Mail über `lib/versandsperre.ts` (eindeutiger Index, reserviert *vor*
  dem Versand, ohne Datenbank wird ausgeführt statt blockiert). Was ein
  fremder MCP-Server tut, wissen wir dagegen nicht: bricht ein Zug dort nach
  dem Absenden ab, läuft es beim nächsten Versuch erneut.

**Prüfungen**

- **SSH und Docker sind weiterhin nur nachgebaut.** `npm run bench:integration`
  prüft inzwischen gegen echtes Postgres, echte Weiterleitungsketten, zwei
  echte Prozesse, einen echten Browser und — seit dem 104-%-Fehler im
  Dashboard — den ganzen Token-Weg gegen einen echten HTTP-Server, der sich
  wie die Anthropic-API verhält. Was fehlt: dass ein `docker exec`
  auf dem Droplet wirklich so antwortet, wie die Attrappe behauptet — dafür
  bräuchte es den Droplet selbst.
- **Die OpenAPI-Spezifikation deckt nur einen Teil ab.** `lib/api-spec/openapi.yaml`
  beschreibt 21 Pfade, der Server hat 76 Route-Handler. Sechs Dashboard-Seiten
  benutzen den daraus erzeugten typisierten Client, alle übrigen (Freigaben,
  Meldungen, MCP, Telefon, Vorschläge, Kennzahlen, Zugänge, Startseite) rufen
  mit `fetch` direkt auf — zwischen Server und Oberfläche gibt es dort keine
  geprüfte Zusage. **Nichts erzwingt die Übereinstimmung**, weder ein Test noch
  CI; die Spezifikation kann also beliebig weit abdriften, ohne dass etwas
  rot wird. Das ist keine neue Lücke, aber eine, die mit jeder Route wächst.

- **Das Dashboard ist nur an den kritischen Stellen geprüft.** 49 Tests
  (vitest + Testing Library, `npm run test -w @workspace/lukas-ui`) decken die
  Wege ab, an denen ein Fehler etwas auslöst statt nur schlecht auszusehen:
  Freigabe erteilen und ablehnen (richtige ID, richtiges Verb, Token dabei,
  abgelaufene Freigabe ohne Tasten), auf eine Meldung antworten, die
  Kennzahlen, der Block „Wartet auf dich" auf der Startseite, und dass die
  Zugangs-Seite nie einen Wert anzeigt. Chat, Studio, Gedächtnis und Gehirn haben keine Tests.

**Fachlich**

- **`browser_do` rät nicht.** Er braucht eine CSS-Auswahl oder sichtbaren Text;
  eine Seite, die beides verschleiert, bedient er nicht zuverlässig.
- **Bildschirmfotos gehen an den Modellanbieter.** Passwortfelder werden vor
  der Aufnahme geleert und danach zurückgeschrieben, das Passwort ist also
  nicht im Bild. Alles andere auf der Seite schon — wer eine Seite mit
  sensiblen Daten bedient, schickt sie mit.
- **Eingehende SMS lösen bewusst nichts aus.** Sie werden abgelegt und Issa
  gemeldet, mehr nicht. Eine SMS ist nicht authentifiziert; die
  Absendernummer behauptet allein das Netz. Wer hier etwas auslösen könnte,
  hätte eine Fernbedienung.
