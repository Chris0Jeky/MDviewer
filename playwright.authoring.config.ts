import { defineConfig, devices } from "@playwright/test";

// A bounded, real second-engine lane for the shared authoring surface. The full
// Chromium and native Windows suites remain the pagination/export release gates.
export default defineConfig({
  outputDir: "test-results/authoring",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: [
    { command: "npm run preview -- --port 5185 --strictPort", url: "http://localhost:5185", reuseExistingServer: false },
    { command: "npx vite preview --config vite.desktop.config.ts --port 5186 --strictPort", url: "http://127.0.0.1:5186/desktop.html", reuseExistingServer: false },
  ],
  projects: [
    {
      name: "authoring-firefox",
      testDir: "tests/e2e",
      testMatch: ["**/editor.spec.ts", "**/editor-edit-safety.spec.ts", "**/editor-search.spec.ts", "**/document-shortcuts.spec.ts", "**/authoring-accessibility.spec.ts", "**/export-status.spec.ts"],
      use: { ...devices["Desktop Firefox"], baseURL: "http://localhost:5185" },
    },
    {
      name: "desktop-authoring-firefox",
      testDir: "tests/desktop-e2e",
      testMatch: ["**/new-document.spec.ts", "**/toolbar.spec.ts", "**/authoring-accessibility.spec.ts"],
      use: { ...devices["Desktop Firefox"], baseURL: "http://127.0.0.1:5186/desktop.html" },
    },
  ],
});
