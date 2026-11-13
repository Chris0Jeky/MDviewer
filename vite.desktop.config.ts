import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8")) as {
  app: { security: { csp: string; devCsp: string } };
};

// No service worker or telemetry script. The same CSP is exercised by browser QA.
// `--mode webhost` builds the same shell on the browser host (src/desktop/native.ts); the Windows
// build never uses that mode, so its bundle does not contain the browser host.
export default defineConfig(({ mode }) => ({
  define: mode === "webhost" ? { "import.meta.env.VITE_MDV_BROWSER_HOST": JSON.stringify("1") } : {},
  publicDir: false,
  plugins: [{
    name: "desktop-content-security-policy",
    transformIndexHtml(html, context) {
      const csp = context.server ? config.app.security.devCsp : config.app.security.csp;
      return html.replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp.replaceAll('"', "&quot;")}">`);
    },
  }],
  build: { outDir: "dist-desktop", target: "es2022", rollupOptions: { input: "desktop.html" } },
  server: { host: "127.0.0.1", port: 5182, strictPort: true },
  preview: { host: "127.0.0.1", port: 5183, strictPort: true },
}));
