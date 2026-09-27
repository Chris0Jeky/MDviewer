#!/usr/bin/env node
/**
 * Per-deploy live egress probe: prove a production deployment's APP makes no
 * cross-origin request of its own.
 *
 *   npm run smoke:egress -- https://<immutable-deployment-url>/
 *
 * The probe renders the sample document and runs both export paths, then fails
 * loudly on any http(s) request outside the page origin. The SDK is inert under
 * automation by design (`navigator.webdriver` → inert, pinned by
 * tests/pulse-egress.test.ts), so this probe observes the app alone — that is
 * the point: MDviewer itself must phone nowhere. The SDK's destinations are
 * proven the other way round: tests/pulse-egress.test.ts pins the vendored
 * artifact to collector-only fetch, and the deploy smoke verifies the served
 * /pulseboard.js is byte-identical to that artifact (docs/DEPLOYMENT.md).
 *
 * Together: app → nowhere (this probe, live), SDK → collector only (unit test
 * + byte-identity, per deploy). No automation-masking, no analytics pollution.
 *
 * Exit 0 prints the observed request count; exit 1 names the offending URLs.
 */
import { chromium } from "@playwright/test";

function usage(exitCode) {
  console.error("usage: node scripts/smoke-egress.mjs <production-url>");
  process.exit(exitCode);
}

const target = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!target || process.argv.includes("--help") || process.argv.includes("-h")) {
  usage(target ? 0 : 1);
}

let pageUrl;
try {
  pageUrl = new URL(target);
} catch {
  console.error("smoke:egress: not a URL: %s", target);
  usage(1);
}
if (pageUrl.protocol !== "https:") {
  console.error("smoke:egress: refusing non-https production URL: %s", target);
  process.exit(1);
}

const seen = [];
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("http:") || url.startsWith("https:")) seen.push(url);
  });

  await page.goto(pageUrl.toString(), { waitUntil: "domcontentloaded" });
  await page.locator("#app").waitFor({ state: "visible", timeout: 30_000 });

  await page.evaluate(() => window.__mdviewer.loadSample());
  await page
    .locator("#paged-output .pagedjs_page")
    .first()
    .waitFor({ state: "attached", timeout: 90_000 });

  // Vector export over the real sheets (print dialog stubbed, like the e2e spec).
  await page.evaluate(() => {
    const w = window;
    w.__printCalls = 0;
    window.print = () => {
      w.__printCalls += 1;
      w.__printedSheets =
        document.getElementById("paged-output")?.querySelectorAll(".pagedjs_page").length ?? 0;
    };
  });
  await page.locator(".export-primary").first().click();
  const printed = await page.evaluate(() => ({
    calls: window.__printCalls ?? 0,
    sheets: window.__printedSheets ?? 0,
  }));
  if (printed.calls !== 1 || printed.sheets < 2) {
    console.error("smoke:egress: vector export did not run: %j", printed);
    process.exit(1);
  }

  // Raster export, if this build offers it.
  const downloadBtn = page.locator(".export-secondary").first();
  if ((await downloadBtn.count()) > 0) {
    const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
    await downloadBtn.click();
    const download = await downloadPromise;
    if (!/\.pdf$/i.test(download.suggestedFilename())) {
      console.error("smoke:egress: raster download was not a PDF: %s", download.suggestedFilename());
      process.exit(1);
    }
    await page.locator("#status-live").getByText(/pdf downloaded/i).waitFor({ timeout: 30_000 });
  }

  // Let any late/timing-driven request fire before judging.
  await page.waitForTimeout(8_000);

  const ownOrigin = pageUrl.origin;
  const offenders = seen.filter((url) => new URL(url).origin !== ownOrigin);
  console.log(
    "smoke:egress: %d http(s) request(s), all to %s",
    seen.length,
    ownOrigin,
  );
  if (offenders.length > 0) {
    for (const url of [...new Set(offenders)].slice(0, 20)) {
      console.error("  offender: %s", url);
    }
    console.error(
      "smoke:egress: FAIL — %d request(s) escaped the page origin",
      offenders.length,
    );
    process.exit(1);
  }
  console.log("smoke:egress: PASS — the app requested nothing cross-origin");
} finally {
  await browser.close();
}
