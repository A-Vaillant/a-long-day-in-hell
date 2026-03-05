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

# --- Core screens ---
snap "01_life_story"       "Life Story"      "#lifestory-view"
snap "02_corridor_rest"    "Corridor"        "#corridor-view"
snap "03_corridor_gallery" "Corridor"        "#corridor-view" \
    "state.position=1; Engine.goto('Corridor');"

# --- Book views ---
snap_url "04_book_cover" "${BASE}/?seed=${SEED}&goto=Shelf%20Open%20Book&openBook=0,0,10,0" "#book-view"
snap_url "05_book_page" "${BASE}/?seed=${SEED}&goto=Shelf%20Open%20Book&openBook=0,0,10,0&spread=5" "#book-view"

# --- Facilities ---
snap "06_kiosk"            "Kiosk"           "#kiosk-view"
snap "07_bedroom"          "Bedroom"         "#bedroom-view"
snap "08_submission"       "Submission Slot" "#submission-view"

# --- Event visible in corridor (force an event) ---
snap "09_corridor_event"   "Corridor"        "#corridor-view" \
    "state.position=1;
     state.lastEvent = { text: TEXT.events[0].text, type: TEXT.events[0].type };
     Engine.goto('Corridor');"

# --- NPC encounter (place an NPC at player location) ---
snap "10_corridor_npc"     "Corridor"        "#corridor-view" \
    "state.position=1;
     state.npcs[0].side = state.side;
     state.npcs[0].position = state.position;
     state.npcs[0].floor = state.floor;
     state.npcs[0].disposition = 'calm';
     Engine.goto('Corridor');"

# --- NPC anxious + mad (multiple NPCs, different dispositions) ---
snap "11_corridor_npcs_mixed" "Corridor"     "#corridor-view" \
    "state.position=1;
     state.npcs[0].side = state.side;
     state.npcs[0].position = state.position;
     state.npcs[0].floor = state.floor;
     state.npcs[0].disposition = 'anxious';
     state.npcs[1].side = state.side;
     state.npcs[1].position = state.position;
     state.npcs[1].floor = state.floor;
     state.npcs[1].disposition = 'mad';
     state.npcs[2].side = state.side;
     state.npcs[2].position = state.position;
     state.npcs[2].floor = state.floor;
     state.npcs[2].disposition = 'catatonic';
     state.npcs[2].alive = false;
     Engine.goto('Corridor');"

# --- Survival pressure (high stats, warnings showing) ---
snap "12_corridor_stressed" "Corridor"       "#corridor-view" \
    "state.position=1;
     state.hunger=85; state.thirst=92; state.exhaustion=70; state.morale=15;
     Engine.goto('Corridor');"

# --- Dying (mortality visible) ---
snap "13_corridor_dying"    "Corridor"       "#corridor-view" \
    "state.position=1;
     state.hunger=100; state.thirst=100; state.mortality=23; state.morale=5;
     state.despairing=true;
     Engine.goto('Corridor');"

# --- Held book + submission ---
snap "14_submission_held"   "Submission Slot" "#submission-view" \
    "state.heldBook = { side:0, position:1, floor:10, bookIndex:42 };
     Engine.goto('Submission Slot');"

# --- Bridge corridor (cross available) ---
snap "15_corridor_bridge"   "Corridor"        "#corridor-view" \
    "state.position=0; state.floor=0;
     Engine.goto('Corridor');"

# --- Dim lighting ---
snap "16_corridor_dim"      "Corridor"        "#corridor-view" \
    "var found = false;
     for (var p = 1; p < 200 && !found; p++) {
         var seg = Lib.getSegment(state.side, p, state.floor);
         if (seg.lightLevel === 'dim') {
             state.position = p;
             found = true;
         }
     }
     Engine.goto('Corridor');"

# --- Sleep result ---
snap "17_sleep"             "Sleep Stub"      ".passage" \
    ""

# --- Win screen ---
snap "18_win"                "Win"             "#win-view" \
    "state.won = true;
     state.submissionsAttempted = 1;
     Engine.goto('Win');"

echo ""
echo "Done. Open screenshots/ to review."
