import { describe, it, expect, vi } from "vitest";
import { mountBanner } from "../src/ui/Banner";

describe("banner offer (the rest of a cut-short data view)", () => {
  it("shows its actions, and clear() or fatal() take it away with the document", () => {
    const root = document.createElement("div");
    const banner = mountBanner(root);
    const offer = (): HTMLElement => root.querySelector(".canvas-offer")!;
    const run = vi.fn();
    banner.offer("This data view was cut short.", [{ label: "Show all", run }]);
    expect(offer().hidden).toBe(false);
    offer().querySelector("button")!.click();
    expect(run).toHaveBeenCalledOnce();
    banner.clear(); // the last document closed
    expect(offer().hidden).toBe(true);
    expect(offer().childElementCount).toBe(0);
    banner.offer("This data view was cut short.", [{ label: "Show all", run }]);
    banner.fatal("Render failed"); // another document failed to render
    expect(offer().hidden).toBe(true);
    banner.offer(null, []);
    expect(offer().hidden).toBe(true);
  });
});
