import { describe, it, expect, vi, beforeEach } from "vitest";
import { CLASSES } from "../src/app/dom";

// jsdom has no real layout/SVG engine, so mermaid cannot run for real here.
// Mock the module: initialize is a noop, render returns a fixed SVG, and a sentinel
// source ("FAIL") rejects so we can exercise the failure-placeholder branch.
//
// vi.mock is hoisted above the imports, so the mock state must be created with
// vi.hoisted to be defined when the factory runs.
const { renderMock, initializeMock } = vi.hoisted(() => ({
  renderMock: vi.fn(async (id: string, code: string) => {
    if (code.includes("FAIL")) throw new Error("mermaid parse error");
    return {
      svg: `<svg data-id="${id}"><style>.node{fill:#fff}</style><text>${code}</text></svg>`,
    };
  }),
  initializeMock: vi.fn(),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: initializeMock,
    render: renderMock,
  },
}));

import { renderAllMermaid } from "../src/render/mermaid";

/** Build a detached root that contains the given inner HTML. */
function root(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

beforeEach(() => {
  document.body.replaceChildren();
  // vitest.config has restoreMocks:true, which strips implementations before each
  // test — re-establish renderMock's behavior (and clear history) every time.
  renderMock.mockReset().mockImplementation(async (id: string, code: string) => {
    if (code.includes("FAIL")) throw new Error("mermaid parse error");
    if (code.includes("EXTERNAL")) {
      return {
        svg: `<svg data-id="${id}"><image href="https://example.test/tracker.svg" /></svg>`,
      };
    }
    return {
      svg: `<svg data-id="${id}"><style>.node{fill:#fff}</style><text>${code}</text></svg>`,
    };
  });
  initializeMock.mockReset();
});

describe("renderAllMermaid: no diagrams", () => {
  it("returns {rendered:0, failed:0} and never imports/initializes mermaid", async () => {
    const r = root("<p>no diagrams here</p>");
    const result = await renderAllMermaid(r, "default");
    expect(result).toEqual({ rendered: 0, failed: 0 });
    expect(renderMock).not.toHaveBeenCalled();
  });
});

describe("renderAllMermaid: successful diagram", () => {
  it("replaces a mermaid code block with figure.mermaid-figure containing the SVG", async () => {
    const r = root('<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>');
    const result = await renderAllMermaid(r, "default");

    expect(result.rendered).toBe(1);
    expect(result.failed).toBe(0);

    const figure = r.querySelector(`figure.${CLASSES.mermaidFigure}`);
    expect(figure).not.toBeNull();
    expect(figure?.querySelector("svg")).not.toBeNull();
    expect(figure?.querySelector("svg style")?.textContent).toContain(".node");
    expect(figure?.textContent).toContain("graph TD");
    // the original <pre> host is gone (replaced)
    expect(r.querySelector("pre")).toBeNull();
  });

  it("also handles a bare .mermaid host element", async () => {
    const r = root('<div class="mermaid">graph LR; X--&gt;Y;</div>');
    const result = await renderAllMermaid(r);
    expect(result.rendered).toBe(1);
    expect(r.querySelector(`figure.${CLASSES.mermaidFigure} svg`)).not.toBeNull();
  });

  it("renders multiple diagrams in one pass", async () => {
    const r = root(
      '<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>' +
        '<pre><code class="language-mermaid">graph TD; C--&gt;D;</code></pre>',
    );
    const result = await renderAllMermaid(r);
    expect(result.rendered).toBe(2);
    expect(r.querySelectorAll(`figure.${CLASSES.mermaidFigure}`).length).toBe(2);
  });

  it("strips external resources from generated SVG", async () => {
    const r = root('<pre><code class="language-mermaid">EXTERNAL</code></pre>');
    await renderAllMermaid(r);
    const image = r.querySelector("svg image");
    expect(image).not.toBeNull();
    expect(image?.hasAttribute("href")).toBe(false);
    expect(image?.hasAttribute("xlink:href")).toBe(false);
  });
});

describe("renderAllMermaid: failure handling", () => {
  it("emits an error placeholder figure (not a throw) when render rejects", async () => {
    const r = root('<pre><code class="language-mermaid">FAIL this diagram</code></pre>');
    let result: { rendered: number; failed: number } | undefined;
    await expect(
      (async () => {
        result = await renderAllMermaid(r);
      })(),
    ).resolves.toBeUndefined();

    expect(result).toEqual({ rendered: 0, failed: 1 });
    const figure = r.querySelector(`figure.${CLASSES.mermaidFigure}`);
    expect(figure).not.toBeNull();
    // failure placeholder keeps the figure atomic and shows the source for recovery
    expect(figure?.textContent ?? "").toContain("FAIL this diagram");
    expect(figure?.querySelector(".diagram-error")).not.toBeNull();
  });

  it("counts mixed success and failure independently", async () => {
    const r = root(
      '<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>' +
        '<pre><code class="language-mermaid">FAIL second</code></pre>',
    );
    const result = await renderAllMermaid(r);
    expect(result).toEqual({ rendered: 1, failed: 1 });
    expect(r.querySelectorAll(`figure.${CLASSES.mermaidFigure}`).length).toBe(2);
  });
});

describe("renderAllMermaid: initialization", () => {
  // The module memoizes initialization, so in a full-file run an earlier test
  // consumes the one initialize call and beforeEach then wipes the mock history —
  // asserting conditionally on "a call was captured" would skip every assertion
  // below. Reset the module registry so this test owns a fresh, uninitialized
  // copy and the pin assertions always execute. (The vi.mock("mermaid") factory
  // survives resetModules; only the module cache is dropped.)
  it("configures mermaid with the pinned v11 rendering flags", async () => {
    vi.resetModules();
    const fresh = await import("../src/render/mermaid");
    const r = root('<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>');
    await fresh.renderAllMermaid(r, "forest");

    expect(initializeMock).toHaveBeenCalledTimes(1);
    const cfg = initializeMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(cfg?.startOnLoad).toBe(false);
    const flowchart = cfg?.flowchart as
      | { useMaxWidth?: boolean; wrappingWidth?: number; minNodeWidth?: number }
      | undefined;
    expect(flowchart?.useMaxWidth).toBe(false);
    expect(cfg?.htmlLabels).toBe(false);
    // Mermaid 12's own defaults (ELK layout, neo look) change diagram geometry
    // and appearance; the preserved v11 rendering stays pinned explicitly.
    expect(cfg?.layout).toBe("dagre");
    expect(cfg?.look).toBe("classic");
    // ...including v11 text metrics (v12 wraps at 120px and floors nodes at
    // 120px wide, which re-wraps labels and widens small nodes).
    expect(flowchart?.wrappingWidth).toBe(200);
    expect(flowchart?.minNodeWidth).toBe(0);
    const state = cfg?.state as
      | { wrappingWidth?: number; minNodeWidth?: number }
      | undefined;
    expect(state?.wrappingWidth).toBe(200);
    expect(state?.minNodeWidth).toBe(0);
    // This run must also have produced a rendered figure.
    expect(r.querySelector(`figure.${CLASSES.mermaidFigure} svg`)).not.toBeNull();
  });
});
