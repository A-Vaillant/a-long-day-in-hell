/**
 * DOM test harness — loads the full game into a jsdom window.
 *
 * Usage:
 *   import { createGame } from "./dom-harness.js";
 *   const { window, document, state, Engine } = createGame();
 *
 * Each call returns a fresh, isolated game instance.
 * Engine.init() is NOT called automatically — tests control boot.
 */

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { buildSync } from "esbuild";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");

const HTML_TEMPLATE = readFileSync(resolve(ROOT, "src/html/index.html"), "utf8")
    .replace("/* INJECT:CSS */", "/* tests skip CSS */");

// Bundle the game JS via esbuild (same as build-vanilla.js)
const entryPoint = resolve(ROOT, "src/js/main.js");
const bundleResult = buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    minify: false,
});
const bundledJS = bundleResult.outputFiles[0].text;

// Strip the auto-boot block from the bundle so tests control init.
// The boot code is at the end: `if (document.readyState ...` through to Engine.init()
// Two patterns: one for the source comment (if esbuild preserves it),
// one for the bare if/else readyState block (esbuild strips comments).
const bootPattern = /(?:\/\/ Boot when DOM is ready\s*)?if\s*\(document\.readyState\s*===\s*"loading"\)\s*\{[\s\S]*?Engine\.init\(\);\s*\}\s*\)\s*;\s*\}\s*else\s*\{\s*Engine\.init\(\);\s*\}/;
const testJS = bundledJS.replace(bootPattern, "// Auto-boot disabled for tests");

// Build window.TEXT from content/*.json (mirrors build-vanilla.js)
const contentDir = resolve(ROOT, "content");
const contentMap = {
    "events.json": "events",
    "npcs.json": null,
    "screens.json": "screens",
    "lifestory.json": "lifestory",
    "stats.json": "stats",
    "stories.json": "stories",
    "dictionary.json": "dictionary",
    "madlibs.json": "madlibs",
    "godmode.json": "godmode",
};
const TEXT = {};
for (const [file, key] of Object.entries(contentMap)) {
    const data = JSON.parse(readFileSync(resolve(contentDir, file), "utf8"));
    if (key) {
        TEXT[key] = data;
    } else {
        TEXT.npc_first_names = data.first_names;
        TEXT.npc_surnames = data.surnames;
        TEXT.npc_dialogue = data.dialogue;
    }
}

/**
 * Create a fresh game environment. Returns { window, document, state, Engine }.
 * Engine.init() is NOT called — call it yourself or use bootGame() for a
 * fully initialized game at the Corridor screen.
 */
export function createGame() {
    const dom = new JSDOM(HTML_TEMPLATE, {
        url: "http://localhost/",
        pretendToBeVisual: true,
        runScripts: "dangerously",
    });
    const win = dom.window;

    // Inject TEXT
    const textEl = win.document.createElement("script");
    textEl.textContent = "window.TEXT = " + JSON.stringify(TEXT) + ";";
    win.document.body.appendChild(textEl);

    // Inject bundled game code
    const scriptEl = win.document.createElement("script");
    scriptEl.textContent = testJS;
    win.document.body.appendChild(scriptEl);

    return {
        window: win,
        document: win.document,
        get state() { return win.state; },
        get Engine() { return win.Engine; },
        get PRNG() { return win.PRNG; },
        get Surv() { return win.Surv; },
        get Tick() { return win.Tick; },
        get Events() { return win.Events; },
        get Npc() { return win.Npc; },
        get Social() { return win.Social; },
        get Despair() { return win.Despair; },
        get Actions() { return win.Actions; },
        get EventLog() { return win.EventLog; },
        dom,
    };
}

/**
 * Create a fully booted game at the Corridor screen with a fixed seed.
 * Convenience for tests that don't care about the init sequence.
 */
export function bootGame(seed = "test-seed-42") {
    const game = createGame();
    game.PRNG.seed(seed);
    const win = game.window;
    win.state.seed = seed;
    win.state.side = 0;
    win.state.position = 0n;
    win.state.floor = 10n;
    win.state.move = "";
    win.state.heldBook = null;
    win.state.shelfOffset = 0;
    win.state.openBook = null;
    win.state.openPage = 0;
    win.state.debug = true;
    win.state.deaths = 0;
    win.state.deathCause = null;

    const { playerBookAddress, story } = win.LifeStory.generatePlayerWorld(seed, {
        startLoc: { side: 0, position: 0n, floor: 10n },
    });
    win.state.playerBookAddress = playerBookAddress;
    win.state.lifeStory = story;
    win.state.targetBook = story.bookCoords;
    win.state.playerRawAddress = story.rawBookAddress;
    win.state._spawnSide = win.state.side;
    win.state._spawnPosition = win.state.position;
    win.state._spawnFloor = win.state.floor;

    game.Surv.init();
    game.Tick.init();
    game.Events.init();
    game.Npc.init();
    game.Social.init();
    game.Tick.registerBoundaryHandlers();

    // Set up event delegation (mirrors Engine.init)
    function handleDataGoto(ev) {
        var link = ev.target.closest("[data-goto]");
        if (!link) return;
        ev.preventDefault();
        var actionName = link.getAttribute("data-action");
        if (actionName && game.Engine._actions[actionName]) {
            game.Engine._actions[actionName]();
        }
        game.Engine.goto(link.getAttribute("data-goto"));
    }
    game.document.getElementById("passage").addEventListener("click", handleDataGoto);
    game.document.getElementById("story-caption").addEventListener("click", handleDataGoto);

    game.Engine.goto("Corridor");
    return game;
}

/**
 * Reset an existing game instance to boot-fresh state, reusing the JSDOM
 * window. Much faster than bootGame() since it skips JSDOM + bundle setup.
 * Boundary handlers and click delegation are already registered.
 */
export function resetGame(game, seed = "test-seed-42") {
    const win = game.window;
    game.PRNG.seed(seed);
    win.state.seed = seed;
    win.state.side = 0;
    win.state.position = 0n;
    win.state.floor = 10n;
    win.state.move = "";
    win.state.heldBook = null;
    win.state.shelfOffset = 0;
    win.state.openBook = null;
    win.state.openPage = 0;
    win.state.debug = true;
    win.state.deaths = 0;
    win.state.deathCause = null;
    win.state.dead = false;
    win.state.won = false;
    win.state._submissionWon = false;
    win.state.screen = null;
    win.state.falling = null;
    win.state.fallSpeed = 0;
    win.state.fallDistance = 0n;
    win.state.fallGrabFailed = false;
    win.state.bookNames = {};
    win.state.dwellHistory = {};
    win.state._menuReturn = null;
    win.state._menuConfirmNew = false;
    win.state._menuConfirmDelete = null;
    win.state._talkTarget = null;
    win.state._passedOut = false;
    win.state._grabFailed = null;
    win.state._playerComponents = null;
    win.state._debugAllowed = false;
    win.state.lightsOn = true;
    win.state.despairing = false;
    win.state.godmoded = false;

    const { playerBookAddress, story } = win.LifeStory.generatePlayerWorld(seed, {
        startLoc: { side: 0, position: 0n, floor: 10n },
    });
    win.state.playerBookAddress = playerBookAddress;
    win.state.lifeStory = story;
    win.state.targetBook = story.bookCoords;
    win.state.playerRawAddress = story.rawBookAddress;
    win.state._spawnSide = win.state.side;
    win.state._spawnPosition = win.state.position;
    win.state._spawnFloor = win.state.floor;

    // Re-init safe subsystems (all idempotent — overwrite state fields)
    game.Surv.init();
    game.Tick.init();
    game.Events.init();
    game.Npc.init();
    game.Social.init();
    // Skip registerBoundaryHandlers — already registered from initial boot

    game.Engine.goto("Corridor");
    return game;
}
