import { defineConfig, devices } from "@playwright/test";

// Build first with npm run webhost:build. The companion shell on the browser host (web parity W1):
// Chromium saves through the File System Access API; Firefox proves the file-input and download fallback.
const port = Number(process.env.WEBHOST_E2E_PORT ?? "5187");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`WEBHOST_E2E_PORT must be an integer between 1 and 65535; received ${process.env.WEBHOST_E2E_PORT}`);
}
const baseURL = `http://127.0.0.1:${port}/desktop.html`;

export default defineConfig({
  testDir: "tests/webhost-e2e",
  outputDir: "test-results/webhost",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "on-first-retry", screenshot: "only-on-failure" },
  webServer: {
    command: `npx vite preview --config vite.desktop.config.ts --outDir dist-webhost --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "webhost-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webhost-firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});
