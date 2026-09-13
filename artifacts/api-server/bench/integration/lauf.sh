#!/usr/bin/env bash
# Ein Befehl: Datenbank hoch, Schema hinein, Bündel bauen, messen, aufräumen.
#
# Das Aufräumen steht in einem trap — bricht der Lauf mitten drin ab, bleibt
# sonst ein Postgres-Prozess und ein Datenverzeichnis zurück.
set -euo pipefail
HIER="$(cd "$(dirname "$0")" && pwd)"
API="$HIER/../.."
cd "$API"

trap '"$HIER/stop-postgres.sh" >/dev/null 2>&1 || true' EXIT

echo "→ Postgres starten"
URL="$("$HIER/start-postgres.sh")"
export BENCH_DATABASE_URL="$URL"

# Denselben Weg wie der Deploy, nicht `push`. Sonst prueft der
# Integrationslauf ein Schema, das so nie ausgeliefert wird — und genau dort
# hat sich die unvollstaendige Migrationskette versteckt.
echo "→ Schema einspielen (Deploy-Pfad)"
DATABASE_URL="$URL" npm run db:deploy --prefix "$API/../.." >/dev/null

echo "→ Bündel bauen"
npx esbuild src/lib/netzschutz.ts --bundle --format=esm --platform=node --external:undici --outfile=dist/netzschutz-bench.mjs --log-level=error
npx esbuild src/lib/lauf-sperre.ts --bundle --format=esm --platform=node --external:pg --external:pino --outfile=dist/lauf-sperre-bench.mjs --log-level=error
npx esbuild src/lib/memory-retrieval.ts --bundle --format=esm --platform=node --external:pg --external:pino --external:undici --outfile=dist/memory-bench.mjs --log-level=error
npx esbuild src/lib/browser-operator-script.ts --bundle --format=esm --platform=node --outfile=dist/browser-script-bench.mjs --log-level=error

echo "→ messen"
# Den Browser-Pfad NUR setzen, wenn er auch existiert.
#
# Hier stand fest "${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}". Das ist der
# Pfad EINER Umgebung (des Entwicklungscontainers, wo Chromium vorinstalliert
# liegt). Auf dem CI-Laeufer gibt es ihn nicht: dort installiert
# `playwright install` nach ~/.cache/ms-playwright, die Voreinstellung zeigte
# aber auf ein leeres Verzeichnis — Playwright fand nichts und der ganze
# Browser-Teil fiel um (3/12), waehrend er lokal gruen war.
#
# Ist die Variable gesetzt, gilt sie. Ist sie es nicht und /opt/pw-browsers
# existiert, gilt der; sonst entscheidet Playwright selbst.
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] && [ -d /opt/pw-browsers ]; then
  export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
fi
node "$HIER/runner.mjs"
