import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3219/";
const CORRIDOR = BASE + "?vohu=Corridor&seed=test42";
const LIFE_STORY = BASE + "?seed=test42";

test.describe("Life Story screen", () => {
    test("shows life story text and E continues to Corridor", async ({ page }) => {
        await page.goto(LIFE_STORY);
        await page.waitForSelector("#lifestory-view");
        await expect(page.locator("#lifestory-view")).toBeVisible();
        await expect(page.locator("#passage")).toContainText("Continue");

        await page.keyboard.press("e");
        await page.waitForTimeout(100);
        await expect(page.locator("#corridor-view")).toBeVisible();
    });
});

test.describe("Corridor basics", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
    });

    test("shows location header", async ({ page }) => {
        await expect(page.locator(".location-header")).toHaveText(/The Corridor/);
    });

    test("shows keybinding hints", async ({ page }) => {
        await expect(page.locator("#moves")).toBeVisible();
        await expect(page.locator("#moves")).toContainText("h");
    });

    test("sidebar shows stats", async ({ page }) => {
        const sidebar = page.locator("#story-caption");
        await expect(sidebar).toContainText("hunger");
        await expect(sidebar).toContainText("thirst");
        await expect(sidebar).toContainText("exhaustion");
        await expect(sidebar).toContainText("morale");
    });
});

test.describe("Movement", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
    });

    test("h moves left (position decreases)", async ({ page }) => {
        // Debug is already on via ?vohu=
        const pre = page.locator("#debug-panel pre");
        const text1 = await pre.textContent();
        const pos1 = text1.match(/Position:\s*(-?\d+)/)[1];

        await page.keyboard.press("h");
        await page.waitForTimeout(50);
        const text2 = await pre.textContent();
        const pos2 = text2.match(/Position:\s*(-?\d+)/)[1];
        expect(Number(pos2)).toBe(Number(pos1) - 1);
    });

    test("l moves right (position increases)", async ({ page }) => {
        const pre = page.locator("#debug-panel pre");
        const text1 = await pre.textContent();
        const pos1 = text1.match(/Position:\s*(-?\d+)/)[1];

        await page.keyboard.press("l");
        await page.waitForTimeout(50);
        const text2 = await pre.textContent();
        const pos2 = text2.match(/Position:\s*(-?\d+)/)[1];
        expect(Number(pos2)).toBe(Number(pos1) + 1);
    });

    test("k moves up (floor increases)", async ({ page }) => {
        // Position 0 is a rest area, which has stairs
        const pre = page.locator("#debug-panel pre");
        const text1 = await pre.textContent();
        const floor1 = text1.match(/Floor:\s*(\d+)/)[1];

        await page.keyboard.press("k");
        await page.waitForTimeout(50);
        const text2 = await pre.textContent();
        const floor2 = text2.match(/Floor:\s*(\d+)/)[1];
        expect(Number(floor2)).toBe(Number(floor1) + 1);
    });

    test("j moves down (floor decreases)", async ({ page }) => {
        // First go up to ensure we can go down
        await page.keyboard.press("k");
        await page.waitForTimeout(50);

        const pre = page.locator("#debug-panel pre");
        const text1 = await pre.textContent();
        const floor1 = text1.match(/Floor:\s*(\d+)/)[1];

        await page.keyboard.press("j");
        await page.waitForTimeout(50);
        const text2 = await pre.textContent();
        const floor2 = text2.match(/Floor:\s*(\d+)/)[1];
        expect(Number(floor2)).toBe(Number(floor1) - 1);
    });

    test("x crosses chasm at floor 0", async ({ page }) => {
        const pre = page.locator("#debug-panel pre");
        const text1 = await pre.textContent();
        const floor1 = Number(text1.match(/Floor:\s*(\d+)/)[1]);
        const side1 = text1.match(/Side:\s*(\w+)/)[1];

        if (floor1 === 0) {
            // Already at floor 0, can cross
            await page.keyboard.press("x");
            await page.waitForTimeout(50);
            const text2 = await pre.textContent();
            const side2 = text2.match(/Side:\s*(\w+)/)[1];
            expect(side2).not.toBe(side1);
        } else {
            // At a higher floor, cross should not be available (no bridge)
            // Verify the cross link is absent
            const crossLink = page.locator('[data-action="move-cross"]');
            await expect(crossLink).toHaveCount(0);
        }
    });
});

test.describe("Wait", () => {
    test(". key advances time", async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");

        const pre = page.locator("#debug-panel pre");
        const text1 = await pre.textContent();
        const tick1 = text1.match(/Tick:\s*(\d+)/)[1];

        await page.keyboard.press(".");
        await page.waitForTimeout(100);
        const text2 = await pre.textContent();
        const tick2 = text2.match(/Tick:\s*(\d+)/)[1];
        expect(Number(tick2)).toBeGreaterThan(Number(tick1));
    });
});

test.describe("Kiosk", () => {
    test.beforeEach(async ({ page }) => {
        // Position 0 is a rest area, kiosk available
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
    });

    test("K opens kiosk", async ({ page }) => {
        await page.keyboard.press("K");
        await page.waitForTimeout(50);
        await expect(page.locator("#kiosk-view")).toBeVisible();
        await expect(page.locator(".location-header")).toHaveText("Kiosk");
    });

    test("1 gets drink", async ({ page }) => {
        await page.keyboard.press("K");
        await page.waitForTimeout(50);
        await page.keyboard.press("1");
        await page.waitForTimeout(50);
        // Shows drink text with continue prompt
        await expect(page.locator("#passage")).toContainText("Continue");
    });

    test("2 gets food", async ({ page }) => {
        await page.keyboard.press("K");
        await page.waitForTimeout(50);
        await page.keyboard.press("2");
        await page.waitForTimeout(50);
        await expect(page.locator("#passage")).toContainText("Continue");
    });

    test("3 gets alcohol", async ({ page }) => {
        await page.keyboard.press("K");
        await page.waitForTimeout(50);
        await page.keyboard.press("3");
        await page.waitForTimeout(50);
        await expect(page.locator("#passage")).toContainText("Continue");
    });

    test("q returns to corridor from kiosk", async ({ page }) => {
        await page.keyboard.press("K");
        await page.waitForTimeout(50);
        await page.keyboard.press("q");
        await page.waitForTimeout(50);
        await expect(page.locator("#corridor-view")).toBeVisible();
    });
});

test.describe("Bedroom", () => {
    test("b opens bedroom at rest area", async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
        await page.keyboard.press("b");
        await page.waitForTimeout(50);
        await expect(page.locator("#bedroom-view")).toBeVisible();
        await expect(page.locator(".location-header")).toHaveText("Bedroom");
    });

    test("shows sleep unavailable when not tired", async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
        await page.keyboard.press("b");
        await page.waitForTimeout(50);
        // At game start, exhaustion is low — sleep should be unavailable
        await expect(page.locator("#bedroom-view")).toContainText(/tired/i);
    });
});

test.describe("Sign", () => {
    test("R shows sign text at rest area", async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
        await page.keyboard.press("R");
        await page.waitForTimeout(50);
        await expect(page.locator("#sign-view")).toBeVisible();
        await expect(page.locator(".location-header")).toHaveText("The Sign");
        await expect(page.locator(".sign-rules")).toBeVisible();
    });

    test("q returns from sign to corridor", async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
        await page.keyboard.press("R");
        await page.waitForTimeout(50);
        await page.keyboard.press("q");
        await page.waitForTimeout(50);
        await expect(page.locator("#corridor-view")).toBeVisible();
    });
});

test.describe("Menu", () => {
    test("Esc opens menu", async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(50);
        await expect(page.locator("#menu-view")).toBeVisible();
        await expect(page.locator(".location-header")).toHaveText("Menu");
    });

    test("Esc again resumes", async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(50);
        await expect(page.locator("#menu-view")).toBeVisible();

        await page.keyboard.press("Escape");
        await page.waitForTimeout(50);
        await expect(page.locator("#corridor-view")).toBeVisible();
    });
});

test.describe("Book interaction", () => {
    test.beforeEach(async ({ page }) => {
        // Move to a non-rest-area position so shelf grid is visible
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
        // Position 0 is rest area (no books), move right to position 1
        await page.keyboard.press("l");
        await page.waitForTimeout(100);
    });

    test("click book spine opens book view", async ({ page }) => {
        const spine = page.locator(".book-spine").first();
        await expect(spine).toBeVisible();
        await spine.click();
        await page.waitForTimeout(100);
        await expect(page.locator("#book-view")).toBeVisible();
    });

    test("h/l flips pages", async ({ page }) => {
        await page.locator(".book-spine").first().click();
        await page.waitForTimeout(100);
        const header1 = await page.locator(".location-header").textContent();

        await page.keyboard.press("l");
        await page.waitForTimeout(50);
        const header2 = await page.locator(".location-header").textContent();
        expect(header2).not.toBe(header1);

        await page.keyboard.press("h");
        await page.waitForTimeout(50);
        const header3 = await page.locator(".location-header").textContent();
        expect(header3).toBe(header1);
    });

    test("t takes book, q closes", async ({ page }) => {
        await page.locator(".book-spine").first().click();
        await page.waitForTimeout(100);
        await page.keyboard.press("t");
        await page.waitForTimeout(100);
        // Taking a book returns to corridor
        await expect(page.locator("#corridor-view")).toBeVisible();
        // Sidebar should show held book
        await expect(page.locator("#story-caption")).toContainText(/a book/);
    });

    test("q closes book view", async ({ page }) => {
        await page.locator(".book-spine").first().click();
        await page.waitForTimeout(100);
        await page.keyboard.press("q");
        await page.waitForTimeout(50);
        await expect(page.locator("#corridor-view")).toBeVisible();
    });
});
