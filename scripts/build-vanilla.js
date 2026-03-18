#!/usr/bin/env node
// Builds dist/index.html by bundling JS with esbuild and inlining CSS + content.

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { buildSync } from "esbuild";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, "..");

function readOrDie(path, label) {
    try { return readFileSync(path, "utf8"); }
    catch (e) { console.error(`Build error: cannot read ${label} (${path}): ${e.message}`); process.exit(1); }
}

// Read template
let html = readOrDie(resolve(ROOT, "src/html/index.html"), "HTML template");

// Inline CSS (main + godmode), with local fonts base64-encoded
let css = readOrDie(resolve(ROOT, "src/css/style.css"), "main CSS") +
    "\n" + readOrDie(resolve(ROOT, "src/css/godmode.css"), "godmode CSS");
// Replace font url() references with inline base64 data URIs
css = css.replace(/url\(['"]?\.\.\/fonts\/([^'")]+)['"]?\)/g, (match, filename) => {
    const fontPath = resolve(ROOT, "src/fonts", filename);
    try {
        const b64 = readFileSync(fontPath).toString("base64");
        return `url(data:font/ttf;base64,${b64})`;
    } catch {
        console.warn(`Warning: font not found: ${fontPath}`);
        return match;
    }
});
html = html.replace("/* INJECT:CSS */", css);

// Bundle JS via esbuild
const skipDebug = process.env.PRODUCTION === "1";
const entryPoint = resolve(ROOT, "src/js/main.js");

const result = buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    minify: false,
    // Drop debug module in production
    ...(skipDebug ? { drop: [], define: {} } : {}),
});

const jsBundle = result.outputFiles[0].text;

// Assemble window.TEXT from content/*.json
const contentDir = resolve(ROOT, "content");
const contentMap = {
    "events.json":    "events",
    "npcs.json":      null,
    "screens.json":   "screens",
    "lifestory.json": "lifestory",
    "stats.json":     "stats",
    "stories.json":   "stories",
    "dictionary.json": "dictionary",
    "madlibs.json":    "madlibs",
    "godmode.json":    "godmode",
};
const TEXT = {};
for (const [file, key] of Object.entries(contentMap)) {
    const raw = readOrDie(resolve(contentDir, file), `content/${file}`);
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { console.error(`Build error: invalid JSON in content/${file}: ${e.message}`); process.exit(1); }
    if (key) {
        TEXT[key] = data;
    } else {
        TEXT.npc_first_names = data.first_names;
        TEXT.npc_surnames = data.surnames;
        TEXT.npc_dialogue = data.dialogue;
    }
}
const textBlock = "<script>window.TEXT = " + JSON.stringify(TEXT) + ";</script>";

const jsBlock = "<script>\n" + jsBundle + "\n</script>";
html = html.replace("<!-- INJECT:JS -->", textBlock + "\n" + jsBlock);

writeFileSync(resolve(ROOT, "dist/index.html"), html, "utf8");
console.log("Built: dist/index.html");
