import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { ATTRS, IDS } from "../src/app/dom";

vi.mock("../src/render/highlight", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/render/highlight")>()),
  getHighlighter: vi.fn(async () => ({ codeToTokens: (code: string) => ({
    tokens: code.split("\n").map((content) => [{ content }]),
  }) })),
}));

const { mountEditor } = await import("../src/ui/Editor");
let editor: ReturnType<typeof mountEditor>;
let root: HTMLElement;
let onInput: Mock<(text: string) => void>;

function button(label: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll("button")).find((node) =>
    (node.getAttribute("aria-label") ?? node.textContent) === label);
  if (!found) throw new Error(`Missing editor button: ${label}`);
  return found;
}

function field(label: string): HTMLInputElement {
  const found = root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!found) throw new Error(`Missing editor field: ${label}`);
  return found;
}

function key(key: string, init: KeyboardEventInit = {}, target: EventTarget = editor.input): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

async function query(value: string): Promise<void> {
  field("Find in Markdown").focus();
  field("Find in Markdown").value = value;
  field("Find in Markdown").dispatchEvent(new Event("input", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(100);
}

function selected(): string {
  return editor.input.value.slice(editor.input.selectionStart, editor.input.selectionEnd);
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  root = document.createElement("div");
  root.id = IDS.workspace;
  root.setAttribute(ATTRS.viewMode, "split");
  document.body.append(root);
  onInput = vi.fn<(text: string) => void>();
  editor = mountEditor(root, { codeTheme: "github", onInput });
  editor.setDocument({ name: "note.md", text: "Cat cat cat" });
  editor.input.setSelectionRange(0, 0);
});

afterEach(() => { editor.destroy(); vi.useRealTimers(); });

describe("source Find and Replace", () => {
  it("opens an accessible inline panel from the header and closes back to the source", () => {
    const find = button("Find");
    expect(find.closest('[aria-hidden="true"]')).toBeNull();
    expect(find.getAttribute("aria-expanded")).toBe("false");
    find.click();
    expect(find.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(field("Find in Markdown"));
    key("Escape", {}, field("Find in Markdown"));
    expect(find.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(editor.input);
  });

  it("seeds a selected line, counts results and wraps through both directions", async () => {
    editor.input.setSelectionRange(4, 7);
    expect(key("f", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(field("Find in Markdown").value).toBe("cat");
    await vi.advanceTimersByTimeAsync(100);
    expect(root.querySelector('[role="status"]')?.textContent).toBe("2 of 3 matches");
    button("Next match").click();
    expect(editor.input.selectionStart).toBe(8);
    button("Next match").click();
    expect(editor.input.selectionStart).toBe(0);
    button("Previous match").click();
    expect(editor.input.selectionStart).toBe(8);
  });

  it("keeps query focus during incremental literal search and supports match case", async () => {
    button("Find").click();
    await query("cat");
    expect(document.activeElement).toBe(field("Find in Markdown"));
    expect(selected()).toBe("Cat");
    button("Match case").click();
    expect(button("Match case").getAttribute("aria-pressed")).toBe("true");
    expect(selected()).toBe("cat");
    expect(root.querySelector('[role="status"]')?.textContent).toContain("of 2 matches");
    await query(".*");
    expect(root.querySelector('[role="status"]')?.textContent).toBe("No matches");
    expect(button("Next match").disabled).toBe(true);
  });

  it("finishes counting without stealing a source caret chosen after the query", async () => {
    button("Find").click();
    field("Find in Markdown").value = "cat";
    field("Find in Markdown").dispatchEvent(new Event("input"));
    editor.input.focus();
    editor.input.setSelectionRange(5, 5);
    await vi.advanceTimersByTimeAsync(100);
    expect(document.activeElement).toBe(editor.input);
    expect([editor.input.selectionStart, editor.input.selectionEnd]).toEqual([5, 5]);
    expect(root.querySelector('[role="status"]')?.textContent).toBe("3 matches");
  });

  it("rejects an oversized query explicitly and recovers when it is shortened", async () => {
    button("Find").click();
    await query("a".repeat(100_000));
    expect(root.querySelector('[role="status"]')?.textContent).toContain("maximum 2,000 characters");
    expect(button("Next match").disabled).toBe(true);
    await query("cat");
    expect(root.querySelector('[role="status"]')?.textContent).toBe("1 of 3 matches");
  });

  it("opens Replace with its shortcut and changes only the selected result", async () => {
    expect(key("h", { metaKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field("Replace with"));
    await query("cat");
    field("Replace with").value = "$&<b>";
    button("Replace match").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(editor.input.value).toBe("$&<b> cat cat");
    expect(onInput).toHaveBeenLastCalledWith("$&<b> cat cat");
    expect(selected()).toBe("cat");
  });

  it("replaces all as one source edit, and never silently replaces a truncated set", async () => {
    button("Find").click();
    await query("cat");
    button("Show replace").click();
    field("Replace with").value = "dog";
    button("Replace all").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(editor.input.value).toBe("dog dog dog");
    expect(onInput).toHaveBeenCalledTimes(1);
    editor.setDocument({ name: "many.md", text: "a".repeat(10_001) });
    await query("a");
    expect(root.querySelector('[role="status"]')?.textContent).toContain("10,000+");
    expect(root.querySelector('[role="status"]')?.textContent).toContain("refine search");
    expect(button("Replace all").disabled).toBe(true);
  });

  it("refreshes against the new source and never edits ranges from a previous document", async () => {
    button("Find").click();
    await query("cat");
    button("Show replace").click();
    field("Replace with").value = "dog";
    editor.setDocument({ name: "other.md", text: "new source" });
    button("Replace all").click();
    await vi.advanceTimersByTimeAsync(100);
    expect(editor.input.value).toBe("new source");
    expect(onInput).not.toHaveBeenCalled();
    expect(root.querySelector('[role="status"]')?.textContent).toBe("No matches");
  });

  it("rebinds selection and replacement to a fresh document textarea", async () => {
    button("Find").click();
    await query("cat");
    const previous = editor.input;
    editor.setDocument({ name: "next.md", text: "cat and cat" });
    await vi.advanceTimersByTimeAsync(100);
    expect(editor.input).not.toBe(previous);
    editor.input.setSelectionRange(8, 11);
    editor.input.dispatchEvent(new Event("select"));
    expect(root.querySelector('[role="status"]')?.textContent).toBe("2 of 2 matches");
    button("Show replace").click();
    field("Replace with").value = "dog";
    button("Replace match").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(editor.input.value).toBe("cat and dog");
    expect(previous.value).toBe("Cat cat cat");
    expect(onInput).toHaveBeenLastCalledWith("cat and dog");
  });

  it("refuses accepted delayed replacement after focus moves without changing selection", async () => {
    editor.destroy();
    let finish!: (accepted: boolean) => void;
    editor = mountEditor(root, { codeTheme: "github", onInput, largeInsertBytes: 1,
      confirmLargeInsert: () => new Promise<boolean>(resolve => { finish = resolve; }) });
    editor.setDocument({ name: "note.md", text: "cat cat" });
    editor.input.setSelectionRange(0, 0);
    button("Find").click();
    await query("cat");
    button("Show replace").click();
    field("Replace with").value = "longer";
    key("Enter", {}, field("Replace with"));
    const outside = document.createElement("button");
    root.append(outside);
    outside.focus();
    finish(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.activeElement).toBe(outside);
    expect(editor.input.value).toBe("cat cat");
    expect(onInput).not.toHaveBeenCalled();
  });

  it("keeps Replace focused after an accepted delayed edit with no user focus move", async () => {
    editor.destroy();
    let finish!: (accepted: boolean) => void;
    editor = mountEditor(root, { codeTheme: "github", onInput, largeInsertBytes: 1,
      confirmLargeInsert: () => new Promise<boolean>(resolve => { finish = resolve; }) });
    editor.setDocument({ name: "note.md", text: "cat cat" });
    editor.input.setSelectionRange(0, 0);
    button("Find").click();
    await query("cat");
    button("Show replace").click();
    field("Replace with").value = "longer";
    key("Enter", {}, field("Replace with"));
    finish(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(editor.input.value).toBe("longer cat");
    expect(selected()).toBe("cat");
    expect(document.activeElement).toBe(field("Replace with"));
  });

  it("does not reclaim focus after a delayed replacement is refused", async () => {
    editor.destroy();
    let finish!: (accepted: boolean) => void;
    editor = mountEditor(root, { codeTheme: "github", onInput, largeInsertBytes: 1,
      confirmLargeInsert: () => new Promise<boolean>(resolve => { finish = resolve; }) });
    editor.setDocument({ name: "note.md", text: "cat cat" });
    editor.input.setSelectionRange(0, 0);
    button("Find").click();
    await query("cat");
    button("Show replace").click();
    field("Replace with").value = "longer";
    key("Enter", {}, field("Replace with"));
    editor.input.focus();
    editor.input.setSelectionRange(5, 5);
    finish(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.activeElement).toBe(editor.input);
    expect([editor.input.selectionStart, editor.input.selectionEnd]).toEqual([5, 5]);
    expect(editor.input.value).toBe("cat cat");
  });

  it("refuses multiplied UTF-8 overflow before constructing a bulk edit", async () => {
    editor.destroy();
    const confirm = vi.fn(async () => true);
    editor = mountEditor(root, { codeTheme: "github", onInput, hardLimitBytes: 20,
      largeInsertBytes: 5, confirmLargeInsert: confirm });
    editor.setDocument({ name: "note.md", text: "a a a a" });
    editor.input.setSelectionRange(0, 0);
    button("Find").click();
    await query("a");
    button("Show replace").click();
    field("Replace with").value = "ééé";
    button("Replace all").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(editor.input.value).toBe("a a a a");
    expect(onInput).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(root.querySelector('[role="status"]')?.textContent).toContain("document size limit");
  });

  it("preserves the host Find in preview-only, detached, inert and composed states", () => {
    root.setAttribute(ATTRS.viewMode, "preview");
    expect(key("f", { ctrlKey: true }).defaultPrevented).toBe(false);
    root.setAttribute(ATTRS.viewMode, "split");
    root.setAttribute("inert", "");
    expect(key("f", { ctrlKey: true }).defaultPrevented).toBe(false);
    root.removeAttribute("inert");
    expect(key("f", { ctrlKey: true, isComposing: true }).defaultPrevented).toBe(false);
    expect(key("f", { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    expect(key("f", { ctrlKey: true, metaKey: true }).defaultPrevented).toBe(false);
    root.remove();
    expect(key("f", { ctrlKey: true }, window).defaultPrevented).toBe(false);
  });

  it("cancels a pending query on close and tears down its global shortcut", async () => {
    button("Find").click();
    field("Find in Markdown").value = "cat";
    field("Find in Markdown").dispatchEvent(new Event("input"));
    button("Close find").click();
    await vi.advanceTimersByTimeAsync(100);
    expect(editor.input.selectionStart).toBe(0);
    expect(editor.input.selectionEnd).toBe(0);
    editor.destroy();
    expect(key("f", { ctrlKey: true }, window).defaultPrevented).toBe(false);
  });
});
