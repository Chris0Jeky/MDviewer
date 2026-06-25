// Paged.js (0.4.3) ships no TypeScript types. This ambient declaration covers exactly
// the surface MDviewer uses: the Previewer, Handler base class, registerHandlers, and
// the flow object returned by preview(). Extend as needed — keep it minimal and honest.
declare module "pagedjs" {
  export interface PagedFlow {
    total: number; // page count
    performance: number; // ms to paginate
    size: {
      width: { value: number; unit: string };
      height: { value: number; unit: string };
    };
    pages: unknown[];
  }

  export class Previewer {
    constructor(options?: Record<string, unknown>);
    on(event: "page" | "rendered", cb: (arg: unknown) => void): void;
    preview(
      content: HTMLElement | DocumentFragment | string,
      stylesheets: Array<string | Record<string, string>>,
      renderTo: HTMLElement,
    ): Promise<PagedFlow>;
  }

  // Handlers extend this and override afterParsed / afterPageLayout / afterRendered etc.
  // The constructor receives the chunker, polisher, and caller from Paged.js internals.
  export class Handler {
    constructor(chunker: unknown, polisher: unknown, caller: unknown);
    chunker: unknown;
    polisher: unknown;
  }

  export function registerHandlers(
    ...handlers: Array<new (chunker: unknown, polisher: unknown, caller: unknown) => Handler>
  ): void;

  export class Chunker {}
  export class Polisher {}
}
