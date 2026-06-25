import { defineConfig, devices } from "@playwright/test";

// E2E covers everything layout-dependent — above all tests/e2e/nocutoff.spec.ts,
// which asserts the core guarantee: no atomic block straddles a page boundary.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5180",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --port 5180 --strictPort",
    url: "http://localhost:5180",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
