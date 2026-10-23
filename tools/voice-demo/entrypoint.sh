#!/bin/sh
set -eu
umask 077
mkdir -p "$DEMO_RUNTIME"
chmod 700 "$DEMO_RUNTIME"
sh /app/pulse.sh >/dev/null 2>&1 &
PULSE_PID=$!
WORKER_PID=
cleanup() {
  if [ -n "$WORKER_PID" ]; then kill -TERM "$WORKER_PID" 2>/dev/null || true; wait "$WORKER_PID" 2>/dev/null || true; fi
  kill -TERM "$PULSE_PID" 2>/dev/null || true
  wait "$PULSE_PID" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 143' TERM INT
i=0
until pactl info >/dev/null 2>&1; do
  i=$((i+1)); [ "$i" -le 30 ] || exit 1
  sleep .1
done
python /app/"$@" &
WORKER_PID=$!
wait "$WORKER_PID"
