#!/usr/bin/env bash
# Takes the screenshots of the README on a throw-away server with made-up people and calendars. Details: README.md.
#   bash scripts/docs-screenshots/run.sh [--install]
# Needs Node 22.13+, `npm install` done, and Playwright with Chromium (preinstalled in cloud sessions).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
export SHOTS_DIR="${SHOTS_DIR:-${TMPDIR:-/tmp}/lueckenfueller-shots}"
rm -rf "$SHOTS_DIR"
mkdir -p "$SHOTS_DIR/data"

# The same settings as `.env.example` explains; the key only protects made-up links.
export DATA_DIR="$SHOTS_DIR/data"
CALENDAR_KEY="$(head -c 32 /dev/urandom | base64)"
export CALENDAR_KEY
export CORS_ORIGIN="http://localhost:5173"
export APP_URL="http://localhost:5173/"
export LOG_LEVEL="warn"
if [ -z "${NODE_PATH:-}" ]; then NODE_PATH="$(npm root -g)"; export NODE_PATH; fi

pids=()
cleanup() { for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT

wait_for() { # url
  for _ in $(seq 1 60); do
    if curl -fs "$1" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "not reachable: $1 (see $SHOTS_DIR/*.log)" >&2
  return 1
}

start_server() {
  (cd "$root" && exec node --import tsx "$here/fake-server.mts") >"$SHOTS_DIR/server.log" 2>&1 &
  server_pid=$!
  pids+=("$server_pid")
  wait_for "http://localhost:8080/api/health"
}

cd "$root"
npm run build:shared >/dev/null
npm run build -w server >/dev/null
(cd web && VITE_API_URL="http://localhost:8080" exec "$root/node_modules/.bin/vite" --port 5173 --strictPort) >"$SHOTS_DIR/web.log" 2>&1 &
pids+=($!)
wait_for "http://localhost:5173/"

start_server
node "$here/seed.mjs"
# A restart empties the server's calendar memory, so Max's calendar can now fail ("Kalender nicht lesbar").
touch "$SHOTS_DIR/broken-Max"
kill "$server_pid"
wait "$server_pid" 2>/dev/null || true
start_server

node "$here/shoot.cjs" "$@"
