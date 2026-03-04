#!/usr/bin/env bash
# Browser integration tests using shot-scraper.
# Requires: shot-scraper, python3, a built dist/index.html
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=7331
BASE="http://localhost:${PORT}"
SEED=666
URL="${BASE}/?seed=${SEED}"
SS_DIR="${ROOT}/test/screenshots"
PASS=0
FAIL=0

mkdir -p "$SS_DIR"

# --- Server lifecycle ---
python3 -m http.server "$PORT" --directory "${ROOT}/dist" &>/dev/null &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT
sleep 0.5

# --- Helpers ---
RED='\033[0;31m'; GREEN='\033[0;32m'; RESET='\033[0m'

pass() { echo -e "  ${GREEN}✔${RESET} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}✖${RESET} $1"; echo "    $2"; FAIL=$((FAIL + 1)); }

# Wait for a selector then evaluate JS. Polls up to 8s.
js() {
    local url="${1}" script="${2}"
    shot-scraper javascript "$url" "
        new Promise((res,rej) => {
            const d = Date.now() + 8000;
            const p = () => {
                if (document.querySelector('#passage-corridor')) {
                    try { res(${script}); } catch(e) { rej(e.message); }
                } else if (Date.now() > d) {
                    rej('Timed out waiting for #passage-corridor');
                } else { setTimeout(p, 100); }
            };
            p();
        })" 2>/dev/null
}

assert_eq() {
    local name="$1" actual="$2" expected="$3"
    if [[ "$actual" == "$expected" ]]; then pass "$name"
    else fail "$name" "expected $(echo "$expected") got $(echo "$actual")"; fi
}

assert_contains() {
    local name="$1" actual="$2" needle="$3"
    if echo "$actual" | grep -q "$needle"; then pass "$name"
    else fail "$name" "expected to contain '$needle', got: ${actual:0:120}"; fi
}

assert_not_eq() {
    local name="$1" a="$2" b="$3"
    if [[ "$a" != "$b" ]]; then pass "$name"
    else fail "$name" "expected values to differ but both were: ${a:0:80}"; fi
}

# --- Tests ---
echo "▶ page load"

title=$(shot-scraper javascript "$URL" "document.title" 2>/dev/null)
assert_eq "has correct title" "$title" '"A Short Stay in Hell"'

corridor=$(js "$URL" "document.querySelector('#corridor-view')?.innerText ?? null")
assert_contains "renders corridor-view" "$corridor" "corridor"

debug=$(js "$URL" "document.querySelector('#debug-panel')?.innerText ?? null")
assert_contains "renders debug panel with seed" "$debug" "$SEED"

links=$(js "$URL" "[...document.querySelectorAll('#moves a')].map(a=>a.innerText.trim())")
assert_contains "renders move links" "$links" "Right"

echo "▶ PRNG determinism"

pos1=$(js "$URL" "({side:SugarCube.State.variables.side,position:SugarCube.State.variables.position,floor:SugarCube.State.variables.floor})")
pos2=$(js "$URL" "({side:SugarCube.State.variables.side,position:SugarCube.State.variables.position,floor:SugarCube.State.variables.floor})")
assert_eq "same seed → same starting position" "$pos1" "$pos2"

debug_a=$(js "${BASE}/?seed=aaa" "document.querySelector('#debug-panel')?.innerText ?? ''")
debug_b=$(js "${BASE}/?seed=bbb" "document.querySelector('#debug-panel')?.innerText ?? ''")
assert_not_eq "different seeds → different debug output" "$debug_a" "$debug_b"

echo "▶ navigation"

# Click Right then wait for position to change — uses --input to avoid shell quoting issues
NAV_JS=$(mktemp /tmp/nav_test.XXXXXX.js)
cat > "$NAV_JS" <<'NAVSCRIPT'
new Promise((res, rej) => {
    const d = Date.now() + 8000;
    const waitInitial = () => {
        if (document.querySelector('#passage-corridor')) {
            const before = SugarCube.State.variables.position;
            const link = [...document.querySelectorAll('#moves a')].find(a => a.innerText.includes('Right'));
            if (!link) { res({error: 'no Right link'}); return; }
            link.click();
            const waitNav = () => {
                const after = SugarCube.State.variables.position;
                if (after !== before) { res({before, after}); }
                else if (Date.now() > d) { rej('timeout waiting for nav'); }
                else { setTimeout(waitNav, 50); }
            };
            setTimeout(waitNav, 50);
        } else if (Date.now() > d) { rej('timeout waiting for passage'); }
        else { setTimeout(waitInitial, 100); }
    };
    waitInitial();
});
NAVSCRIPT
nav=$(shot-scraper javascript "$URL" --input "$NAV_JS" 2>/dev/null)
rm -f "$NAV_JS"
assert_contains "clicking Right increments position" "$nav" '"after": 1'

echo "▶ screenshots"

shot-scraper shot "$URL" -o "${SS_DIR}/corridor.png" --width 1024 --height 768 2>/dev/null
pass "captured corridor screenshot → test/screenshots/corridor.png"

# --- Summary ---
echo ""
echo "tests $((PASS + FAIL)) | pass ${PASS} | fail ${FAIL}"
[[ $FAIL -eq 0 ]]
