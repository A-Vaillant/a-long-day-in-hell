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

rm -rf "$OUT"
mkdir -p "$OUT"

python3 -m http.server "$PORT" --directory "${ROOT}/dist" &>/dev/null &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; }
trap 'cleanup || true' EXIT
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
    local url="${BASE}/?seed=${SEED}&vohu=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$passage")"
    local sel_json; sel_json=$(printf '%s' "$selector" | python3 -c 'import sys,json;print(json.dumps(sys.stdin.read()))')
    # Hide debug panel for clean screenshots, then run extra JS + re-render
    local js="state.debug=false; ${extra:-} Engine.goto(state.screen);"
    shot-scraper shot "$url" \
        --javascript "$js" \
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
    "state.position=1n; Engine.goto('Corridor');"

# --- Book views ---
snap_url "04_book_cover" "${BASE}/?seed=${SEED}&vohu=Shelf%20Open%20Book&openBook=0,0,10,0" "#book-view"
snap_url "05_book_page" "${BASE}/?seed=${SEED}&vohu=Shelf%20Open%20Book&openBook=0,0,10,0&spread=5" "#book-view"

# --- Target (winning) book pages ---
TB_JS='var tb = state.targetBook;
     state.side = tb.side; state.position = tb.position; state.floor = tb.floor;
     state.openBook = { side: tb.side, position: tb.position, floor: tb.floor, bookIndex: tb.bookIndex };'

snap "05a_target_cover" "Shelf Open Book" "#book-view" \
    "${TB_JS} state.openPage = 0; Engine.goto('Shelf Open Book');"
snap "05b_target_p1"    "Shelf Open Book" "#book-view" \
    "${TB_JS} state.openPage = 1; Engine.goto('Shelf Open Book');"
snap "05c_target_p50"   "Shelf Open Book" "#book-view" \
    "${TB_JS} state.openPage = 50; Engine.goto('Shelf Open Book');"
snap "05d_target_p200"  "Shelf Open Book" "#book-view" \
    "${TB_JS} state.openPage = 200; Engine.goto('Shelf Open Book');"
snap "05e_target_p409"  "Shelf Open Book" "#book-view" \
    "${TB_JS} state.openPage = 409; Engine.goto('Shelf Open Book');"

# --- Facilities ---
snap "06_kiosk"            "Kiosk"           "#kiosk-view"
snap "07_bedroom"          "Bedroom"         "#bedroom-view"
snap "08_submission"       "Submission Slot" "#submission-view"

# --- Sign ---
snap "06a_sign"              "Sign"            "#sign-view"

# --- Muttering (nearby NPC not co-located) ---
snap "06b_corridor_muttering" "Corridor"       "#corridor-view" \
    "state.position=3n;
     state.npcs[0].side = state.side;
     state.npcs[0].position = state.position + 1n;
     state.npcs[0].floor = state.floor;
     state.npcs[1].side = state.side;
     state.npcs[1].position = state.position + 2n;
     state.npcs[1].floor = state.floor;
     Social.syncNpcPositions();
     Engine.goto('Corridor');"

# --- Event visible in corridor (force an event) ---
snap "09_corridor_event"   "Corridor"        "#corridor-view" \
    "state.position=1n;
     state.lastEvent = { text: TEXT.events[0].text, type: TEXT.events[0].type };
     Engine.goto('Corridor');"

# --- NPC encounter (place an NPC at player location) ---
snap "10_corridor_npc"     "Corridor"        "#corridor-view" \
    "state.position=1n;
     state.npcs[0].side = state.side;
     state.npcs[0].position = state.position;
     state.npcs[0].floor = state.floor;
     state.npcs[0].disposition = 'calm';
     Engine.goto('Corridor');"

# --- NPC anxious + mad (multiple NPCs, different dispositions) ---
snap "11_corridor_npcs_mixed" "Corridor"     "#corridor-view" \
    "state.position=1n;
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
    "state.position=1n;
     state.hunger=85; state.thirst=92; state.exhaustion=70; state.morale=15;
     Engine.goto('Corridor');"

# --- Dying (mortality visible) ---
snap "13_corridor_dying"    "Corridor"       "#corridor-view" \
    "state.position=1n;
     state.hunger=100; state.thirst=100; state.mortality=23; state.morale=5;
     state.despairing=true;
     Engine.goto('Corridor');"

# --- Held book + submission ---
snap "14_submission_held"   "Submission Slot" "#submission-view" \
    "state.heldBook = { side:0, position:1n, floor:10n, bookIndex:42 };
     Engine.goto('Submission Slot');"

# --- Bridge corridor (cross available) ---
snap "15_corridor_bridge"   "Corridor"        "#corridor-view" \
    "state.position=0n; state.floor=0n;
     Engine.goto('Corridor');"

# --- Dim lighting ---
snap "16_corridor_dim"      "Corridor"        "#corridor-view" \
    "var found = false;
     for (var p = 1n; p < 200n && !found; p++) {
         var seg = Lib.getSegment(state.side, p, state.floor);
         if (seg.lightLevel === 'dim') {
             state.position = p;
             found = true;
         }
     }
     Engine.goto('Corridor');"

# --- Fragment highlighting (book near target with dwell fired) ---
# Fragment highlighting — inject mock fragments into a book page
FRAG_URL="${BASE}/?seed=${SEED}&vohu=$(python3 -c "import urllib.parse; print(urllib.parse.quote('Shelf Open Book'))")&openBook=0,1,10,5&spread=3"
shot-scraper shot "$FRAG_URL" \
    --wait-for "document.querySelector('#book-single')&&document.querySelector('#book-single').innerText.trim().length>0" \
    --javascript "
        var el = document.getElementById('book-single');
        if (el) {
            var text = el.textContent;
            var words = text.split(' ');
            var mid = Math.floor(words.length / 4);
            var frag1 = words.slice(mid, mid+6).join(' ');
            var frag2 = words.slice(mid+12, mid+15).join(' ');
            el.innerHTML = el.innerHTML
                .replace(frag1, '<mark class=\"fragment revealed\">' + frag1 + '</mark>')
                .replace(frag2, '<mark class=\"fragment revealed\">' + frag2 + '</mark>');
        }
    " \
    --timeout 12000 \
    -o "${OUT}/17a_book_fragments.png" \
    --width "$W" --height "$H" 2>/dev/null
echo "  ✔  17a_book_fragments.png"

# --- Sleep result ---
snap "17_sleep"             "Sleep"      ".passage" \
    ""

# --- Win screen ---
snap "18_win"                "Win"             "#win-view" \
    "state.won = true;
     state.submissionsAttempted = 1;
     Engine.goto('Win');"

# --- Godmode ---
GM_BASE="${BASE}/?seed=${SEED}&godmode=1"

gm_snap() {
    local name="$1" js="${2:-}"
    shot-scraper shot "$GM_BASE" \
        --wait-for "document.getElementById('godmode-canvas')" \
        ${js:+--javascript "$js"} \
        --timeout 12000 \
        -o "${OUT}/${name}.png" \
        --width "$W" --height "$H" 2>/dev/null
    echo "  ✔  ${name}.png"
}

gm_snap "20_godmode_both"

gm_snap "21_godmode_west" \
    "GodmodeMap.handleKey('Tab'); Godmode.render();"

gm_snap "22_godmode_east" \
    "GodmodeMap.handleKey('Tab'); GodmodeMap.handleKey('Tab'); Godmode.render();"

gm_snap "23_godmode_zoomed" \
    "GodmodeMap.zoom(2); Godmode.render();"

gm_snap "24_godmode_stepped" \
    "for(var i=0;i<20;i++){document.getElementById('gm-step').click();}"

echo ""
echo "Done. Open screenshots/ to review."
