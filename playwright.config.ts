import { defineConfig, devices } from "@playwright/test";

// E2E covers everything layout-dependent — above all tests/e2e/nocutoff.spec.ts,
// which asserts the core guarantee: no atomic block straddles a page boundary.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Cap CI parallelism: the no-slice tests measure real element heights, so CPU contention
  // from one-worker-per-core on shared runners can cause timing flakes that retries would mask.
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5180",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
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
