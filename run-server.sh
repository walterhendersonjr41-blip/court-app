#!/usr/bin/env bash
# Supervisor loop: restarts the Node server if it ever exits/crashes.
cd "$(dirname "$0")"
while true; do
  echo "[$(date -u +%FT%TZ)] starting server" >> server.log
  PORT=3300 node server.js >> server.log 2>&1
  echo "[$(date -u +%FT%TZ)] server exited ($?), restarting in 2s" >> server.log
  sleep 2
done
