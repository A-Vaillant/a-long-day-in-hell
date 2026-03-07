import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./test/e2e",
    timeout: 30000,
    use: {
        browserName: "chromium",
        headless: true,
        viewport: { width: 1280, height: 800 },
    },
    webServer: {
        command: "npx serve dist -l 3219 --no-clipboard",
        port: 3219,
        reuseExistingServer: true,
    },
});
