#!/usr/bin/env node
/**
 * Replay a playthrough log as a browser video recording.
 *
 * Takes the JSON output of generate-playthrough.ts and replays it in
 * a real browser via Playwright, capturing video.
 *
 * Video structure:
 *   1. Navigation montage (~90-120s): corridor view, days flying by
 *   2. Search montage (~60-90s): books opening and closing
 *   3. The find + win (~15-30s): slow dramatic reveal
 *
 * Usage:
 *   npx tsx scripts/replay-video.ts playthrough-666.json
 *
 * Output: recordings/playthrough-<seed>.mp4
 *
 * Requires: built dist/index.html, Playwright, ffmpeg.
 */

import { chromium } from "playwright";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// --- CLI ---

const logFile = process.argv[2];
if (!logFile) {
    console.error("Usage: npx tsx scripts/replay-video.ts <playthrough.json>");
    process.exit(1);
}

const log = JSON.parse(fs.readFileSync(logFile, "utf-8"));
const seed = log.seed;
const keyframes = log.keyframes;

console.log(`Seed: ${seed}`);
console.log(`Keyframes: ${keyframes.length}`);
console.log(`Result: ${log.result.won ? "WIN" : "LOSS"} in ${log.result.days.toLocaleString()} days`);

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist", "index.html");
const OUT_DIR = path.join(ROOT, "recordings");

// --- Inject state into the browser and re-render ---

function corridorJS(kf: any): string {
    return `
        state.position = ${kf.position}n;
        state.floor = ${kf.floor}n;
        state.side = ${kf.side};
        state.day = ${kf.day};
        state.tick = ${kf.tick};
        state.lightsOn = ${kf.tick} < 960;
        state.deaths = ${kf.deaths || 0};
        state.dead = false;
        ${kf.stats ? `
        state.hunger = ${kf.stats.hunger};
        state.thirst = ${kf.stats.thirst};
        state.exhaustion = ${kf.stats.exhaustion};
        state.morale = ${kf.stats.morale};
        state.mortality = ${kf.stats.mortality};
        state.despairing = ${kf.despairing ?? false};
        state._despairDays = ${kf.despairDays ?? 0};
        ` : ""}
        Engine.goto("Corridor");
    `;
}

function bookViewJS(kf: any): string {
    const bi = kf.bookIndex ?? 0;
    return `
        state.position = ${kf.position}n;
        state.floor = ${kf.floor}n;
        state.side = ${kf.side};
        state.day = ${kf.day};
        state.tick = ${kf.tick};
        state.lightsOn = true;
        state.openBook = {
            side: ${kf.side},
            position: ${kf.position}n,
            floor: ${kf.floor}n,
            bookIndex: ${bi}
        };
        state.openPage = 1;
        Engine.goto("Shelf Open Book");
    `;
}

async function main() {
    if (!fs.existsSync(DIST)) {
        console.error("Build first: bash build.sh");
        process.exit(1);
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 1024 },
        recordVideo: {
            dir: OUT_DIR,
            size: { width: 1280, height: 1024 },
        },
    });

    const page = await context.newPage();

    // Prevent white flash on load
    await page.addInitScript(() => {
        document.addEventListener("DOMContentLoaded", () => {
            document.documentElement.style.background = "#0a0806";
        });
    });

    // Start with normal game flow (Life Story screen)
    const url = `file://${DIST}?seed=${seed}`;
    await page.goto(url);
    await page.waitForSelector("#lifestory-view", { timeout: 10000 });
    console.log("Game loaded.");

    // Override targetBook and position to match playthrough coordinates
    const tb = log.targetBook;
    const ps = log.playerStart;
    await page.evaluate(`
        state.debug = false;
        state.side = ${ps.side};
        state.position = ${ps.position}n;
        state.floor = ${ps.floor}n;
        state._spawnSide = ${ps.side};
        state._spawnPosition = ${ps.position}n;
        state._spawnFloor = ${ps.floor}n;
        state.targetBook = {
            side: ${tb.side},
            position: ${tb.position}n,
            floor: ${tb.floor}n,
            bookIndex: ${tb.bookIndex}
        };
        state.lifeStory = ${JSON.stringify(log.lifeStory)};
        Engine.goto("Life Story");
    `);
    // Hold on Life Story
    await page.waitForTimeout(6000);

    // Transition to Corridor
    await page.evaluate(`Engine.goto("Corridor");`);
    await page.waitForTimeout(2000);

    let currentPhase = "navigate";
    let bookCount = 0;
    const totalBooks = keyframes.filter((kf: any) => kf.type === "book").length;
    const navKeyframes = keyframes.filter((kf: any) => kf.type === "day" || (kf.type === "phase" && kf.phase === "navigate")).length;

    for (let i = 0; i < keyframes.length; i++) {
        const kf = keyframes[i];

        // Phase transition
        if (kf.type === "phase") {
            if (kf.phase !== currentPhase) {
                currentPhase = kf.phase;
                console.log(`Phase: ${currentPhase} (keyframe ${i}/${keyframes.length})`);
            }
            await page.evaluate(corridorJS(kf));
            if (currentPhase === "sweep") {
                await page.waitForTimeout(2000);
            } else {
                await page.waitForTimeout(500);
            }
            continue;
        }

        // --- Mercy kiosk ---
        if (kf.type === "mercy") {
            const side = kf.mercySide;
            await page.evaluate(`
                if (!state._mercyKiosks) state._mercyKiosks = {};
                state._mercyKiosks["${side}"] = true;
                state._mercyArrival = "${side}";
                state.despairing = false;
            `);
            await page.evaluate(corridorJS(kf));
            await page.waitForTimeout(5000);
            continue;
        }

        // --- Win ---
        if (kf.type === "win") {
            const tb = log.targetBook;

            // Open the target book — page 1, legible text (the reveal)
            await page.evaluate(`
                state.position = ${tb.position}n;
                state.floor = ${tb.floor}n;
                state.side = ${tb.side};
                state.day = ${kf.day};
                state.lightsOn = true;
                state.openBook = {
                    side: ${tb.side},
                    position: ${tb.position}n,
                    floor: ${tb.floor}n,
                    bookIndex: ${tb.bookIndex}
                };
                state.openPage = 1;
                Engine.goto("Shelf Open Book");
            `);
            await page.waitForTimeout(4000);

            // Flip through the book — it's all legible
            for (const pg of [3, 70, 151, 366]) {
                await page.evaluate(`state.openPage = ${pg}; Engine.goto("Shelf Open Book");`);
                await page.waitForTimeout(1500);
            }

            // Take the book, back to corridor
            await page.evaluate(`
                state.heldBook = {
                    side: ${tb.side},
                    position: ${tb.position}n,
                    floor: ${tb.floor}n,
                    bookIndex: ${tb.bookIndex}
                };
                state.openBook = null;
                Engine.goto("Corridor");
            `);
            await page.waitForTimeout(1500);

            // Submission screen
            await page.evaluate(`Engine.goto("Submission Slot");`);
            await page.waitForTimeout(2000);

            // Win
            await page.evaluate(`
                state.won = true;
                state.submissionsAttempted = 1;
                state.day = ${kf.day};
                state.deaths = ${kf.deaths || 0};
                Engine.goto("Win");
            `);
            await page.waitForTimeout(8000);
            continue;
        }

        // --- Death ---
        if (kf.type === "death") {
            await page.evaluate(`
                state.dead = true;
                state.deathCause = "starvation";
                state.day = ${kf.day};
                Engine.goto("Death");
            `);
            await page.waitForTimeout(800);
            continue;
        }

        // --- Book read during sweep ---
        if (kf.type === "book") {
            bookCount++;
            const remaining = totalBooks - bookCount;
            // Track opened book in dwellHistory
            const bi = kf.bookIndex ?? 0;
            await page.evaluate(`
                if (!state.dwellHistory) state.dwellHistory = {};
                state.dwellHistory["${kf.side}:${kf.position}:${kf.floor}:${bi}"] = true;
            `);

            // Show a couple books opened for flavor
            const showOpen = bookCount === 1 || bookCount === 500;
            if (showOpen) {
                await page.evaluate(bookViewJS(kf));
                await page.waitForTimeout(2000);
                // Close — back to corridor
                await page.evaluate(`state.openBook = null; state.openPage = 0;`);
                await page.evaluate(corridorJS(kf));
                await page.waitForTimeout(300);
            } else {
                // Corridor view updates with each read
                await page.evaluate(corridorJS(kf));
                if (bookCount <= 10) {
                    await page.waitForTimeout(150);
                } else {
                    await page.waitForTimeout(30);
                }
            }
            continue;
        }

        // --- Day keyframe (navigation) ---
        if (kf.type === "day") {
            // Target ~120s for 414 navigation keyframes
            // ~290ms per keyframe average
            // Vary: slow start, fast middle, slow approach to destination
            const navIndex = keyframes.slice(0, i + 1).filter((k: any) => k.type === "day").length;
            const navPct = navIndex / navKeyframes;

            // Accelerate through the journey, hit the boundary abruptly
            let delay: number;
            if (navPct < 0.05) {
                // First 5%: establishing
                delay = 250;
            } else if (navPct < 0.15) {
                // Ramp up
                delay = 150;
            } else {
                // Everything else: fast, accelerating slightly
                delay = Math.max(40, Math.round(80 * (1 - navPct)));
            }

            await page.evaluate(corridorJS(kf));
            await page.waitForTimeout(delay);
            continue;
        }
    }

    // Final hold
    await page.waitForTimeout(2000);

    // Close page and wait for video to be written
    const videoPath = await page.video()?.path();
    await page.close();
    await context.close();
    await browser.close();

    if (!videoPath || !fs.existsSync(videoPath)) {
        console.error("Warning: video file not found at", videoPath);
        return;
    }

    // Convert webm → mp4
    const webmDest = path.join(OUT_DIR, `playthrough-${seed}.webm`);
    const mp4Dest = path.join(OUT_DIR, `playthrough-${seed}.mp4`);
    if (fs.existsSync(webmDest)) fs.unlinkSync(webmDest);
    if (fs.existsSync(mp4Dest)) fs.unlinkSync(mp4Dest);
    fs.renameSync(videoPath, webmDest);

    console.log("Converting to MP4...");
    try {
        execSync(`ffmpeg -y -i "${webmDest}" -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p "${mp4Dest}"`, { stdio: "pipe" });
        const size = fs.statSync(mp4Dest).size;
        console.log(`Video saved: ${mp4Dest} (${(size / 1024 / 1024).toFixed(1)}MB)`);
        // Keep the webm too in case it's useful
    } catch (e: any) {
        console.error("ffmpeg conversion failed, keeping webm:", e.message);
        console.log(`Video saved: ${webmDest}`);
    }

    console.log("Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
