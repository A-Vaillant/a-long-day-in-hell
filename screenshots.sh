#!/usr/bin/env bash
# Capture screenshots of key game states for visual review.
# Usage: bash screenshots.sh [seed]
# Output: screenshots/*.png
# Requires: shot-scraper, a built dist/index.html
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT=7334
BASE="http://localhost:${PORT}"
SEED="${1:-666}"
OUT="${ROOT}/screenshots"
W=1280; H=800

mkdir -p "$OUT"

python3 -m http.server "$PORT" --directory "${ROOT}/dist" &>/dev/null &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null || true' EXIT
sleep 0.8

echo "seed: $SEED  →  $OUT/"

snap_url() {
    local name="$1" url="$2" selector="$3"
    local sel_json; sel_json=$(printf '%s' "$selector" | python3 -c 'import sys,json;print(json.dumps(sys.stdin.read()))')
    shot-scraper shot "$url" \
        --wait-for "document.querySelector(${sel_json})&&document.querySelector(${sel_json}).innerText.trim().length>0" \
        --timeout 12000 \
        -o "${OUT}/${name}.png" \
        --width "$W" --height "$H" 2>/dev/null
    echo "  ✔  ${name}.png"
}

snap() {
    local name="$1" passage="$2" selector="$3" extra="${4:-}"
    local url="${BASE}/?seed=${SEED}&goto=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$passage")"
    local sel_json; sel_json=$(printf '%s' "$selector" | python3 -c 'import sys,json;print(json.dumps(sys.stdin.read()))')
    shot-scraper shot "$url" \
        ${extra:+--javascript "$extra"} \
        --wait-for "document.querySelector(${sel_json})&&document.querySelector(${sel_json}).innerText.trim().length>0" \
        --timeout 12000 \
        -o "${OUT}/${name}.png" \
        --width "$W" --height "$H" 2>/dev/null
    echo "  ✔  ${name}.png"
}

snap "01_life_story"       "Life Story"      "#lifestory-view"
snap "02_corridor_rest"    "Corridor"        "#corridor-view"
snap "03_corridor_gallery" "Corridor"        "#corridor-view" \
    "SugarCube&&SugarCube.State&&(SugarCube.State.variables.position=1);"
snap "04_shelf_browse"     "Shelf Browse"    "#shelf-view"
snap_url "05_book_cover" "${BASE}/?seed=${SEED}&goto=Shelf%20Open%20Book&openBook=0,0,10,0" "#book-view"
snap_url "06_book_spread" "${BASE}/?seed=${SEED}&goto=Shelf%20Open%20Book&openBook=0,0,10,0&spread=3" "#book-view"
snap "07_kiosk"            "Kiosk"           "#kiosk-view"
snap "08_bedroom"          "Bedroom"         "#bedroom-view"

echo ""
echo "Done. Open screenshots/ to review."
