import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";
import { IDS } from "../src/app/dom";
import { SPLIT_RATIO_MAX, SPLIT_RATIO_MIN } from "../src/app/settings";
import { mountSplitter } from "../src/ui/Splitter";

/**
 * jsdom has no layout engine, so pointer-drag geometry is exercised by stubbing the
 * track's bounding box. Everything else here — clamping, ARIA state, the
 * preview/commit split, keyboard operation — is real behaviour.
 */
let root: HTMLElement;
let track: HTMLElement;
let splitter: ReturnType<typeof mountSplitter>;
let onPreview: Mock<(ratio: number) => void>;
let onCommit: Mock<(ratio: number) => void>;

function handle(): HTMLElement {
  const el = document.getElementById(IDS.splitHandle);
  if (!el) throw new Error("split handle not mounted");
  return el;
}

function pressKey(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true });
  handle().dispatchEvent(event);
  return event;
}

/** A pointerdown/move/up gesture at the given client x-coordinates. */
function drag(...xs: number[]): void {
  handle().dispatchEvent(
    new MouseEvent("pointerdown", { button: 0, bubbles: true, cancelable: true }),
  );
  for (const clientX of xs) {
    window.dispatchEvent(new MouseEvent("pointermove", { clientX, bubbles: true, cancelable: true }));
  }
  window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
}

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement("div");
  track = document.createElement("div");
  document.body.append(root, track);
  // 1000px wide track starting at x=0 → clientX maps 1:1 onto percent.
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 600, width: 1000, height: 600,
    toJSON: () => ({}),
  } as DOMRect);
  onPreview = vi.fn<(ratio: number) => void>();
  onCommit = vi.fn<(ratio: number) => void>();
  splitter = mountSplitter(root, { track, initialRatio: 0.42, onPreview, onCommit });
});

afterEach(() => {
  splitter.destroy();
  document.body.classList.remove("is-splitting");
});

describe("Splitter: accessibility contract", () => {
  it("is a keyboard-reachable separator carrying its range", () => {
    const el = handle();
    expect(el.getAttribute("role")).toBe("separator");
    expect(el.getAttribute("aria-orientation")).toBe("vertical");
    expect(el.tabIndex).toBe(0);
    expect(el.getAttribute("aria-valuemin")).toBe("20");
    expect(el.getAttribute("aria-valuemax")).toBe("80");
    expect(el.getAttribute("aria-valuenow")).toBe("42");
  });

  it("arrow keys resize and commit immediately", () => {
    expect(pressKey("ArrowRight").defaultPrevented).toBe(true);
    expect(onPreview).toHaveBeenLastCalledWith(0.44);
    expect(onCommit).toHaveBeenLastCalledWith(0.44);
    expect(handle().getAttribute("aria-valuenow")).toBe("44");

    pressKey("ArrowLeft");
    expect(onCommit).toHaveBeenLastCalledWith(0.42);
  });

  it("Home and End snap to the clamped extremes", () => {
    pressKey("Home");
    expect(onCommit).toHaveBeenLastCalledWith(SPLIT_RATIO_MIN);
    pressKey("End");
    expect(onCommit).toHaveBeenLastCalledWith(SPLIT_RATIO_MAX);
  });

  it("Enter resets to an even split", () => {
    pressKey("Enter");
    expect(onCommit).toHaveBeenLastCalledWith(0.5);
  });

  it("ignores unrelated keys without swallowing them", () => {
    onCommit.mockClear();
    expect(pressKey("a").defaultPrevented).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("never lets a key press collapse a pane past its bound", () => {
    for (let i = 0; i < 60; i += 1) pressKey("ArrowLeft");
    expect(onCommit).toHaveBeenLastCalledWith(SPLIT_RATIO_MIN);
    for (let i = 0; i < 120; i += 1) pressKey("ArrowRight");
    expect(onCommit).toHaveBeenLastCalledWith(SPLIT_RATIO_MAX);
  });
});

describe("Splitter: pointer drag", () => {
  it("previews continuously and commits once at the end of the gesture", () => {
    drag(300, 500, 650);
    expect(onPreview.mock.calls.map((c) => c[0])).toEqual([0.3, 0.5, 0.65]);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith(0.65);
  });

  it("clamps a drag that runs off either edge", () => {
    drag(-400);
    expect(onCommit).toHaveBeenLastCalledWith(SPLIT_RATIO_MIN);
    drag(4000);
    expect(onCommit).toHaveBeenLastCalledWith(SPLIT_RATIO_MAX);
  });

  it("marks the body during the gesture and clears it afterwards", () => {
    handle().dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, bubbles: true, cancelable: true }),
    );
    expect(document.body.classList.contains("is-splitting")).toBe(true);
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    expect(document.body.classList.contains("is-splitting")).toBe(false);
  });

  it("ignores non-primary buttons and stray moves outside a gesture", () => {
    handle().dispatchEvent(new MouseEvent("pointerdown", { button: 2, bubbles: true }));
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 800, bubbles: true }));
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("double-click resets to an even split", () => {
    handle().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(onCommit).toHaveBeenLastCalledWith(0.5);
  });
});

/**
 * A drag released outside the browser viewport is not guaranteed to deliver
 * pointerup/pointercancel to `window`. Without a capture, the divider would stay in
 * `dragging` with body.is-splitting set — text interaction dead and the ratio
 * unpersisted — until a reload. jsdom implements none of the capture API, so these
 * stub it and assert the wiring.
 */
describe("Splitter: the gesture always terminates", () => {
  function stubCapture(): { captured: number[]; released: number[] } {
    const captured: number[] = [];
    const released: number[] = [];
    const el = handle() as HTMLElement & {
      setPointerCapture(id: number): void;
      releasePointerCapture(id: number): void;
    };
    el.setPointerCapture = (id: number): void => {
      captured.push(id);
    };
    el.releasePointerCapture = (id: number): void => {
      released.push(id);
    };
    return { captured, released };
  }

  function pointerDown(pointerId = 7): void {
    const event = new MouseEvent("pointerdown", {
      button: 0,
      bubbles: true,
      cancelable: true,
    }) as MouseEvent & { pointerId: number };
    Object.defineProperty(event, "pointerId", { value: pointerId });
    handle().dispatchEvent(event);
  }

  it("captures the initiating pointer for the whole drag", () => {
    const { captured } = stubCapture();
    pointerDown(7);
    expect(captured).toEqual([7]);
  });

  it("ends the drag on lostpointercapture — the release-outside-the-window case", () => {
    stubCapture();
    pointerDown();
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 600, bubbles: true }));
    expect(document.body.classList.contains("is-splitting")).toBe(true);

    // No pointerup ever arrives; only the capture is lost.
    handle().dispatchEvent(new Event("lostpointercapture", { bubbles: true }));

    expect(document.body.classList.contains("is-splitting")).toBe(false);
    expect(handle().classList.contains("is-dragging")).toBe(false);
    expect(onCommit).toHaveBeenLastCalledWith(0.6);

    // And the gesture is truly over: further moves must not resize.
    onPreview.mockClear();
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 900, bubbles: true }));
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("ends the drag when the window loses focus", () => {
    stubCapture();
    pointerDown();
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 550, bubbles: true }));
    window.dispatchEvent(new Event("blur"));

    expect(document.body.classList.contains("is-splitting")).toBe(false);
    expect(onCommit).toHaveBeenLastCalledWith(0.55);
  });

  it("commits exactly once however many terminators arrive", () => {
    stubCapture();
    pointerDown();
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 500, bubbles: true }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    handle().dispatchEvent(new Event("lostpointercapture", { bubbles: true }));
    window.dispatchEvent(new Event("blur"));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("still works where the capture API is unavailable (the jsdom default)", () => {
    // No stub at all: setPointerCapture is undefined and must not break the drag.
    drag(300, 500);
    expect(onCommit).toHaveBeenLastCalledWith(0.5);
    expect(document.body.classList.contains("is-splitting")).toBe(false);
  });
});

describe("Splitter: external sync and teardown", () => {
  it("sync() reflects a ratio changed elsewhere without emitting", () => {
    splitter.sync(0.7);
    expect(handle().getAttribute("aria-valuenow")).toBe("70");
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("destroy() removes the handle and detaches window listeners", () => {
    handle().dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, bubbles: true, cancelable: true }),
    );
    splitter.destroy();
    expect(document.getElementById(IDS.splitHandle)).toBeNull();
    expect(document.body.classList.contains("is-splitting")).toBe(false);

    onPreview.mockClear();
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 900, bubbles: true }));
    expect(onPreview).not.toHaveBeenCalled();
  });
});
