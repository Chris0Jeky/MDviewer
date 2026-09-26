/**
 * The only seam between MDviewer and the optional Pulseboard SDK (public/pulseboard.js).
 *
 * Privacy contract (README "Privacy", docs/design/IMPLEMENTATION_SPEC.md §1): every value
 * that leaves this module is a closed enum, a size bucket or a page count. Markdown text,
 * file names, titles, headings, URLs found in documents and export contents never reach a
 * Pulseboard call — the functions below take no string that a user or a document supplies.
 * tests/pulse.test.ts spies on window.Pulseboard and proves it.
 *
 * Every call is guarded: when the SDK is absent, blocked, inert (any origin other than the
 * production host, automation, GPC/DNT) or throws, the product carries on unchanged.
 */

import type { ScreenTheme, ViewMode } from "./settings";

/** Routes registered for `mdviewer` in Pulseboard observatory/src/projects.mjs. */
export type PulseRoute = "home" | "editor";

/** How a document entered the app. `typed` = the first keystroke into an empty editor. */
export type DocSource = "file" | "paste" | "sample" | "typed";

export type SizeBucket = "<1k" | "1-10k" | "10-100k" | ">100k";

/** The subset of the SDK's global API MDviewer uses (Pulseboard docs/SDK.md "API"). */
interface PulseboardApi {
  route(name: string): boolean;
  count(event: string): boolean;
  track(name: string, props?: Record<string, string | number>): boolean;
}

declare global {
  interface Window {
    Pulseboard?: PulseboardApi;
  }
}

function sdk(): PulseboardApi | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.Pulseboard;
  } catch {
    return undefined;
  }
}

function call(fn: (api: PulseboardApi) => unknown): void {
  const api = sdk();
  if (!api) return;
  try {
    fn(api);
  } catch {
    // Telemetry is best-effort; it must never break reading or exporting a document.
  }
}

/** Bucket a document's length (in UTF-16 code units, ~bytes for Markdown). */
export function sizeBucket(length: number): SizeBucket {
  if (length < 1_000) return "<1k";
  if (length < 10_000) return "1-10k";
  if (length < 100_000) return "10-100k";
  return ">100k";
}

let lastRoute: PulseRoute = "home"; // The SDK records the `home` page view itself on load.

/** Record a navigation, only when the screen actually changes. */
export function pulseRoute(route: PulseRoute): void {
  if (route === lastRoute) return;
  lastRoute = route;
  call((api) => api.route(route));
}

/** A document was opened. Only the source kind and a size bucket are sent. */
export function pulseDocOpened(source: DocSource, length: number): void {
  const bucket = sizeBucket(length);
  call((api) => api.track("doc.opened", { source, sizeBucket: bucket }));
}

/** The print dialog was requested. This never claims that a PDF was saved. */
export function pulsePrintRequested(): void {
  call((api) => api.count("export.print_requested"));
  call((api) => api.track("export.print_requested", {}));
}

/** The raster PDF download completed. `pages` is the rendered page count. */
export function pulsePdfCompleted(pages: number): void {
  call((api) => api.count("export.pdf_completed"));
  const props: Record<string, number> = Number.isInteger(pages) && pages > 0 ? { pages } : {};
  call((api) => api.track("export.pdf_completed", props));
}

export function pulseViewMode(mode: ViewMode): void {
  call((api) => api.track("view.mode", { mode }));
}

export function pulseTheme(theme: ScreenTheme): void {
  call((api) => api.track("theme.changed", { theme }));
}

/**
 * Keep JavaScript error reports away from the SDK. An error message can quote the text
 * being parsed (a Mermaid or KaTeX parse error, for instance), and the SDK's Diagnostics
 * category would forward up to 160 characters of it. This capture listener is registered
 * by main.ts before the deferred SDK script runs, so it fires first and stops the event
 * reaching the SDK's own window listener. The browser still logs the error to the console
 * (nothing calls preventDefault). Web vitals and engagement are unaffected.
 * If a later deferred script ever registered a capture listener before this one, the shield
 * would lose that race; main.ts installs it before anything else on the page for that reason.
 */
export function installErrorShield(target: Window = window): () => void {
  const stop = (event: Event): void => {
    // Capture at window also sees resource `error` events on their way DOWN to an <img>
    // (render/buildSource.ts waits on those). Only script errors and rejections are
    // dispatched AT the window itself; everything else must pass untouched.
    if (event.eventPhase !== Event.AT_TARGET) return;
    event.stopImmediatePropagation();
  };
  target.addEventListener("error", stop, true);
  target.addEventListener("unhandledrejection", stop, true);
  return () => {
    target.removeEventListener("error", stop, true);
    target.removeEventListener("unhandledrejection", stop, true);
  };
}

/** Test hook: reset the de-duplicated route. */
export function resetPulseForTests(): void {
  lastRoute = "home";
}
