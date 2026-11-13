import { defineConfig, devices } from "@playwright/test";

// Build first with npm run embed:build. The embedded <mdviewer-reader> is exercised as a plain
// page would load it: dist-embed served as is, the host page supplied by the test.
const embedPort = Number(process.env.E2E_PORT ?? "5284");
if (!Number.isInteger(embedPort) || embedPort < 1 || embedPort > 65_535) {
  throw new Error(`E2E_PORT must be an integer between 1 and 65535; received ${process.env.E2E_PORT}`);
}
const origin = `http://127.0.0.1:${embedPort}`;

export default defineConfig({
  testDir: "tests/embed-e2e",
  outputDir: "test-results/embed",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: origin, trace: "on-first-retry", screenshot: "only-on-failure" },
  webServer: {
    command: `npx vite preview --config vite.embed.config.ts --host 127.0.0.1 --port ${embedPort} --strictPort`,
    url: `${origin}/mdviewer-reader.js`,
    // Another checkout may own this port: never test its bundle for this branch.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "embed-chromium", use: { ...devices["Desktop Chrome"] } }],
});
