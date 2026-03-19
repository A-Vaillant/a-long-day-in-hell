#!/usr/bin/env bash
# Capture screenshots of key game states at multiple viewports.
# Usage: bash screenshots.sh [seed]
# Output: screenshots/{phone,desktop,widescreen}/*.png
# Requires: shot-scraper, a built dist/index.html
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT=7334
BASE="http://localhost:${PORT}"
SEED="${1:-666}"
OUT="${ROOT}/screenshots"

# Viewports: name width height
VIEWPORTS=(
    "phone:390:844"
    "desktop:1280:800"
    "widescreen:1920:1080"
)

rm -rf "$OUT"
mkdir -p "$OUT"

python3 -m http.server "$PORT" --directory "${ROOT}/dist" &>/dev/null &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; }
trap 'cleanup || true' EXIT
sleep 0.8

# --- Helpers ---

url_encode() {
    python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$1"
}

json_encode() {
    printf '%s' "$1" | python3 -c 'import sys,json;print(json.dumps(sys.stdin.read()))'
}

FONT_WAIT='document.fonts.ready.then(()=>'
FONT_END=')'

# Take a screenshot at a specific viewport
snap_at() {
    local name="$1" passage="$2" selector="$3" w="$4" h="$5" vp_dir="$6" extra="${7:-}"
    local url="${BASE}/?seed=${SEED}&vohu=$(url_encode "$passage")"
    local sel_json; sel_json=$(json_encode "$selector")
    local js="state.debug=false; ${extra:-} Engine.goto(state.screen);"
    mkdir -p "${OUT}/${vp_dir}"
    shot-scraper shot "$url" \
        --javascript "$js" \
        --wait-for "${FONT_WAIT}document.querySelector(${sel_json})&&document.querySelector(${sel_json}).innerText.trim().length>0${FONT_END}" \
        --timeout 12000 \
        -o "${OUT}/${vp_dir}/${name}.png" \
        --width "$w" --height "$h" 2>/dev/null
}

snap_url_at() {
    local name="$1" url="$2" selector="$3" w="$4" h="$5" vp_dir="$6"
    local sel_json; sel_json=$(json_encode "$selector")
    mkdir -p "${OUT}/${vp_dir}"
    shot-scraper shot "$url" \
        --wait-for "${FONT_WAIT}document.querySelector(${sel_json})&&document.querySelector(${sel_json}).innerText.trim().length>0${FONT_END}" \
        --timeout 12000 \
        -o "${OUT}/${vp_dir}/${name}.png" \
        --width "$w" --height "$h" 2>/dev/null
}

# Take a screenshot at all viewports
snap() {
    local name="$1" passage="$2" selector="$3" extra="${4:-}"
    for vp in "${VIEWPORTS[@]}"; do
        IFS=: read -r vp_name vp_w vp_h <<< "$vp"
        snap_at "$name" "$passage" "$selector" "$vp_w" "$vp_h" "$vp_name" "$extra"
    done
    echo "  ✔  ${name}"
}

snap_url() {
    local name="$1" url="$2" selector="$3"
    for vp in "${VIEWPORTS[@]}"; do
        IFS=: read -r vp_name vp_w vp_h <<< "$vp"
        snap_url_at "$name" "$url" "$selector" "$vp_w" "$vp_h" "$vp_name"
    done
    echo "  ✔  ${name}"
}

echo "seed: $SEED  →  $OUT/{phone,desktop,widescreen}/"

# --- Core screens ---
snap "life-story"        "Life Story"      "#lifestory-view"
snap "corridor-rest"     "Corridor"        "#corridor-view"
snap "corridor-gallery"  "Corridor"        "#corridor-view" \
    "state.position=1n; Engine.goto('Corridor');"

# --- Book views ---
snap_url "book-cover"    "${BASE}/?seed=${SEED}&vohu=Shelf%20Open%20Book&openBook=0,0,10,0" "#book-view"
snap_url "book-page"     "${BASE}/?seed=${SEED}&vohu=Shelf%20Open%20Book&openBook=0,0,10,0&spread=5" "#book-view"

# --- Target book ---
TB_JS='var tb = state.targetBook;
     state.side = tb.side; state.position = tb.position; state.floor = tb.floor;
     state.openBook = { side: tb.side, position: tb.position, floor: tb.floor, bookIndex: tb.bookIndex };'

snap "target-cover"  "Shelf Open Book" "#book-view" \
    "${TB_JS} state.openPage = 0; Engine.goto('Shelf Open Book');"
snap "target-p1"     "Shelf Open Book" "#book-view" \
    "${TB_JS} state.openPage = 1; Engine.goto('Shelf Open Book');"
snap "target-p200"   "Shelf Open Book" "#book-view" \
    "${TB_JS} state.openPage = 200; Engine.goto('Shelf Open Book');"

# --- Facilities ---
snap "kiosk"             "Kiosk"           "#kiosk-view"
snap "bedroom"           "Bedroom"         "#bedroom-view"
snap "submission"        "Submission Slot"  "#submission-view"
snap "sign"              "Sign"            "#sign-view"

# --- Corridor variants ---
snap "corridor-muttering" "Corridor"       "#corridor-view" \
    "state.position=3n;
     state.npcs[0].side = state.side;
     state.npcs[0].position = state.position + 1n;
     state.npcs[0].floor = state.floor;
     state.npcs[1].side = state.side;
     state.npcs[1].position = state.position + 2n;
     state.npcs[1].floor = state.floor;
     Social.syncNpcPositions();
     Engine.goto('Corridor');"

snap "corridor-event"    "Corridor"        "#corridor-view" \
    "state.position=1n;
     state.lastEvent = { text: TEXT.events[0].text, type: TEXT.events[0].type };
     Engine.goto('Corridor');"

snap "corridor-npc"      "Corridor"        "#corridor-view" \
    "state.position=1n;
     state.npcs[0].side = state.side;
     state.npcs[0].position = state.position;
     state.npcs[0].floor = state.floor;
     state.npcs[0].disposition = 'calm';
     Engine.goto('Corridor');"

snap "corridor-stressed" "Corridor"        "#corridor-view" \
    "state.position=1n;
     state.hunger=85; state.thirst=92; state.exhaustion=70; state.morale=15;
     Engine.goto('Corridor');"

snap "corridor-dying"    "Corridor"        "#corridor-view" \
    "state.position=1n;
     state.hunger=100; state.thirst=100; state.mortality=23; state.morale=5;
     state.despairing=true;
     Engine.goto('Corridor');"

snap "corridor-bridge"   "Corridor"        "#corridor-view" \
    "state.position=0n; state.floor=0n;
     Engine.goto('Corridor');"

snap "corridor-dim"      "Corridor"        "#corridor-view" \
    "var found = false;
     for (var p = 1n; p < 200n && !found; p++) {
         var seg = Lib.getSegment(state.side, p, state.floor);
         if (seg.lightLevel === 'dim') {
             state.position = p;
             found = true;
         }
     }
     Engine.goto('Corridor');"

# --- Other screens ---
snap "submission-held"   "Submission Slot" "#submission-view" \
    "state.heldBook = { side:0, position:1n, floor:10n, bookIndex:42 };
     Engine.goto('Submission Slot');"

snap "sleep"             "Sleep"           ".passage"

snap "win"               "Win"             "#win-view" \
    "state.won = true;
     state.submissionsAttempted = 1;
     Engine.goto('Win');"

# --- Godmode (widescreen only) ---
GM_BASE="${BASE}/?seed=${SEED}&godmode=1"
mkdir -p "${OUT}/widescreen"

gm_snap() {
    local name="$1" js="${2:-}"
    shot-scraper shot "$GM_BASE" \
        --wait-for "document.getElementById('godmode-canvas')" \
        ${js:+--javascript "$js"} \
        --timeout 12000 \
        -o "${OUT}/widescreen/${name}.png" \
        --width 1920 --height 1080 2>/dev/null
    echo "  ✔  ${name} (widescreen only)"
}

gm_snap "godmode-both"
gm_snap "godmode-west"    "GodmodeMap.handleKey('Tab'); Godmode.render();"
gm_snap "godmode-east"    "GodmodeMap.handleKey('Tab'); GodmodeMap.handleKey('Tab'); Godmode.render();"
gm_snap "godmode-zoomed"  "GodmodeMap.zoom(2); Godmode.render();"
gm_snap "godmode-stepped" "for(var i=0;i<20;i++){document.getElementById('gm-step').click();}"

echo ""
echo "Done. Screenshots in $OUT/{phone,desktop,widescreen}/"
