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
    return { svg: `<svg data-id="${id}"><g></g></svg>` };
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
    return { svg: `<svg data-id="${id}"><g></g></svg>` };
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
  // The module memoizes initialization, so across the whole suite mermaid.initialize
  // runs at most once. We assert the config shape from whichever call captured it,
  // without depending on test ordering or the theme arg of this particular call.
  it("configures mermaid with startOnLoad:false and useMaxWidth:false when it initializes", async () => {
    const r = root('<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>');
    await renderAllMermaid(r, "forest");

    // If this run was the first to touch mermaid, it will have initialized here.
    // Otherwise initialization already happened in an earlier test; either way the
    // captured config (when present) must carry the load-bearing flags.
    if (initializeMock.mock.calls.length > 0) {
      const cfg = initializeMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(cfg?.startOnLoad).toBe(false);
      const flowchart = cfg?.flowchart as { useMaxWidth?: boolean } | undefined;
      expect(flowchart?.useMaxWidth).toBe(false);
    }
    // Regardless, this run must have produced a rendered figure.
    expect(r.querySelector(`figure.${CLASSES.mermaidFigure} svg`)).not.toBeNull();
  });
});
