import { test, expect } from "@playwright/test";

const URL = "http://localhost:3219/?godmode=1&seed=test42";

test.describe("godmode basics", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(URL);
        await page.waitForSelector("#godmode-container");
    });

    test("loads godmode UI", async ({ page }) => {
        await expect(page.locator("#godmode-container")).toBeVisible();
        await expect(page.locator("#godmode-canvas")).toBeVisible();
        await expect(page.locator("#godmode-controls")).toBeVisible();
        await expect(page.locator("#godmode-panel")).toBeVisible();
    });

    test("shows day and time in controls", async ({ page }) => {
        const day = page.locator("#gm-day");
        await expect(day).toHaveText(/Day \d+/);
        const tick = page.locator("#gm-tick");
        await expect(tick).toHaveText(/\d{2}:\d{2}/);
    });

    test("shows alive count in status", async ({ page }) => {
        await expect(page.locator("#gm-status")).toHaveText(/\d+\/\d+ alive/);
    });

    test("shows zoom level", async ({ page }) => {
        await expect(page.locator("#gm-zoom")).toHaveText(/[\d.]+x/);
    });

    test("shows viewport position", async ({ page }) => {
        await expect(page.locator("#gm-pos")).toHaveText(/s-?\d+ f\d+/);
    });
});

test.describe("godmode controls", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(URL);
        await page.waitForSelector("#godmode-container");
    });

    test("play/pause toggles", async ({ page }) => {
        const btn = page.locator("#gm-play");
        // First click: pause → play
        await btn.click();
        const text1 = await btn.textContent();
        // Second click: play → pause
        await btn.click();
        const text2 = await btn.textContent();
        expect(text1).not.toEqual(text2);
        // Third click: pause → play (same as first)
        await btn.click();
        const text3 = await btn.textContent();
        expect(text1).toEqual(text3);
    });

    test("step advances tick", async ({ page }) => {
        const tick1 = await page.locator("#gm-tick").textContent();
        await page.locator("#gm-step").click();
        await expect(page.locator("#gm-tick")).not.toHaveText(tick1);
    });

    test("home button resets view", async ({ page }) => {
        // Pan away first
        await page.keyboard.press("ArrowUp");
        await page.keyboard.press("ArrowUp");
        await page.keyboard.press("ArrowUp");
        // Wait for position to change from initial
        const initialPos = await page.locator("#gm-pos").textContent();

        // Hit home
        await page.locator("#gm-home").click();
        await expect(page.locator("#gm-pos")).not.toHaveText(initialPos);
        await expect(page.locator("#gm-zoom")).toHaveText("1x");
    });

    test("skip to dawn advances day", async ({ page }) => {
        await page.locator("#gm-skip-dawn").click();
        // Should advance to next dawn — time should be 06:00
        await expect(page.locator("#gm-tick")).toHaveText("06:00");
    });
});

test.describe("godmode zoom", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(URL);
        await page.waitForSelector("#godmode-container");
    });

    test("scroll wheel zooms", async ({ page }) => {
        const canvas = page.locator("#godmode-canvas");
        const zoom1 = await page.locator("#gm-zoom").textContent();

        // Zoom out
        await canvas.hover();
        await page.mouse.wheel(0, 100);
        await expect(page.locator("#gm-zoom")).not.toHaveText(zoom1);
    });

    test("keyboard +/- zooms", async ({ page }) => {
        const zoom1 = await page.locator("#gm-zoom").textContent();
        await page.keyboard.press("-");
        await expect(page.locator("#gm-zoom")).not.toHaveText(zoom1);
        const zoom2 = await page.locator("#gm-zoom").textContent();

        await page.keyboard.press("=");
        await expect(page.locator("#gm-zoom")).not.toHaveText(zoom2);
    });
});

test.describe("godmode panel", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(URL);
        await page.waitForSelector("#godmode-container");
    });

    test("tab switching works", async ({ page }) => {
        // Log tab should be active by default
        await expect(page.locator("#gm-tab-log")).toHaveClass(/gm-tab-active/);

        // Switch to NPC tab
        await page.locator("#gm-tab-npc").click();
        await expect(page.locator("#gm-tab-npc")).toHaveClass(/gm-tab-active/);
        await expect(page.locator("#gm-tab-log")).not.toHaveClass(/gm-tab-active/);
    });

    test("NPC list populates", async ({ page }) => {
        await page.locator("#gm-tab-npc").click();
        // Step a tick to trigger panel render
        await page.locator("#gm-step").click();
        const rows = page.locator(".gm-npc-row");
        await expect(rows.first()).toBeVisible({ timeout: 2000 });
        const count = await rows.count();
        expect(count).toBeGreaterThan(0);
    });

    test("clicking NPC shows detail", async ({ page }) => {
        await page.locator("#gm-tab-npc").click();
        await expect(page.locator(".gm-npc-row").first()).toBeVisible();
        await page.locator(".gm-npc-row").first().click();
        await expect(page.locator(".gm-name")).toBeVisible();
        await expect(page.locator("#gm-npc-back")).toBeVisible();
    });

    test("back button returns to list", async ({ page }) => {
        await page.locator("#gm-tab-npc").click();
        await expect(page.locator(".gm-npc-row").first()).toBeVisible();
        await page.locator(".gm-npc-row").first().click();
        await expect(page.locator("#gm-npc-back")).toBeVisible();
        await page.locator("#gm-npc-back").click();
        await expect(page.locator(".gm-npc-list")).toBeVisible();
    });

    test("possess button exists for alive NPC", async ({ page }) => {
        await page.locator("#gm-tab-npc").click();
        await expect(page.locator(".gm-npc-row").first()).toBeVisible();
        await page.locator(".gm-npc-row").first().click();
        await expect(page.locator("#gm-possess")).toBeVisible();
    });

    test("possess switches to game view", async ({ page }) => {
        await page.locator("#gm-tab-npc").click();
        await expect(page.locator(".gm-npc-row").first()).toBeVisible();
        await page.locator(".gm-npc-row").first().click();
        await expect(page.locator("#gm-possess")).toBeVisible();
        await page.locator("#gm-possess").click();

        // Should show possess banner and game content
        await expect(page.locator("#possess-banner")).toBeVisible();
        await expect(page.locator("#passage")).toBeVisible();
        // Godmode container should be hidden
        await expect(page.locator("#godmode-container")).not.toBeVisible();
    });

    test("escape unpossesses", async ({ page }) => {
        await page.locator("#gm-tab-npc").click();
        await expect(page.locator(".gm-npc-row").first()).toBeVisible();
        await page.locator(".gm-npc-row").first().click();
        await expect(page.locator("#gm-possess")).toBeVisible();
        await page.locator("#gm-possess").click();
        await expect(page.locator("#possess-banner")).toBeVisible();

        await page.keyboard.press("Escape");

        // Back to godmode
        await expect(page.locator("#godmode-container")).toBeVisible();
        await expect(page.locator("#possess-banner")).not.toBeVisible();
    });
});

test.describe("godmode map interaction", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(URL);
        await page.waitForSelector("#godmode-container");
    });

    test("drag pans the viewport", async ({ page }) => {
        const canvas = page.locator("#godmode-canvas");
        const pos1 = await page.locator("#gm-pos").textContent();

        // Drag down (which pans up in world coords)
        const box = await canvas.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 100, { steps: 5 });
        await page.mouse.up();

        await expect(page.locator("#gm-pos")).not.toHaveText(pos1);
    });

    test("click on canvas deselects NPC", async ({ page }) => {
        // Select an NPC first via panel
        await page.locator("#gm-tab-npc").click();
        await expect(page.locator(".gm-npc-row").first()).toBeVisible();
        await page.locator(".gm-npc-row").first().click();
        await expect(page.locator(".gm-name")).toBeVisible();

        // Click empty canvas area (far corner unlikely to hit an NPC dot)
        const canvas = page.locator("#godmode-canvas");
        const box = await canvas.boundingBox();
        await page.mouse.click(box.x + 10, box.y + 10);

        // Detail view should disappear, list should return
        await expect(page.locator(".gm-name")).not.toBeVisible();
        await expect(page.locator(".gm-npc-list")).toBeVisible();
    });
});
