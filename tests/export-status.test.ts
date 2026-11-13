import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountExportStatus } from "../src/ui/ExportStatus";

beforeEach(() => { document.body.replaceChildren(); });

describe("PDF export status", () => {
  it("keeps its live region mounted outside the preview and never moves source focus", () => {
    const root = document.createElement("div");
    const source = document.createElement("textarea");
    source.value = "Selected source";
    root.append(source);
    document.body.append(root);
    const status = mountExportStatus(root);
    const live = root.querySelector<HTMLElement>("#export-status-live")!;
    expect(live.getAttribute("role")).toBe("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.getAttribute("aria-atomic")).toBe("true");
    expect(live.closest("[hidden], #canvas")).toBeNull();
    source.focus();
    source.setSelectionRange(2, 8, "backward");

    status.update({ phase: "preparing" });
    status.update({ phase: "rendering", done: 1, total: 3 });
    expect(document.activeElement).toBe(source);
    expect([source.selectionStart, source.selectionEnd, source.selectionDirection]).toEqual([2, 8, "backward"]);
    const progress = root.querySelector("progress")!;
    expect(progress.value).toBe(1);
    expect(progress.max).toBe(3);
    expect(progress.getAttribute("aria-label")).toBe("PDF pages rendered");
    expect(live.textContent).toContain("1 of 3");
    status.destroy();
    expect(root.querySelector("#export-status")).toBeNull();
  });

  it("updates every visible page count but announces at most five progress milestones", () => {
    const status = mountExportStatus(document.body);
    const live = document.querySelector("#export-status-live")!;
    status.update({ phase: "preparing" });
    const announcements: string[] = [];
    let previous = live.textContent;
    for (let done = 1; done <= 100; done++) {
      status.update({ phase: "rendering", done, total: 100 });
      expect(document.querySelector(".export-status-text")!.textContent).toContain(`${done} of 100`);
      if (live.textContent !== previous) announcements.push(live.textContent!);
      previous = live.textContent;
    }
    expect(announcements).toHaveLength(5);
    expect(announcements.at(-1)).toContain("100 of 100");
  });

  it("distinguishes waiting for a save, native success, web handoff, failure, and cancellation", () => {
    const status = mountExportStatus(document.body);
    const live = document.querySelector("#export-status-live")!;
    status.update({ phase: "saving" });
    expect(live.textContent).toBe("Saving PDF…");
    expect(live.textContent).not.toContain("saved");
    status.update({ phase: "saved" });
    expect(live.textContent).toBe("PDF saved.");
    status.update({ phase: "download-requested" });
    expect(live.textContent).toBe("PDF download requested.");
    status.update({ phase: "failed", message: "Stylesheet could not load. Try Print / Save as PDF." });
    expect(live.textContent).toContain("PDF export failed: Stylesheet could not load.");
    expect(document.querySelector("progress")!.hidden).toBe(true);
    status.update({ phase: "canceled" });
    expect(live.textContent).toBe("PDF save canceled. Your document is still open.");
    status.update({ phase: "preparing" });
    expect(live.textContent).toBe("Preparing PDF…");
    expect(document.querySelector("progress")!.hidden).toBe(false);
    // Terminal outcomes and the save handoff offer no control: they cannot be recalled from here.
    expect(document.querySelectorAll("button:not([hidden])")).toHaveLength(1);
  });

  it("offers Cancel only while a stop can still be honored, and reports the two stages of it", () => {
    const onCancel = vi.fn();
    const status = mountExportStatus(document.body, onCancel);
    const live = document.querySelector("#export-status-live")!;
    const cancel = document.querySelector<HTMLButtonElement>(".export-status-cancel")!;
    expect(cancel.getAttribute("aria-label")).toBe("Cancel PDF export");
    const visible = (phase: Parameters<typeof status.update>[0]) => { status.update(phase); return !cancel.hidden; };
    expect(visible({ phase: "idle" })).toBe(false);
    expect(visible({ phase: "preparing" })).toBe(true);
    expect(visible({ phase: "rendering", done: 1, total: 4 })).toBe(true);
    cancel.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(visible({ phase: "cancel-requested" })).toBe(false);
    expect(live.textContent).toBe("Canceling PDF export…");
    expect(document.querySelector("progress")!.hidden).toBe(false);
    for (const phase of ["saving", "downloading", "saved", "download-requested", "canceled", "failed"] as const) {
      expect(visible(phase === "failed" ? { phase, message: "x" } : { phase }), phase).toBe(false);
    }
    expect(visible({ phase: "export-canceled" })).toBe(false);
    expect(live.textContent).toBe("PDF export canceled. Nothing was saved. Your document is still open.");
    expect(document.querySelector("progress")!.hidden).toBe(true);
  });

  it("bounds and escapes failure detail while keeping its reason outside the preview", () => {
    const status = mountExportStatus(document.body);
    status.update({ phase: "failed", message: "<script>source</script>\n" + "detail ".repeat(100) });
    const live = document.querySelector("#export-status-live")!;
    expect(live.textContent).toContain("<script>source</script> detail");
    expect(live.textContent!.length).toBeLessThanOrEqual(200);
    expect(live.textContent).toMatch(/…$/);
    expect(document.querySelector("script")).toBeNull();
  });
});
