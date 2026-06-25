import { defineConfig } from "vitest/config";

// Unit + integration tests run in jsdom. Anything that depends on real layout
// (getBoundingClientRect, Paged.js page geometry) belongs in tests/e2e (Playwright),
// not here — jsdom has no layout engine.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    css: false,
    restoreMocks: true,
  },
});
