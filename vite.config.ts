import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * The <meta name="description"> from index.html, repeated here because the web-app manifest
 * needs its own copy. tests/head-contract.test.ts fails if the two ever drift.
 */
const DESCRIPTION =
  "Write or drop Markdown and export beautiful, page-break-safe PDFs for research and code documents. Live split-pane preview; everything runs in your browser.";

// MDviewer is a single-page, local-first static app. No framework plugin needed.
// Heavy, browser-only libraries (pagedjs, mermaid, the PDF fallback) are dynamic-
// imported at the point of use so the initial bundle stays small.
export default defineConfig({
  root: ".",
  plugins: [
    VitePWA({
      // "prompt", never "autoUpdate". A new deployment must not swap the bundle out from
      // under a live document: pagination and export run against modules already in memory,
      // and an unattended reload would discard the user's unsaved Markdown. The user decides
      // when to take the update (src/main.ts renders the prompt).
      registerType: "prompt",
      // src/main.ts registers the worker itself via virtual:pwa-register, so the plugin must
      // not also inject a registration snippet.
      injectRegister: null,
      // Default (disabled in dev) on purpose: `npm run dev` behaviour is unchanged, and no
      // service worker can shadow a hot module update.
      devOptions: { enabled: false },
      // The `png` glob below already precaches everything in public/icons; letting the plugin
      // add the manifest icons a second time only produces duplicate precache entries.
      includeManifestIcons: false,
      manifest: {
        id: "/",
        name: "MDviewer",
        short_name: "MDviewer",
        description: DESCRIPTION,
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // Mirrors <meta name="theme-color"> and the light-theme --bg-toolbar / --bg-app tokens.
        theme_color: "#ffffff",
        background_color: "#f3f4f6",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // The whole point of an offline MDviewer is that the *features* work offline, not just
        // the shell. Paged.js, Mermaid, jsPDF/html2canvas-pro, the curated Shiki grammars and
        // the KaTeX web fonts are all lazily imported on user action, so precaching only the
        // entry chunk would produce an app that looks fine offline until the moment somebody
        // presses Print or writes some math. Everything the build emits in these formats is
        // precached; .woff/.ttf are deliberately excluded because the es2022 build target
        // implies universal woff2 support and they would double the payload for nothing.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // The entry chunk is ~1.6 MB and some Mermaid/Shiki chunks are large; Workbox's 2 MiB
        // default would silently drop whichever file crosses it and quietly break offline for
        // that feature. 4 MiB keeps real headroom over the largest emitted asset.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // A single-page app: any offline navigation resolves to the shell.
        navigateFallback: "index.html",
        // Drop precaches from superseded deployments instead of accumulating them.
        cleanupOutdatedCaches: true,
        // NO runtimeCaching. MDviewer makes zero cross-origin requests by design, and a
        // runtime cache rule is exactly the seam through which one would later creep in.
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    // Public deployments should not publish the full source tree. Opt in when a
    // debugging build specifically needs source maps.
    sourcemap: process.env.SOURCE_MAPS === "true",
  },
  server: {
    port: 5180,
    strictPort: false,
  },
  preview: {
    // 5181 keeps `vite preview` from colliding with a dev server on 5180. NOTE: the e2e
    // suite (playwright.config.ts) runs preview with an explicit `--port 5180 --strictPort`
    // that overrides this — keep that flag if you ever wire preview into e2e elsewhere.
    port: 5181,
  },
});
