import { defineConfig, devices } from "@playwright/test";

// Build first with npm run desktop:build:web. Always exercise the bundled desktop
// entry and its production CSP; the ordinary web/PWA suite remains separate.
const desktopPort = Number(process.env.DESKTOP_E2E_PORT ?? "5183");
if (!Number.isInteger(desktopPort) || desktopPort < 1 || desktopPort > 65_535) {
  throw new Error(`DESKTOP_E2E_PORT must be an integer between 1 and 65535; received ${process.env.DESKTOP_E2E_PORT}`);
}
const baseURL = `http://127.0.0.1:${desktopPort}/desktop.html`;

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
    command: `npx vite preview --config vite.desktop.config.ts --port ${desktopPort} --strictPort`,
    url: baseURL,
    // A different checkout may already own this port. Never validate its bundle
    // while reporting evidence for the current branch.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } }],
});
