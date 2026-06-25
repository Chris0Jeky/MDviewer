import type { Settings } from "../app/settings";

declare global {
  interface Window {
    /**
     * Stable, intentional programmatic hook onto the running App, wired once in `main.ts`.
     * Used by the e2e suite to drive the app without coupling to toolbar DOM (and handy for
     * manual debugging). Local-first: this exposes only the App's existing public methods —
     * no document content is read or stored through it.
     */
    __mdviewer?: {
      updateSettings(patch: Partial<Settings>): void;
      exportPrint(): Promise<void>;
      exportPdf(): Promise<void>;
      loadSample(): void;
    };
  }
}

export {};
