#!/bin/sh
set -eu
Xvfb :99 -screen 0 1100x900x24 -nolisten tcp >/dev/null 2>&1 &
xvfb_pid=$!
export DISPLAY=:99
sh /app/entrypoint.sh operator_portal.py &
portal_pid=$!
cleanup() {
  kill -TERM "$portal_pid" 2>/dev/null || true
  wait "$portal_pid" 2>/dev/null || true
  kill "$xvfb_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 143' TERM INT
wait "$portal_pid"
