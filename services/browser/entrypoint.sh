#!/bin/sh
set -eu
mkdir -p /data
chown browser:browser /data
exec runuser -u browser -- node /app/server.mjs
