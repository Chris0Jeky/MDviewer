import { defineConfig } from "vite";

// The embeddable <mdviewer-reader> element (src/embed/reader.ts). `npm run embed:build` writes
// dist-embed/mdviewer-reader.js plus the chunks it loads on demand (code grammars, diagrams), its
// stylesheet mdviewer-reader.css (the math font faces, which a shadow root cannot hold) and the
// font files, all beside it. The element's own styles are inlined into its shadow root. This is a
// plain build with one JS entry, not Vite's library mode, which would inline the fonts as base64.
export default defineConfig({
  publicDir: false,
  base: "./",
  build: {
    outDir: "dist-embed",
    target: "es2022",
    rollupOptions: {
      input: "src/embed/reader.ts",
      preserveEntrySignatures: "strict",
      output: {
        entryFileNames: "mdviewer-reader.js",
        assetFileNames: info => (info.names.some(name => name.endsWith(".css")) ? "mdviewer-reader.css" : "assets/[name]-[hash][extname]"),
      },
    },
  },
});
