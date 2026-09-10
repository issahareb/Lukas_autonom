# LUKAS — Autonomer KI-Agent

Persistenter KI-Agent mit Persönlichkeit, Gedächtnis (PostgreSQL), echtem Tool-Use im Chat, Tagebuch-Reflexionen, Higgsfield-Media-Generierung und Anbindung an das VPS-Trading-System.

## Run & Operate

- `npm run dev:api` — API-Server starten (PORT aus .env, Standard 5000)
- `npm run dev:ui` — Oberfläche starten (Vite, lukas-ui)
- `npm run typecheck` — kompletter Typecheck
- `npm run build` — Typecheck + Build aller Pakete
- `npm run codegen` — API-Hooks/Zod-Schemas aus der OpenAPI-Spec neu generieren
- `npm run db:push` — DB-Schema pushen (nur Dev)
- Benötigte Env: `DATABASE_URL`; optional `AI_INTEGRATIONS_ANTHROPIC_*`, `HIGGSFIELD_API_KEY`, `LUKAS_API_TOKEN`, `VPS_DATABASE_URL` (siehe `.env.example`)

## Stack

- npm workspaces, Node.js ≥20, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API-Codegen: Orval (aus OpenAPI-Spec)
- Build: esbuild (ESM-Bundle)
- KI: Anthropic API (`claude-opus-4-8`), Streaming + Tool-Use

## Where things live

- DB-Schema: `lib/db/src/schema/` (lukas.ts, conversations.ts, messages.ts, trades.ts, bankroll_history.ts)
- API-Vertrag: `lib/api-spec/openapi.yaml` (Quelle der Wahrheit, danach `npm run codegen`)
- Lukas-Persona: `artifacts/api-server/src/lib/lukas-soul.ts`
- Lukas-Tools (save_memory, goals, diary, status, web_search, fetch_url, trading): `artifacts/api-server/src/lib/lukas-tools.ts`
- Chat mit agentischem Tool-Loop (SSE): `artifacts/api-server/src/routes/anthropic.ts`
- Selbstreflexion (Auto-Tagebuch): `artifacts/api-server/src/lib/reflection.ts`
- Auth-Middleware (LUKAS_API_TOKEN): `artifacts/api-server/src/middlewares/auth.ts`
- Grundschutz (CORS-Herkunft, Rate-Limit, Sicherheits-Kopfzeilen): `artifacts/api-server/src/middlewares/schutz.ts`
- Trading-Lesezugriff (raw pg auf VPS-DB): `artifacts/api-server/src/lib/vps-db.ts`, `src/routes/trades.ts`

## Architecture decisions

- Lukas' Status ist konzeptionell eine Zeile → `lukas-status.ts` updated in place statt Zeilen anzuhängen.
- Der Chat-Endpoint streamt SSE und führt Tools in einer Schleife aus — ohne Arbeitsgrenze, nur mit Notbremse und Stagnationshinweis (`lib/arbeitsschleife.ts`); Tool-Aufrufe werden als `{tool: name}`-Events an die UI gemeldet.
- Tagebuch-Reflexionen entstehen automatisch nach Gesprächen mit 6h-Cooldown (`maybeReflect`), erzwingbar per `POST /api/lukas/reflect`.
- Trades/Bankroll werden per raw SQL (parametrisiert) gelesen — die Tabellen gehören dem VPS-System; `VPS_DATABASE_URL` mit Fallback auf `DATABASE_URL`.
- Higgsfield-Jobs werden ehrlich als `failed` markiert, wenn kein API-Key gesetzt ist oder der API-Call fehlschlägt.

## Gotchas

- Nach Änderungen an `openapi.yaml` immer `npm run codegen` laufen lassen, sonst passen Server-Zod-Schemas und UI-Hooks nicht.
- `LUKAS_API_TOKEN` ist Pflicht: fehlt er, bleibt die private API geschlossen (503) statt offen. UI liest den Token aus `localStorage.getItem("lukas_token")`.
- Die private API akzeptiert Browser-Aufrufe nur vom eigenen Host; weitere Ursprünge über `LUKAS_ALLOWED_ORIGINS` (kommagetrennt). `/api/public/*` und die Webhooks bleiben bewusst offen.
- Rate-Limit der privaten API: 240 Anfragen/Minute je Adresse, per `LUKAS_RATE_LIMIT` änderbar. Ausgenommen: localhost, Webhooks, `/healthz`, `/api/public/*` (hat ein eigenes, engeres Limit).
- Kontextfenster je Modellaufruf: `LUKAS_CONTEXT_MAX_CHARS` (Standard 60.000 Zeichen ≈ 17k Tokens). Der Rohverlauf bleibt vollständig in der DB; Älteres kommt über memoryContextFor/query_memory zurück.
- Autonomie: Herzschlag alle `LUKAS_AUTONOMY_INTERVAL_MIN` (270) Minuten, ein voller Lauf startet aber nur bei einem Ereignis (Ziel bewegt, Freigabe, Antwort von Issa, ≥3 neue Fehler) oder nach `LUKAS_AUTONOMY_MIN_PAUSE_MIN` (180) Minuten Grundtakt — `lib/autonomie-anlass.ts`.
- Ausgabeschicht bekommt nur die letzten `LUKAS_VOICE_HISTORY` (4) Dialogzeilen plus den Entwurf, nie den System-Prompt.
- Budget je Zug: `LUKAS_TURN_TOKEN_BUDGET` (300.000 Tokens) und `LUKAS_TURN_MAX_MINUTEN` (25). Bei 100 % Hinweis "komm zum Ende", bei 150 % Schluss — `lib/arbeitsschleife.ts`.
- Content-Security-Policy ist an; `LUKAS_CSP=report` meldet nur, `LUKAS_CSP=off` schaltet sie ab. Widget und Demoseite bleiben ausgenommen.
- Ausgehende Netzzugriffe (`fetch_url`, `browse_page`) laufen über `lib/netzschutz.ts`: aufgelöste Adresse und jede Weiterleitung werden gegen interne Ziele geprüft (Metadaten-Dienst, Loopback, privates Netz). Ausnahmen über `LUKAS_FETCH_ALLOWLIST`.
- Browser: `browse_page` liest (rendert, scrollt, "Mehr laden"), `browser_do` BEDIENT (klicken, tippen, absenden) in einer dauerhaften Sitzung — Profil unter `/browser/profile/<sitzung>` im Docker-Volume `lukas-browser-profile`. Zugangsdaten kommen aus `LUKAS_WEB_<SITZUNG>_USER/_PASS` und gehen nie durch das Modell; im Plan stehen nur `{{BENUTZER}}`/`{{PASSWORT}}`.
- SMS über ClickSend (`lib/sms.ts`): Feld im Telefon-Tab, Werkzeug `send_sms` für Lukas (R2 — geht in Issas Namen an Dritte, wie `email_send`). Nur internationale Nummern, gesperrte Telefonnummern bekommen auch keine SMS, jede Nachricht wird in `lukas_sms` protokolliert.
- Risikostufen stehen ausschließlich in `lib/policy.ts`. Was Lukas darüber erfährt, erzeugt `policyHinweis()` daraus — Tool-Beschreibungen dürfen keine Freigabe von Hand versprechen (`check-policy-wahrheit.mjs`).
- Das Python-/VPS-System liegt unter `vps/` (Quelle der Wahrheit; Deploy via `scripts/lukas-deploy/deploy.sh`). Die Web-App startet es nicht — nur Lesezugriff auf dessen Postgres.

## User preferences

- Owner: Issa. Antworten auf Deutsch. Design: premium, modern, cinematisch.
- npm statt pnpm (Umstellung Juli 2026).
