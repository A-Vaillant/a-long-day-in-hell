import { test, expect, devices } from "@playwright/test";

const CORRIDOR = "http://localhost:3219/?vohu=Corridor&seed=test42";
const LIFE_STORY = "http://localhost:3219/?seed=test42";

// Use iPhone 12 profile for consistent mobile viewport + touch
test.use({ ...devices["iPhone 12"] });

// --- Viewport & layout ---

test.describe("mobile layout", () => {
    test("viewport meta prevents zoom on double-tap", async ({ page }) => {
        await page.goto(CORRIDOR);
        const meta = await page.locator('meta[name="viewport"]').getAttribute("content");
        expect(meta).toContain("width=device-width");
    });

    test("sidebar collapses to horizontal bar on narrow screen", async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
        const sidebar = page.locator("#ui-bar");
        const box = await sidebar.boundingBox();
        // On mobile, sidebar should span full width (not a narrow side column)
        expect(box.width).toBeGreaterThan(300);
    });

    test("passage content is visible without horizontal scroll", async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
        const passage = page.locator("#passage");
        const box = await passage.boundingBox();
        const vw = page.viewportSize().width;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(vw + 2); // small tolerance
    });
});

// --- Touch navigation (corridor) ---

test.describe("mobile corridor navigation", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
    });

    test("tapping move-left link moves player left", async ({ page }) => {
        const pre = page.locator("#debug-panel pre");
        await expect(pre).toBeVisible();
        const text1 = await pre.textContent();
        const pos1 = Number(text1.match(/Position:\s*(-?\d+)/)[1]);

        const link = page.locator('[data-action="move-left"]');
        await expect(link).toBeVisible();
        await link.tap();

        await expect(pre).toContainText("Position: " + (pos1 - 1));
    });

    test("tapping move-right link moves player right", async ({ page }) => {
        const pre = page.locator("#debug-panel pre");
        await expect(pre).toBeVisible();
        const text1 = await pre.textContent();
        const pos1 = Number(text1.match(/Position:\s*(-?\d+)/)[1]);

        const link = page.locator('[data-action="move-right"]');
        await expect(link).toBeVisible();
        await link.tap();

        await expect(pre).toContainText("Position: " + (pos1 + 1));
    });

    test("tapping move-up link moves player up floor", async ({ page }) => {
        // Position 0 is a rest area with stairs
        const pre = page.locator("#debug-panel pre");
        const text1 = await pre.textContent();
        const floor1 = Number(text1.match(/Floor:\s*(\d+)/)[1]);

        const link = page.locator('[data-action="move-up"]');
        await expect(link).toBeVisible();
        await link.tap();

        await expect(pre).toContainText("Floor:    " + (floor1 + 1));
    });

    test("tapping wait link advances time", async ({ page }) => {
        const pre = page.locator("#debug-panel pre");
        const text1 = await pre.textContent();
        const tick1 = Number(text1.match(/Tick:\s*(\d+)/)[1]);

        const link = page.locator('[data-goto="Wait"]').first();
        await expect(link).toBeVisible();
        await link.tap();

        await expect(pre).not.toContainText("Tick:     " + tick1 + " ");
    });

    test("action links have adequate tap target size", async ({ page }) => {
        const links = page.locator("#moves a");
        const count = await links.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i++) {
            const box = await links.nth(i).boundingBox();
            // Minimum 44px tap target per Apple HIG / WCAG
            expect(box.height).toBeGreaterThanOrEqual(44);
        }
    });
});

// --- Life story screen ---

test.describe("mobile life story", () => {
    test("continue link is tappable", async ({ page }) => {
        await page.goto(LIFE_STORY);
        await page.waitForSelector("#lifestory-view");

        const continueLink = page.locator('[data-goto="Corridor"]');
        await expect(continueLink).toBeVisible();
        await continueLink.tap();

        await expect(page.locator("#corridor-view")).toBeVisible();
    });
});

// --- Kiosk ---

test.describe("mobile kiosk", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
    });

    test("kiosk link is tappable from rest area", async ({ page }) => {
        const kiosk = page.locator('[data-goto="Kiosk"]');
        await expect(kiosk).toBeVisible();
        await kiosk.tap();
        await expect(page.locator("#kiosk-view")).toBeVisible();
    });

    test("kiosk drink option is tappable", async ({ page }) => {
        await page.locator('[data-goto="Kiosk"]').tap();
        await expect(page.locator("#kiosk-view")).toBeVisible();

        const drink = page.locator('[data-goto="Kiosk Get Drink"]');
        await expect(drink).toBeVisible();
        await drink.tap();
        await expect(page.locator("#passage")).toContainText("Continue");
    });

    test("kiosk continue link returns to kiosk", async ({ page }) => {
        await page.locator('[data-goto="Kiosk"]').tap();
        await page.locator('[data-goto="Kiosk Get Drink"]').tap();

        const cont = page.locator('[data-goto="Kiosk"]');
        await expect(cont).toBeVisible();
        await cont.tap();
        await expect(page.locator("#kiosk-view")).toBeVisible();
    });

    test("kiosk leave returns to corridor", async ({ page }) => {
        await page.locator('[data-goto="Kiosk"]').tap();
        await expect(page.locator("#kiosk-view")).toBeVisible();

        const leave = page.locator('[data-goto="Corridor"]');
        await expect(leave).toBeVisible();
        await leave.tap();
        await expect(page.locator("#corridor-view")).toBeVisible();
    });
});

// --- Bedroom ---

test.describe("mobile bedroom", () => {
    test("bedroom link is tappable from rest area", async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");

        const bed = page.locator('[data-goto="Bedroom"]');
        await expect(bed).toBeVisible();
        await bed.tap();
        await expect(page.locator("#bedroom-view")).toBeVisible();
    });
});

// --- Book interaction ---

test.describe("mobile book interaction", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
        // Move to a non-rest-area position where shelf is visible
        await page.evaluate(() => {
            window.state.position = 1;
            window.Engine.goto("Corridor");
        });
    });

    test("shelf books are tappable to open", async ({ page }) => {
        const book = page.locator(".shelf-slot").first();
        await expect(book).toBeVisible();
        await book.tap();
        await expect(page.locator("#book-view")).toBeVisible();
    });

    test("page-prev and page-next links are tappable", async ({ page }) => {
        const book = page.locator(".shelf-slot").first();
        await book.tap();
        await expect(page.locator("#book-view")).toBeVisible();

        // Navigate forward
        const next = page.locator('[data-action="page-next"]');
        await expect(next).toBeVisible();
        await next.tap();

        // Navigate back
        const prev = page.locator('[data-action="page-prev"]');
        await expect(prev).toBeVisible();
        await prev.tap();
    });

    test("take book link works via tap", async ({ page }) => {
        const book = page.locator(".shelf-slot").first();
        await book.tap();
        await expect(page.locator("#book-view")).toBeVisible();

        const take = page.locator('[data-action="take-book"]');
        await expect(take).toBeVisible();
        await take.tap();

        // Should return to corridor with book held
        await expect(page.locator("#corridor-view")).toBeVisible();
    });

    test("close book link works via tap", async ({ page }) => {
        const book = page.locator(".shelf-slot").first();
        await book.tap();
        await expect(page.locator("#book-view")).toBeVisible();

        const close = page.locator('[data-goto="Corridor"]');
        await expect(close).toBeVisible();
        await close.tap();
        await expect(page.locator("#corridor-view")).toBeVisible();
    });
});

// --- Submission slot ---

test.describe("mobile submission slot", () => {
    test("submit link is tappable from rest area", async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");

        const submit = page.locator('[data-goto="Submission Slot"]');
        await expect(submit).toBeVisible();
        await submit.tap();
        await expect(page.locator("#submission-view")).toBeVisible();
    });
});

// --- Sign ---

test.describe("mobile sign", () => {
    test("sign link is tappable from rest area", async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");

        const sign = page.locator('[data-goto="Sign"]');
        await expect(sign).toBeVisible();
        await sign.tap();
        await expect(page.locator("#sign-view")).toBeVisible();
    });

    test("back link returns to corridor", async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
        await page.locator('[data-goto="Sign"]').tap();
        await expect(page.locator("#sign-view")).toBeVisible();

        const back = page.locator('[data-goto="Corridor"]');
        await expect(back).toBeVisible();
        await back.tap();
        await expect(page.locator("#corridor-view")).toBeVisible();
    });
});

// --- Menu ---

test.describe("mobile menu", () => {
    test("escape link or menu button accessible on mobile", async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
        // On mobile, there should be a tappable way to open menu
        // (since Escape key isn't available on touchscreens)
        const menuBtn = page.locator('[data-goto="Menu"], #mobile-menu-btn');
        await expect(menuBtn.first()).toBeVisible();
    });
});

// --- Falling screen ---

test.describe("mobile falling", () => {
    test("falling actions are tappable", async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
        // Jump into chasm via debug
        await page.evaluate(() => {
            window.state.floor = 5;
            window.Actions.resolve({ type: "chasm_jump" });
            window.Engine.goto("Falling");
        });
        await expect(page.locator("#falling-view")).toBeVisible();

        // Wait and grab actions should be tappable
        const waitLink = page.locator('[data-action="fall-wait"], [data-goto="Falling"]').first();
        await expect(waitLink).toBeVisible();
    });
});

// --- Death screen ---

test.describe("mobile death screen", () => {
    test("continue after death is tappable", async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");
        await page.evaluate(() => {
            window.state.dead = true;
            window.Engine.goto("Death");
        });
        await expect(page.locator("#death-view")).toBeVisible();

        const cont = page.locator('[data-goto="Corridor"]');
        await expect(cont).toBeVisible();
        await cont.tap();
        await expect(page.locator("#corridor-view")).toBeVisible();
    });
});

// --- No double-tap zoom on game elements ---

test.describe("mobile zoom prevention", () => {
    test("double-tapping action link does not zoom page", async ({ page }) => {
        await page.goto(CORRIDOR);
        await page.waitForSelector("#corridor-view");

        const vw1 = await page.evaluate(() => window.visualViewport?.scale ?? 1);
        const link = page.locator('[data-action="move-right"]');
        await link.tap();
        await link.tap();
        const vw2 = await page.evaluate(() => window.visualViewport?.scale ?? 1);
        expect(vw2).toBeCloseTo(vw1, 1);
    });
});
