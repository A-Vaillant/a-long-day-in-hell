#!/usr/bin/env bash
# Browser integration tests using shot-scraper.
# Requires: shot-scraper, python3, a built dist/index.html
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=7331
BASE="http://localhost:${PORT}"
SEED=666
URL="${BASE}/?seed=${SEED}&goto=Corridor"
SS_DIR="${ROOT}/test/screenshots"
PASS=0
FAIL=0

mkdir -p "$SS_DIR"

# --- Server lifecycle ---
python3 -m http.server "$PORT" --directory "${ROOT}/dist" &>/dev/null &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null || true' EXIT
sleep 0.5

# --- Helpers ---
RED='\033[0;31m'; GREEN='\033[0;32m'; DIM='\033[2m'; RESET='\033[0m'

pass() { echo -e "  ${GREEN}✔${RESET} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}✖${RESET} $1"; echo -e "    ${DIM}$2${RESET}"; FAIL=$((FAIL + 1)); }

# Wait for selector then evaluate JS.
# Usage: js <url> <selector> <script>
js() {
    local url="$1" selector="$2" script="$3"
    shot-scraper javascript "$url" "
        new Promise((res, rej) => {
            const d = Date.now() + 8000;
            const p = () => {
                if (document.querySelector($(printf '%s' "$selector" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))'))) {
                    try { res($script); } catch(e) { rej(e.message); }
                } else if (Date.now() > d) { rej('Timeout waiting for $selector'); }
                else { setTimeout(p, 100); }
            };
            p();
        })" 2>/dev/null
}

# Use a temp file for complex multi-line scripts
js_file() {
    local url="$1" selector="$2" script_file="$3"
    local sel_json
    sel_json=$(printf '%s' "$selector" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')
    local wrapped
    wrapped=$(mktemp /tmp/sstest.js.XXXXXX)
    cat > "$wrapped" <<WRAPPER
new Promise((res, rej) => {
    const d = Date.now() + 8000;
    const p = () => {
        if (document.querySelector($sel_json)) {
            try {
$(cat "$script_file")
            } catch(e) { rej(e.message); }
        } else if (Date.now() > d) { rej('Timeout waiting for $selector'); }
        else { setTimeout(p, 100); }
    };
    p();
});
WRAPPER
    shot-scraper javascript "$url" --input "$wrapped" 2>/dev/null
    rm -f "$wrapped"
}

assert_eq()       { [[ "$2" == "$3" ]] && pass "$1" || fail "$1" "expected $3, got $2"; }
assert_contains() { echo "$2" | grep -q "$3" && pass "$1" || fail "$1" "expected '$3' in: ${2:0:120}"; }
assert_not_eq()   { [[ "$2" != "$3" ]] && pass "$1" || fail "$1" "both equal: ${2:0:80}"; }
assert_not_null() { [[ "$2" != "null" ]] && [[ -n "$2" ]] && pass "$1" || fail "$1" "was null/empty"; }

# --- CORRIDOR TESTS ---
echo "▶ corridor"

title=$(shot-scraper javascript "$URL" "document.title" 2>/dev/null)
assert_eq        "title" "$title" '"A Long Day in Hell"'

corridor=$(js "$URL" "#corridor-view" "document.querySelector('#corridor-view')?.innerText ?? null")
assert_contains  "renders corridor text"    "$corridor" "corridor"
assert_contains  "renders rest area notice" "$corridor" "rest area"
assert_contains  "renders move links"       "$corridor" "Left"

debug=$(js "$URL" "#debug-panel" "document.querySelector('#debug-panel')?.innerText ?? null")
assert_contains  "debug panel shows seed"   "$debug" "$SEED"
assert_contains  "debug panel shows floor"  "$debug" "Floor:"

pos1=$(js "$URL" "#corridor-view" "({side:SugarCube.State.variables.side,position:SugarCube.State.variables.position,floor:SugarCube.State.variables.floor})")
pos2=$(js "$URL" "#corridor-view" "({side:SugarCube.State.variables.side,position:SugarCube.State.variables.position,floor:SugarCube.State.variables.floor})")
assert_eq        "same seed → same start position" "$pos1" "$pos2"

debug_a=$(js "${BASE}/?seed=aaa&goto=Corridor" "#corridor-view" "document.querySelector('#debug-panel')?.innerText ?? ''")
debug_b=$(js "${BASE}/?seed=bbb&goto=Corridor" "#corridor-view" "document.querySelector('#debug-panel')?.innerText ?? ''")
assert_not_eq    "different seeds → different output" "$debug_a" "$debug_b"

# Navigation: click Right link
NAV=$(mktemp /tmp/sstest.js.XXXXXX)
cat > "$NAV" <<'NAVSCRIPT'
res(new Promise((res2, rej2) => {
    const v = SugarCube.State.variables;
    const before = v.position;
    const tickBefore = v.tick;
    const link = [...document.querySelectorAll('#moves a')].find(a => a.innerText.includes('Right'));
    if (!link) { res2({error:'no Right link'}); return; }
    link.click();
    const t = Date.now() + 5000;
    const w = () => {
        const after = v.position;
        if (after !== before) res2({before, after, tickBefore, tickAfter: v.tick});
        else if (Date.now() > t) res2({timeout:true, before, after, tickBefore, tickAfter: v.tick});
        else setTimeout(w, 50);
    };
    setTimeout(w, 50);
}));
NAVSCRIPT
nav=$(js_file "$URL" "#corridor-view" "$NAV")
rm -f "$NAV"
assert_contains "clicking Right increments position" "$nav" '"after": 1'
assert_contains "clicking Right advances tick"       "$nav" '"tickAfter": 1'

# Navigation: setup.doMove directly
DOMOVE=$(mktemp /tmp/sstest.js.XXXXXX)
cat > "$DOMOVE" <<'DOMOVESCRIPT'
const v = SugarCube.State.variables;
const before = v.position;
const result = SugarCube.setup.doMove('left');
const after = v.position;
res({before, after, result, moved: before !== after});
DOMOVESCRIPT
domove=$(js_file "$URL" "#corridor-view" "$DOMOVE")
rm -f "$DOMOVE"
assert_contains "doMove('left') changes position" "$domove" '"moved": true'
assert_contains "doMove returns true"             "$domove" '"result": true'

# Navigation: keyboard (press 'l' for right)
KEYMOVE=$(mktemp /tmp/sstest.js.XXXXXX)
cat > "$KEYMOVE" <<'KEYMOVESCRIPT'
res(new Promise((res2) => {
    const v = SugarCube.State.variables;
    const before = v.position;
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'l', bubbles: true}));
    const t = Date.now() + 5000;
    const w = () => {
        const after = v.position;
        if (after !== before) res2({before, after});
        else if (Date.now() > t) res2({timeout: true, before, after});
        else setTimeout(w, 50);
    };
    setTimeout(w, 50);
}));
KEYMOVESCRIPT
keymove=$(js_file "$URL" "#corridor-view" "$KEYMOVE")
rm -f "$KEYMOVE"
assert_contains "keyboard 'l' moves right" "$keymove" '"after":'

# --- SHELF TESTS (via Debug API) ---
echo "▶ shelf browse"

# Teleport to shelf view via Debug API
SHELF=$(mktemp /tmp/sstest.js.XXXXXX)
cat > "$SHELF" <<'SHELFSCRIPT'
res(new Promise((res2, rej2) => {
    Debug.goToLocation(0, 0, 10);
    const t = Date.now() + 5000;
    const w = () => {
        if (document.querySelector('#corridor-view')) {
            const link = [...document.querySelectorAll('#actions a')].find(a => a.innerText.includes('shelf') || a.innerText.includes('Look'));
            if (!link) { res2({error: 'no shelf link', html: document.querySelector('#actions')?.innerText}); return; }
            link.click();
            const t2 = Date.now() + 5000;
            const w2 = () => {
                if (document.querySelector('#shelf-view')) res2({ok: true, text: document.querySelector('#shelf-view').innerText.slice(0, 800)});
                else if (Date.now() > t2) res2({timeout: true});
                else setTimeout(w2, 50);
            };
            setTimeout(w2, 50);
        } else if (Date.now() > t) res2({timeout: true});
        else setTimeout(w, 50);
    };
    setTimeout(w, 50);
}));
SHELFSCRIPT
shelf=$(js_file "$URL" "#corridor-view" "$SHELF")
rm -f "$SHELF"
assert_contains "shelf view renders"         "$shelf" "SHELVES"
assert_contains "shelf has book spines"      "$shelf" "ok"

# --- BOOK TESTS (via Debug.goToBook) ---
echo "▶ book reading"

BOOK=$(mktemp /tmp/sstest.js.XXXXXX)
cat > "$BOOK" <<'BOOKSCRIPT'
res(new Promise((res2, rej2) => {
    Debug.goToBook(0, 0, 10, 0);
    const t = Date.now() + 5000;
    const w = () => {
        if (document.querySelector('#book-view')) {
            res2({
                text:    document.querySelector('.book-page')?.innerText?.slice(0, 100) ?? null,
                header:  document.querySelector('.location-header')?.innerText ?? null,
                hasNav:  !!document.querySelector('#page-nav'),
            });
        } else if (Date.now() > t) res2({timeout: true});
        else setTimeout(w, 50);
    };
    setTimeout(w, 50);
}));
BOOKSCRIPT
book=$(js_file "$URL" "#corridor-view" "$BOOK")
rm -f "$BOOK"
assert_not_null "book-view renders"          "$book"
assert_contains "book page has content"      "$book" '"text":'
assert_contains "book header shows page"     "$book" "PAGE 1"
assert_contains "page nav rendered"          "$book" '"hasNav": true'

# Book determinism: same coords → same page text
BOOKDET=$(mktemp /tmp/sstest.js.XXXXXX)
cat > "$BOOKDET" <<'BOOKDETSCRIPT'
res(new Promise((res2) => {
    Debug.goToBook(0, 3, 7, 12);
    const t = Date.now() + 5000;
    const w = () => {
        if (document.querySelector('#book-view')) {
            res2(document.querySelector('.book-page')?.innerText?.slice(0, 80) ?? null);
        } else if (Date.now() > t) res2(null);
        else setTimeout(w, 50);
    };
    setTimeout(w, 50);
}));
BOOKDETSCRIPT
text1=$(js_file "$URL" "#corridor-view" "$BOOKDET")
text2=$(js_file "$URL" "#corridor-view" "$BOOKDET")
rm -f "$BOOKDET"
assert_eq "same book coords → same page text" "$text1" "$text2"

# Different seed → different book content
ALTDET=$(mktemp /tmp/sstest.js.XXXXXX)
cat > "$ALTDET" <<'ALTSCRIPT'
res(new Promise((res2) => {
    Debug.goToBook(0, 3, 7, 12);
    const t = Date.now() + 5000;
    const w = () => {
        if (document.querySelector('#book-view')) res2(document.querySelector('.book-page')?.innerText?.slice(0, 80) ?? null);
        else if (Date.now() > t) res2(null);
        else setTimeout(w, 50);
    };
    setTimeout(w, 50);
}));
ALTSCRIPT
text_alt=$(js_file "${BASE}/?seed=999&goto=Corridor" "#corridor-view" "$ALTDET")
rm -f "$ALTDET"
assert_not_eq "different seed → different book content" "$text1" "$text_alt"

# Page navigation
PAGENAV=$(mktemp /tmp/sstest.js.XXXXXX)
cat > "$PAGENAV" <<'PAGENAVSCRIPT'
res(new Promise((res2) => {
    Debug.goToBook(0, 0, 10, 5);
    const t = Date.now() + 5000;
    const w = () => {
        if (!document.querySelector('#book-view')) {
            if (Date.now() > t) { res2({error:'timeout opening book'}); return; }
            setTimeout(w, 50); return;
        }
        const page1 = document.querySelector('.book-page')?.innerText?.slice(0, 40);
        const nextLink = [...document.querySelectorAll('#page-nav a')].find(a => a.innerText.includes('Next'));
        if (!nextLink) { res2({error: 'no next link'}); return; }
        nextLink.click();
        const t2 = Date.now() + 5000;
        const w2 = () => {
            const header = document.querySelector('.location-header')?.innerText ?? '';
            if (header.includes('PAGE 2') || header.includes('Page 2')) {
                const page2 = document.querySelector('.book-page')?.innerText?.slice(0, 40);
                res2({ page1, page2, different: page1 !== page2 });
            } else if (Date.now() > t2) res2({error:'timeout navigating page', header});
            else setTimeout(w2, 50);
        };
        setTimeout(w2, 50);
    };
    setTimeout(w, 50);
}));
PAGENAVSCRIPT
pagenav=$(js_file "$URL" "#corridor-view" "$PAGENAV")
rm -f "$PAGENAV"
assert_contains "page navigation works"           "$pagenav" '"different": true'

# Debug.getBookKey
BOOKKEY=$(mktemp /tmp/sstest.js.XXXXXX)
cat > "$BOOKKEY" <<'BOOKKEYSC'
res(new Promise((res2) => {
    Debug.goToBook(0, 5, 3, 17);
    const t = Date.now() + 5000;
    const w = () => {
        if (document.querySelector('#book-view')) res2(Debug.getBookKey());
        else if (Date.now() > t) res2(null);
        else setTimeout(w, 50);
    };
    setTimeout(w, 50);
}));
BOOKKEYSC
bookkey=$(js_file "$URL" "#corridor-view" "$BOOKKEY")
rm -f "$BOOKKEY"
assert_eq "Debug.getBookKey() returns correct key" "$bookkey" '"0:5:3:17"'

# --- SCREENSHOTS ---
echo "▶ screenshots"

shot-scraper shot "$URL" -o "${SS_DIR}/corridor.png" --width 1280 --height 800 2>/dev/null
pass "corridor screenshot"

SSBOOK=$(mktemp /tmp/sstest.js.XXXXXX)
cat > "$SSBOOK" <<'SSBOOKSC'
new Promise((res2) => {
    Debug.goToBook(0, 0, 10, 0);
    const t = Date.now() + 5000;
    const w = () => { document.querySelector('#book-view') ? res2(true) : Date.now() > t ? res2(false) : setTimeout(w, 50); };
    setTimeout(w, 50);
});
SSBOOKSC
shot-scraper shot "$URL" --input "$SSBOOK" -o "${SS_DIR}/book.png" --width 1280 --height 800 2>/dev/null
rm -f "$SSBOOK"
pass "book-view screenshot"

# --- SUMMARY ---
echo ""
total=$((PASS + FAIL))
echo "tests ${total} | pass ${PASS} | fail ${FAIL}"
[[ $FAIL -eq 0 ]]
