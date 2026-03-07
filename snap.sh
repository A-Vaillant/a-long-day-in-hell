#!/usr/bin/env bash
# Quick screenshot helper. Starts a server, takes a shot, kills the server.
# Usage: bash snap.sh <output.png> [url_params]
# Examples:
#   bash snap.sh godmode.png "seed=666&godmode=1"
#   bash snap.sh corridor.png "seed=666&vohu=Corridor"
#   bash snap.sh sign.png "seed=666&vohu=Sign"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT=7334
OUT="${1:?Usage: snap.sh <output.png> [url_params]}"
PARAMS="${2:-seed=666}"

# Ensure output path is absolute or relative to screenshots/
[[ "$OUT" == /* ]] || OUT="${ROOT}/screenshots/${OUT}"
mkdir -p "$(dirname "$OUT")"

python3 -m http.server "$PORT" --directory "${ROOT}/dist" &>/dev/null &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; }
trap 'cleanup || true' EXIT
sleep 0.8

shot-scraper shot "http://localhost:${PORT}/?${PARAMS}" \
    --wait 2000 --timeout 12000 \
    -o "$OUT" --width 1280 --height 800 2>/dev/null

echo "✔ $OUT"
