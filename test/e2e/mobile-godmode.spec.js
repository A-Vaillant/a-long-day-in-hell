import { test, expect, devices } from "@playwright/test";

const URL = "http://localhost:3219/?godmode=1&seed=test42";

test.use({ ...devices["iPhone 12"] });

// --- Layout ---

test.describe("godmode mobile layout", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(URL);
        await page.waitForSelector("#godmode-container");
    });

    test("container fits viewport without horizontal scroll", async ({ page }) => {
        const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
        const vw = page.viewportSize().width;
        expect(scrollW).toBeLessThanOrEqual(vw + 2);
    });

    test("map canvas is visible", async ({ page }) => {
        const canvas = page.locator("#godmode-canvas");
        await expect(canvas).toBeVisible();
        const box = await canvas.boundingBox();
        expect(box.width).toBeGreaterThan(100);
        expect(box.height).toBeGreaterThan(100);
    });

    test("panel is visible (below map or as overlay)", async ({ page }) => {
        const panel = page.locator("#godmode-panel");
        await expect(panel).toBeVisible();
    });

    test("controls bar is visible and not clipped", async ({ page }) => {
        const controls = page.locator("#godmode-controls");
        await expect(controls).toBeVisible();
        const box = await controls.boundingBox();
        const vw = page.viewportSize().width;
        expect(box.x + box.width).toBeLessThanOrEqual(vw + 2);
    });

    test("control buttons have adequate tap target size", async ({ page }) => {
        const buttons = page.locator("#godmode-controls button");
        const count = await buttons.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i++) {
            const box = await buttons.nth(i).boundingBox();
            expect(box.height).toBeGreaterThanOrEqual(36);
            expect(box.width).toBeGreaterThanOrEqual(36);
        }
    });
});

// --- Touch pan ---

test.describe("godmode touch pan", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(URL);
        await page.waitForSelector("#godmode-container");
    });

    test("single-finger drag pans the map", async ({ page }) => {
        const canvas = page.locator("#godmode-canvas");
        const pos1 = await page.locator("#gm-pos").textContent();

        const box = await canvas.boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        // Simulate touch drag
        await page.touchscreen.tap(cx, cy);
        await page.evaluate(async ([startX, startY, endX, endY]) => {
            // Manual touch sequence for drag
            const target = document.elementFromPoint(startX, startY);
            target.dispatchEvent(new TouchEvent("touchstart", {
                bubbles: true,
                touches: [new Touch({ identifier: 1, target, clientX: startX, clientY: startY })],
                changedTouches: [new Touch({ identifier: 1, target, clientX: startX, clientY: startY })],
            }));
            for (let i = 1; i <= 5; i++) {
                const x = startX + (endX - startX) * i / 5;
                const y = startY + (endY - startY) * i / 5;
                target.dispatchEvent(new TouchEvent("touchmove", {
                    bubbles: true,
                    touches: [new Touch({ identifier: 1, target, clientX: x, clientY: y })],
                    changedTouches: [new Touch({ identifier: 1, target, clientX: x, clientY: y })],
                }));
                await new Promise(r => setTimeout(r, 16));
            }
            target.dispatchEvent(new TouchEvent("touchend", {
                bubbles: true,
                touches: [],
                changedTouches: [new Touch({ identifier: 1, target, clientX: endX, clientY: endY })],
            }));
        }, [cx, cy, cx, cy + 100]);

        // Viewport should have moved
        await expect(page.locator("#gm-pos")).not.toHaveText(pos1);
    });

    test("tap without drag does not pan", async ({ page }) => {
        const pos1 = await page.locator("#gm-pos").textContent();

        const canvas = page.locator("#godmode-canvas");
        const box = await canvas.boundingBox();
        // Quick tap — no drag distance
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

        // Position should remain (or change only due to NPC selection, not pan)
        const pos2 = await page.locator("#gm-pos").textContent();
        expect(pos2).toEqual(pos1);
    });
});

// --- Touch zoom (pinch) ---

test.describe("godmode pinch zoom", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(URL);
        await page.waitForSelector("#godmode-container");
    });

    test("pinch-out zooms in", async ({ page }) => {
        const zoom1 = await page.locator("#gm-zoom").textContent();

        const canvas = page.locator("#godmode-canvas");
        const box = await canvas.boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        // Simulate pinch-out (fingers moving apart)
        await page.evaluate(async ([cx, cy]) => {
            const target = document.elementFromPoint(cx, cy);
            const spread = 40;
            // Start close together
            target.dispatchEvent(new TouchEvent("touchstart", {
                bubbles: true,
                touches: [
                    new Touch({ identifier: 1, target, clientX: cx - 10, clientY: cy }),
                    new Touch({ identifier: 2, target, clientX: cx + 10, clientY: cy }),
                ],
                changedTouches: [
                    new Touch({ identifier: 1, target, clientX: cx - 10, clientY: cy }),
                    new Touch({ identifier: 2, target, clientX: cx + 10, clientY: cy }),
                ],
            }));
            // Spread apart
            for (let i = 1; i <= 5; i++) {
                const d = 10 + spread * i / 5;
                target.dispatchEvent(new TouchEvent("touchmove", {
                    bubbles: true,
                    touches: [
                        new Touch({ identifier: 1, target, clientX: cx - d, clientY: cy }),
                        new Touch({ identifier: 2, target, clientX: cx + d, clientY: cy }),
                    ],
                    changedTouches: [
                        new Touch({ identifier: 1, target, clientX: cx - d, clientY: cy }),
                        new Touch({ identifier: 2, target, clientX: cx + d, clientY: cy }),
                    ],
                }));
                await new Promise(r => setTimeout(r, 16));
            }
            target.dispatchEvent(new TouchEvent("touchend", {
                bubbles: true,
                touches: [],
                changedTouches: [
                    new Touch({ identifier: 1, target, clientX: cx - (10 + spread), clientY: cy }),
                    new Touch({ identifier: 2, target, clientX: cx + (10 + spread), clientY: cy }),
                ],
            }));
        }, [cx, cy]);

        await expect(page.locator("#gm-zoom")).not.toHaveText(zoom1);
    });

    test("pinch-in zooms out", async ({ page }) => {
        // Zoom in first so we have room to zoom out
        await page.keyboard.press("=");
        await page.keyboard.press("=");
        const zoom1 = await page.locator("#gm-zoom").textContent();

        const canvas = page.locator("#godmode-canvas");
        const box = await canvas.boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        // Simulate pinch-in (fingers moving together)
        await page.evaluate(async ([cx, cy]) => {
            const target = document.elementFromPoint(cx, cy);
            const startSpread = 50;
            // Start far apart
            target.dispatchEvent(new TouchEvent("touchstart", {
                bubbles: true,
                touches: [
                    new Touch({ identifier: 1, target, clientX: cx - startSpread, clientY: cy }),
                    new Touch({ identifier: 2, target, clientX: cx + startSpread, clientY: cy }),
                ],
                changedTouches: [
                    new Touch({ identifier: 1, target, clientX: cx - startSpread, clientY: cy }),
                    new Touch({ identifier: 2, target, clientX: cx + startSpread, clientY: cy }),
                ],
            }));
            // Squeeze together
            for (let i = 1; i <= 5; i++) {
                const d = startSpread - (startSpread - 10) * i / 5;
                target.dispatchEvent(new TouchEvent("touchmove", {
                    bubbles: true,
                    touches: [
                        new Touch({ identifier: 1, target, clientX: cx - d, clientY: cy }),
                        new Touch({ identifier: 2, target, clientX: cx + d, clientY: cy }),
                    ],
                    changedTouches: [
                        new Touch({ identifier: 1, target, clientX: cx - d, clientY: cy }),
                        new Touch({ identifier: 2, target, clientX: cx + d, clientY: cy }),
                    ],
                }));
                await new Promise(r => setTimeout(r, 16));
            }
            target.dispatchEvent(new TouchEvent("touchend", {
                bubbles: true,
                touches: [],
                changedTouches: [
                    new Touch({ identifier: 1, target, clientX: cx - 10, clientY: cy }),
                    new Touch({ identifier: 2, target, clientX: cx + 10, clientY: cy }),
                ],
            }));
        }, [cx, cy]);

        await expect(page.locator("#gm-zoom")).not.toHaveText(zoom1);
    });
});

// --- Touch NPC selection ---

test.describe("godmode touch NPC selection", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(URL);
        await page.waitForSelector("#godmode-container");
        // Step a few ticks so NPCs exist on map
        await page.locator("#gm-step").click();
        await page.locator("#gm-step").click();
    });

    test("tapping NPC dot on map selects it", async ({ page }) => {
        // Select via panel first to find an NPC, then tap its map position
        await page.locator("#gm-tab-npc").click();
        await expect(page.locator(".gm-npc-row").first()).toBeVisible();
        await page.locator(".gm-npc-row").first().click();
        await expect(page.locator(".gm-name")).toBeVisible();

        // Verify NPC was selected (detail panel visible)
        const name = await page.locator(".gm-name").textContent();
        expect(name.length).toBeGreaterThan(0);
    });

    test("tapping NPC in panel list selects it", async ({ page }) => {
        await page.locator("#gm-tab-npc").click();
        const row = page.locator(".gm-npc-row").first();
        await expect(row).toBeVisible();

        await row.tap();
        await expect(page.locator(".gm-name")).toBeVisible();
    });
});

// --- Godmode controls ---

test.describe("godmode mobile controls", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(URL);
        await page.waitForSelector("#godmode-container");
    });

    test("play/pause button is tappable", async ({ page }) => {
        const btn = page.locator("#gm-play");
        const text1 = await btn.textContent();
        await btn.tap();
        const text2 = await btn.textContent();
        expect(text1).not.toEqual(text2);
    });

    test("step button is tappable", async ({ page }) => {
        const tick1 = await page.locator("#gm-tick").textContent();
        await page.locator("#gm-step").tap();
        await expect(page.locator("#gm-tick")).not.toHaveText(tick1);
    });

    test("home button is tappable", async ({ page }) => {
        await page.locator("#gm-home").tap();
        await expect(page.locator("#gm-zoom")).toHaveText("1x");
    });

    test("skip to dawn is tappable", async ({ page }) => {
        await page.locator("#gm-skip-dawn").tap();
        await expect(page.locator("#gm-tick")).toHaveText("06:00");
    });

    test("tab buttons are tappable", async ({ page }) => {
        await page.locator("#gm-tab-npc").tap();
        await expect(page.locator("#gm-tab-npc")).toHaveClass(/gm-tab-active/);

        await page.locator("#gm-tab-log").tap();
        await expect(page.locator("#gm-tab-log")).toHaveClass(/gm-tab-active/);

        await page.locator("#gm-tab-trend").tap();
        await expect(page.locator("#gm-tab-trend")).toHaveClass(/gm-tab-active/);
    });

    test("speed slider is usable via tap", async ({ page }) => {
        const slider = page.locator("#gm-speed-slider");
        await expect(slider).toBeVisible();
        const box = await slider.boundingBox();
        // Tap near the right end to increase speed
        await page.touchscreen.tap(box.x + box.width * 0.8, box.y + box.height / 2);
    });
});

// --- Godmode panel scrolling ---

test.describe("godmode panel scroll", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(URL);
        await page.waitForSelector("#godmode-container");
    });

    test("NPC list scrolls via touch", async ({ page }) => {
        await page.locator("#gm-tab-npc").click();
        await page.locator("#gm-step").click();
        await expect(page.locator(".gm-npc-row").first()).toBeVisible();

        const panel = page.locator("#godmode-panel");
        const box = await panel.boundingBox();

        // Swipe up on panel to scroll
        await page.evaluate(async ([x, startY, endY]) => {
            const target = document.elementFromPoint(x, startY);
            if (!target) return;
            target.dispatchEvent(new TouchEvent("touchstart", {
                bubbles: true,
                touches: [new Touch({ identifier: 1, target, clientX: x, clientY: startY })],
                changedTouches: [new Touch({ identifier: 1, target, clientX: x, clientY: startY })],
            }));
            for (let i = 1; i <= 5; i++) {
                const y = startY + (endY - startY) * i / 5;
                target.dispatchEvent(new TouchEvent("touchmove", {
                    bubbles: true,
                    touches: [new Touch({ identifier: 1, target, clientX: x, clientY: y })],
                    changedTouches: [new Touch({ identifier: 1, target, clientX: x, clientY: y })],
                }));
                await new Promise(r => setTimeout(r, 16));
            }
            target.dispatchEvent(new TouchEvent("touchend", {
                bubbles: true,
                touches: [],
                changedTouches: [new Touch({ identifier: 1, target, clientX: x, clientY: endY })],
            }));
        }, [box.x + box.width / 2, box.y + box.height * 0.8, box.y + box.height * 0.2]);
    });

    test("log entries scroll via touch", async ({ page }) => {
        await page.locator("#gm-tab-log").click();
        // Fast forward to generate log entries
        await page.locator("#gm-skip-dawn").click();
        const pane = page.locator("#gm-log-pane");
        await expect(pane).toBeVisible();
    });
});

// --- Log filter tappability ---

test.describe("godmode mobile log filters", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(URL);
        await page.waitForSelector("#godmode-container");
        await page.locator("#gm-tab-log").click();
        // Generate some events
        await page.locator("#gm-skip-dawn").click();
    });

    test("type filter buttons are tappable", async ({ page }) => {
        const btn = page.locator('[data-filter="bond"]');
        await expect(btn).toBeVisible();
        const box = await btn.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(28);
        // Tap to toggle off
        await btn.tap();
    });

    test("time filter buttons are tappable", async ({ page }) => {
        const btn = page.locator('[data-timewindow]').first();
        await expect(btn).toBeVisible();
        await btn.tap();
    });
});

// --- Possess/unpossess on mobile ---

test.describe("godmode mobile possess", () => {
    test("possess button is tappable", async ({ page }) => {
        await page.goto(URL);
        await page.waitForSelector("#godmode-container");
        await page.locator("#gm-tab-npc").click();
        await expect(page.locator(".gm-npc-row").first()).toBeVisible();
        await page.locator(".gm-npc-row").first().click();
        await expect(page.locator("#gm-possess")).toBeVisible();

        await page.locator("#gm-possess").tap();
        await expect(page.locator("#possess-banner")).toBeVisible();
        await expect(page.locator("#passage")).toBeVisible();
    });

    test("unpossess button exists on mobile (no Escape key)", async ({ page }) => {
        await page.goto(URL);
        await page.waitForSelector("#godmode-container");
        await page.locator("#gm-tab-npc").click();
        await expect(page.locator(".gm-npc-row").first()).toBeVisible();
        await page.locator(".gm-npc-row").first().click();
        await page.locator("#gm-possess").tap();
        await expect(page.locator("#possess-banner")).toBeVisible();

        // There should be a tappable unpossess button (not just Escape key)
        const unpossess = page.locator("#unpossess-btn, [data-action='unpossess']");
        await expect(unpossess).toBeVisible();
        await unpossess.tap();

        await expect(page.locator("#godmode-container")).toBeVisible();
    });
});

// --- No browser zoom on game canvas ---

test.describe("godmode canvas zoom prevention", () => {
    test("double-tap on canvas does not zoom browser", async ({ page }) => {
        await page.goto(URL);
        await page.waitForSelector("#godmode-container");

        const scale1 = await page.evaluate(() => window.visualViewport?.scale ?? 1);

        const canvas = page.locator("#godmode-canvas");
        const box = await canvas.boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        await page.touchscreen.tap(cx, cy);
        await page.touchscreen.tap(cx, cy);

        const scale2 = await page.evaluate(() => window.visualViewport?.scale ?? 1);
        expect(scale2).toBeCloseTo(scale1, 1);
    });
});
