import { defineConfig } from "vite";

// MDviewer is a single-page, local-first static app. No framework plugin needed.
// Heavy, browser-only libraries (pagedjs, mermaid, the PDF fallback) are dynamic-
// imported at the point of use so the initial bundle stays small.
export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
  },
  server: {
    port: 5180,
    strictPort: false,
  },
  preview: {
    port: 5181,
  },
});
