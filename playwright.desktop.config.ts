import { defineConfig, devices } from "@playwright/test";

// Build first with npm run desktop:build:web. Always exercise the bundled desktop
// entry and its production CSP; the ordinary web/PWA suite remains separate.
const baseURL = "http://127.0.0.1:5183/desktop.html";

export default defineConfig({
  testDir: "tests/desktop-e2e",
  outputDir: "test-results/desktop",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "on-first-retry", screenshot: "only-on-failure" },
  webServer: {
    command: "npx vite preview --config vite.desktop.config.ts",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } }],
});
