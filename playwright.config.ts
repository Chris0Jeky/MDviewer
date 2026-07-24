import { defineConfig, devices } from "@playwright/test";

// E2E covers everything layout-dependent — above all tests/e2e/nocutoff.spec.ts,
// which asserts the core guarantee: no atomic block straddles a page boundary.
//
// Target the dev server by default (fast local iteration). Set E2E_TARGET=preview to run
// against the production bundle served by `vite preview` — this exercises the rolldown build
// and its dynamic imports (pagedjs/mermaid/jspdf), so a bundle-only regression in the
// pagination/export path can't pass while dev mode works. CI runs the preview target after
// `npm run build`. The preview command requires an existing `dist/` (run build first).
const usePreview = process.env.E2E_TARGET === "preview";
const e2ePort = Number(process.env.E2E_PORT ?? "5180");

if (!Number.isInteger(e2ePort) || e2ePort < 1 || e2ePort > 65_535) {
  throw new Error(`E2E_PORT must be an integer between 1 and 65535; received ${process.env.E2E_PORT}`);
}

const baseURL = `http://localhost:${e2ePort}`;
const webServerCommand = usePreview
  ? `npm run preview -- --port ${e2ePort} --strictPort`
  : `npm run dev -- --port ${e2ePort} --strictPort`;

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
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
