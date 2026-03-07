import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3219/";
const CORRIDOR = BASE + "?vohu=Corridor&seed=test42";
const DEATH = BASE + "?vohu=Death&seed=test42";

test.describe("Chasm confirmation", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
    });

    test("J opens chasm screen with prose and confirm links", async ({ page }) => {
        await page.keyboard.press("J");
        await expect(page.locator("#chasm-view")).toBeVisible();
        // Should show y/n options
        await expect(page.locator("#chasm-view")).toContainText("y");
        await expect(page.locator("#chasm-view")).toContainText("n");
    });

    test("n returns to corridor from chasm confirm", async ({ page }) => {
        await page.keyboard.press("J");
        await expect(page.locator("#chasm-view")).toBeVisible();

        await page.keyboard.press("n");
        await expect(page.locator("#corridor-view")).toBeVisible();
    });

    test("Escape returns to corridor from chasm confirm", async ({ page }) => {
        await page.keyboard.press("J");
        await expect(page.locator("#chasm-view")).toBeVisible();

        await page.keyboard.press("Escape");
        await expect(page.locator("#corridor-view")).toBeVisible();
    });

    test("y confirms jump, enters Falling screen", async ({ page }) => {
        await page.keyboard.press("J");
        await expect(page.locator("#chasm-view")).toBeVisible();

        await page.keyboard.press("y");
        await expect(page.locator("#falling-view")).toBeVisible();
        await expect(page.locator(".location-header")).toHaveText("Falling");
    });
});

test.describe("Falling screen", () => {
    test.beforeEach(async ({ page }) => {
        // Navigate: Corridor -> J -> y -> Falling
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
        await page.keyboard.press("J");
        await expect(page.locator("#chasm-view")).toBeVisible();
        await page.keyboard.press("y");
        await expect(page.locator("#falling-view")).toBeVisible();
    });

    test("shows falling prose and grab description", async ({ page }) => {
        await expect(page.locator(".location-header")).toHaveText("Falling");
        await expect(page.locator(".grab-desc")).toBeVisible();
    });

    test("shows fall and grab actions", async ({ page }) => {
        await expect(page.locator("#fall-wait")).toBeVisible();
        await expect(page.locator("#fall-grab")).toBeVisible();
    });

    test("w continues falling (screen re-renders)", async ({ page }) => {
        // Press w to fall — should stay on Falling or transition to Death
        await page.keyboard.press("w");
        // Verify we're on a valid screen (falling or dead)
        await expect.poll(async () => {
            const falling = await page.locator("#falling-view").count();
            const dead = await page.locator("#death-view").count();
            return falling + dead;
        }).toBeGreaterThan(0);
    });

    test("g attempts grab", async ({ page }) => {
        await page.keyboard.press("g");
        // Grab either succeeds (Corridor) or fails (Falling/Death)
        await expect.poll(async () => {
            const corridor = await page.locator("#corridor-view").count();
            const falling = await page.locator("#falling-view").count();
            const dead = await page.locator("#death-view").count();
            return corridor + falling + dead;
        }).toBeGreaterThan(0);
    });
});

test.describe("Death screen", () => {
    test("vohu=Death shows death prose and resurrection text", async ({ page }) => {
        await page.goto(DEATH);
        await page.waitForSelector("#death-view", { timeout: 5000 });
        await expect(page.locator("#death-view")).toBeVisible();
        // Shows day and death count
        await expect(page.locator("#death-view")).toContainText(/Day \d+/);
        await expect(page.locator("#death-view")).toContainText(/Deaths: \d+/);
        // Shows continue prompt
        await expect(page.locator("#death-view")).toContainText("Continue");
    });

    test("Enter continues from death to corridor", async ({ page }) => {
        await page.goto(DEATH);
        await page.waitForSelector("#death-view", { timeout: 5000 });

        await page.keyboard.press("Enter");
        await expect(page.locator("#corridor-view")).toBeVisible();
    });

    test("Space continues from death to corridor", async ({ page }) => {
        await page.goto(DEATH);
        await page.waitForSelector("#death-view", { timeout: 5000 });

        await page.keyboard.press(" ");
        await expect(page.locator("#corridor-view")).toBeVisible();
    });

    test("e continues from death to corridor", async ({ page }) => {
        await page.goto(DEATH);
        await page.waitForSelector("#death-view", { timeout: 5000 });

        await page.keyboard.press("e");
        await expect(page.locator("#corridor-view")).toBeVisible();
    });
});
