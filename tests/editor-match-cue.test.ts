import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountEditorMatchCue } from "../src/ui/EditorMatchCue";
import type { EditorMatchCue } from "../src/ui/EditorMatchCue";

let input: HTMLTextAreaElement;
let backdrop: HTMLElement;
let cue: EditorMatchCue;
let layer: HTMLElement;
let clientWidth: number;
let measured: DOMRect[];
let ranges: Range[];
let onResize: () => void;
let nextFrame: number;
const frames = new Map<number, FrameRequestCallback>();
const readRects = vi.fn();
const observe = vi.fn();
const disconnect = vi.fn();
const box = new DOMRect(10, 100, 300, 180);

function flushFrame(): void {
  const queued = [...frames.values()];
  frames.clear();
  for (const callback of queued) callback(0);
}

function rects(): HTMLElement[] { return [...layer.children] as HTMLElement[]; }

function giveGeometry(target: HTMLTextAreaElement): void {
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue(box);
  Object.defineProperties(target, {
    clientWidth: { configurable: true, get: () => clientWidth },
    clientHeight: { configurable: true, value: 180 },
  });
}

beforeEach(() => {
  document.body.replaceChildren();
  nextFrame = 0;
  frames.clear();
  readRects.mockClear();
  observe.mockClear();
  disconnect.mockClear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { onResize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  clientWidth = 280;
  measured = [new DOMRect(26, 114, 40, 20)];
  ranges = [];
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, "createRange").mockImplementation(() => {
    const range = createRange();
    Object.defineProperty(range, "getClientRects", { value: () => { readRects(); return measured; } });
    ranges.push(range);
    return range;
  });
  input = document.createElement("textarea");
  input.value = "first\nsecond\nlast";
  input.style.padding = "14px 16px";
  backdrop = document.createElement("pre");
  for (const text of ["fir", "st\n", "second", "\nlast"]) {
    const token = document.createElement("span");
    token.textContent = text;
    backdrop.append(token);
  }
  const scroll = document.createElement("div");
  scroll.append(backdrop, input);
  document.body.append(scroll);
  giveGeometry(input);
  cue = mountEditorMatchCue(input, backdrop);
  layer = document.querySelector<HTMLElement>("#editor-match-cue")!;
});

afterEach(() => { cue.destroy(); vi.unstubAllGlobals(); });

describe("active source-match geometry and lifecycle", () => {
  it("measures across syntax nodes and wrapped/newline rows without changing editing state", () => {
    measured = [new DOMRect(26, 114, 20, 20), new DOMRect(26, 114, 20, 20),
      new DOMRect(46, 114, 10, 20), new DOMRect(26, 136, 25, 20)];
    input.focus();
    input.setSelectionRange(3, 9, "backward");
    const editing = vi.fn();
    input.addEventListener("input", editing);
    cue.show({ start: 3, end: 9 });
    expect(ranges[0]!.toString()).toBe("st\nsec");
    expect(rects().map(rect => [rect.style.left, rect.style.top, rect.style.width, rect.style.height]))
      .toEqual([["16px", "14px", "30px", "20px"], ["16px", "36px", "25px", "20px"]]);
    expect(layer.hidden).toBe(false);
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([3, 9, "backward"]);
    expect(input.value).toBe("first\nsecond\nlast");
    expect(editing).not.toHaveBeenCalled();
  });

  it("translates and clips cached rectangles on scroll without walking or measuring source again", () => {
    measured = [new DOMRect(26, 150, 40, 20)];
    const walk = vi.spyOn(document, "createTreeWalker");
    cue.show({ start: 0, end: 5 });
    cue.show({ start: 0, end: 5 });
    expect(readRects).toHaveBeenCalledTimes(1);
    input.scrollTop = 55;
    input.dispatchEvent(new Event("scroll"));
    flushFrame();
    expect(rects()[0]!.style.top).toBe("0px");
    expect(rects()[0]!.style.height).toBe("15px");
    input.scrollTop = 100;
    input.dispatchEvent(new Event("scroll"));
    flushFrame();
    expect(layer.hidden).toBe(true);
    input.scrollTop = 0;
    input.dispatchEvent(new Event("scroll"));
    flushFrame();
    expect(rects()[0]!.style.top).toBe("50px");
    expect(readRects).toHaveBeenCalledTimes(1);
    expect(walk).toHaveBeenCalledTimes(1);
  });

  it("uses backdrop scroll coordinates when the textarea has scrolled before its paint layer", () => {
    backdrop.scrollTop = 20;
    input.scrollTop = 35;
    cue.show({ start: 0, end: 5 });
    expect(rects()[0]!.style.top).toBe("0px");
    expect(rects()[0]!.style.height).toBe("19px");
  });

  it("remeasures only while active and coalesces layout changes into one frame", () => {
    onResize();
    window.dispatchEvent(new Event("resize"));
    input.dispatchEvent(new Event("scroll"));
    flushFrame();
    expect(readRects).not.toHaveBeenCalled();
    cue.show({ start: 0, end: 5 });
    expect(observe).toHaveBeenCalledWith(input);
    onResize();
    flushFrame();
    expect(readRects).toHaveBeenCalledTimes(1);
    clientWidth = 160;
    measured = [new DOMRect(26, 114, 10, 20), new DOMRect(26, 136, 30, 20)];
    onResize();
    onResize();
    window.dispatchEvent(new Event("resize"));
    expect(frames.size).toBe(1);
    flushFrame();
    expect(readRects).toHaveBeenCalledTimes(2);
    expect(rects()).toHaveLength(2);
    expect(layer.style.width).toBe("160px");
    cue.clear();
    onResize();
    window.dispatchEvent(new Event("resize"));
    input.dispatchEvent(new Event("scroll"));
    flushFrame();
    expect(readRects).toHaveBeenCalledTimes(2);
    expect(layer.hidden).toBe(true);
    expect(rects()).toHaveLength(0);
    expect(disconnect).toHaveBeenCalled();
  });

  it("cancels queued painting, rebinds fresh input, and removes the layer at teardown", () => {
    cue.show({ start: 0, end: 5 });
    window.dispatchEvent(new Event("resize"));
    const previous = input;
    const next = document.createElement("textarea");
    next.value = previous.value;
    giveGeometry(next);
    previous.replaceWith(next);
    cue.setInput(next);
    expect(frames.size).toBe(0);
    expect(layer.hidden).toBe(true);
    expect(rects()).toHaveLength(0);
    previous.dispatchEvent(new Event("scroll"));
    expect(frames.size).toBe(0);
    cue.show({ start: 0, end: 5 });
    expect(layer.previousElementSibling).toBe(next);
    expect(layer.hidden).toBe(false);
    window.dispatchEvent(new Event("resize"));
    cue.destroy();
    expect(frames.size).toBe(0);
    expect(layer.isConnected).toBe(false);
    next.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    flushFrame();
    expect(readRects).toHaveBeenCalledTimes(2);
  });

  it("refreshes changed font metrics while active and stops listening when cleared", () => {
    const original = Object.getOwnPropertyDescriptor(document, "fonts");
    const fonts = new EventTarget();
    Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
    try {
      cue.show({ start: 0, end: 5 });
      measured = [new DOMRect(26, 114, 55, 22)];
      fonts.dispatchEvent(new Event("loadingdone"));
      fonts.dispatchEvent(new Event("loadingdone"));
      expect(frames.size).toBe(1);
      flushFrame();
      expect(readRects).toHaveBeenCalledTimes(2);
      expect(rects()[0]!.style.width).toBe("55px");
      expect(rects()[0]!.style.height).toBe("22px");
      cue.clear();
      fonts.dispatchEvent(new Event("loadingdone"));
      flushFrame();
      expect(readRects).toHaveBeenCalledTimes(2);
      expect(layer.hidden).toBe(true);
    } finally {
      cue.clear();
      if (original) Object.defineProperty(document, "fonts", original);
      else Reflect.deleteProperty(document, "fonts");
    }
  });

  it("measures plain-source wrapped matches in one temporary mirror and retains no source copy", () => {
    input.value = "prefix\nwrapped match\nmore match\nuntouched suffix";
    input.scrollTop = 30;
    input.style.fontFamily = "monospace";
    backdrop.replaceChildren();
    let mirrorText = "";
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
      expect(this.tagName).toBe("SPAN");
      const mirror = this.parentElement!;
      mirrorText = mirror.textContent!;
      expect(this.textContent).toBe("wrapped match\nmore");
      expect(mirror.style.width).toBe("280px");
      expect(mirror.style.fontFamily).toBe("monospace");
      expect(mirror.style.visibility).toBe("hidden");
      return [new DOMRect(26, 150, 100, 20), new DOMRect(26, 172, 40, 20)] as unknown as DOMRectList;
    });
    cue.show({ start: 7, end: 25 });
    expect(mirrorText).toBe("prefix\nwrapped match\nmore match");
    expect(rects().map(rect => rect.style.top)).toEqual(["20px", "42px"]);
    expect(document.body.textContent).not.toContain("untouched suffix");
    expect(document.body.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    expect(readRects).not.toHaveBeenCalled();
    input.dispatchEvent(new Event("scroll"));
    flushFrame();
    expect(HTMLElement.prototype.getClientRects).toHaveBeenCalledTimes(1);
  });

  it("makes an otherwise zero-width newline visible and refuses detached measurements", () => {
    measured = [new DOMRect(26, 114, 0, 20)];
    cue.show({ start: 5, end: 6 });
    expect(rects()[0]!.style.width).toBe("2px");
    input.remove();
    cue.show({ start: 6, end: 12 });
    expect(layer.hidden).toBe(true);
    expect(readRects).toHaveBeenCalledTimes(1);
  });
});
