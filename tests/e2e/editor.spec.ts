import { test, expect } from "@playwright/test";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

/**
 * The split workspace: typing Markdown on the left, watching the paginated preview
 * rebuild on the right, and giving either surface the whole window.
 *
 * These assertions need a real layout engine (grid columns, overlay alignment,
 * @media print), which is exactly why they live here rather than in jsdom.
 */

const EDITOR = "#editor-pane";
const INPUT = "#editor-input";
const HANDLE = "#split-handle";
const WORKSPACE = "#workspace";

/** Text of the first paginated page, once pagination has settled. */
async function firstPageText(page: import("@playwright/test").Page): Promise<string> {
  return (await page.locator("#paged-output .pagedjs_page").first().innerText()) ?? "";
}

test.describe("split workspace: view modes", () => {
  test("boots with the source pane and the preview side by side", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(WORKSPACE)).toHaveAttribute("data-view-mode", "split");
    await expect(page.locator(EDITOR)).toBeVisible();
    await expect(page.locator(INPUT)).toBeVisible();
    await expect(page.locator("#canvas")).toBeVisible();
    await expect(page.locator(HANDLE)).toBeVisible();

    // Side by side means exactly that: the editor sits entirely left of the preview.
    const editorBox = await page.locator(EDITOR).boundingBox();
    const canvasBox = await page.locator("#canvas").boundingBox();
    expect(editorBox!.x + editorBox!.width).toBeLessThanOrEqual(canvasBox!.x + 1);
  });

  test("the three view-mode buttons show exactly the panes they name", async ({ page }) => {
    await page.goto("/");
    const markdownOnly = page.getByRole("button", { name: "Markdown" });
    const split = page.getByRole("button", { name: "Split", exact: true });
    const previewOnly = page.getByRole("button", { name: "Preview", exact: true });

    await markdownOnly.click();
    await expect(page.locator(WORKSPACE)).toHaveAttribute("data-view-mode", "editor");
    await expect(page.locator(EDITOR)).toBeVisible();
    await expect(page.locator("#canvas")).toBeHidden();
    await expect(markdownOnly).toHaveAttribute("aria-pressed", "true");

    await previewOnly.click();
    await expect(page.locator(WORKSPACE)).toHaveAttribute("data-view-mode", "preview");
    await expect(page.locator(EDITOR)).toBeHidden();
    await expect(page.locator("#canvas")).toBeVisible();
    await expect(previewOnly).toHaveAttribute("aria-pressed", "true");

    await split.click();
    await expect(page.locator(EDITOR)).toBeVisible();
    await expect(page.locator("#canvas")).toBeVisible();
  });

  test("switching modes keeps the document and the editor's text", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, "# Kept\n\nThis survives a mode switch.");
    await waitForPagination(page);

    await page.getByRole("button", { name: "Markdown" }).click();
    await expect(page.locator(INPUT)).toHaveValue(/# Kept/);

    await page.getByRole("button", { name: "Preview", exact: true }).click();
    // The preview was never torn down, so the pages are still there immediately.
    expect(await page.locator("#paged-output .pagedjs_page").count()).toBeGreaterThan(0);
    expect(await firstPageText(page)).toContain("Kept");
  });

  test("the view mode persists across a reload", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Markdown" }).click();
    await expect(page.locator(WORKSPACE)).toHaveAttribute("data-view-mode", "editor");

    await page.reload();
    await expect(page.locator(WORKSPACE)).toHaveAttribute("data-view-mode", "editor");
    await expect(page.locator("#canvas")).toBeHidden();
  });
});

test.describe("split workspace: typing drives the preview", () => {
  test("typing Markdown into an empty app paginates it live", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#empty-state")).toBeVisible();

    await page.locator(INPUT).fill("# Typed heading\n\nA paragraph written by hand.");
    const count = await waitForPagination(page);
    expect(count).toBeGreaterThan(0);

    const text = await firstPageText(page);
    expect(text).toContain("Typed heading");
    expect(text).toContain("A paragraph written by hand.");
    // A document exists now, so the dropzone must step aside.
    await expect(page.locator("#empty-state")).toBeHidden();
  });

  test("editing an opened file updates the preview without reopening it", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, "# Original title\n\nOriginal body.", "paper.md");
    await waitForPagination(page);
    expect(await firstPageText(page)).toContain("Original title");

    // The pane shows the file's own source, ready to edit.
    await expect(page.locator(INPUT)).toHaveValue(/# Original title/);
    await expect(page.locator(EDITOR)).toContainText("paper.md");

    await page.locator(INPUT).fill("# Revised title\n\nRevised body.");
    await expect
      .poll(async () => firstPageText(page), { timeout: 15_000 })
      .toContain("Revised title");
    expect(await firstPageText(page)).not.toContain("Original title");
    // Still one document — editing must not open a second.
    await expect(page.locator(".doc-switcher")).toBeHidden();
  });

  test("a code fence typed by hand still renders through Shiki", async ({ page }) => {
    await page.goto("/");
    await page
      .locator(INPUT)
      .fill("# Code\n\n```ts\nconst answer: number = 42;\n```\n");
    await waitForPagination(page);
    await expect(page.locator("#paged-output pre.shiki").first()).toBeVisible();
    expect(await firstPageText(page)).toContain("const answer");
  });

  test("the syntax backdrop paints the source and stays aligned with the textarea", async ({
    page,
  }) => {
    await page.goto("/");
    const source = "# Heading\n\n**bold** and `code`\n\n- a list item\n";
    await page.locator(INPUT).fill(source);
    await waitForPagination(page);

    const pane = page.locator(EDITOR);
    await expect(pane).toHaveAttribute("data-highlight", "on", { timeout: 10_000 });

    const backdrop = page.locator("#editor-highlight");
    // Same characters, colored by Shiki's markdown grammar.
    expect(await backdrop.evaluate((el) => el.textContent)).toBe(source);
    expect(await backdrop.locator("span[style]").count()).toBeGreaterThan(0);

    // The two layers must occupy the same box, or the colors drift off the glyphs.
    const boxes = await page.evaluate(() => {
      const rect = (sel: string): { x: number; y: number; w: number; h: number } => {
        const r = document.querySelector(sel)!.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const style = (sel: string): string[] => {
        const cs = getComputedStyle(document.querySelector(sel)!);
        return [cs.fontFamily, cs.fontSize, cs.lineHeight, cs.padding, cs.whiteSpace];
      };
      return {
        input: rect("#editor-input"),
        highlight: rect("#editor-highlight"),
        inputStyle: style("#editor-input"),
        highlightStyle: style("#editor-highlight"),
      };
    });
    expect(boxes.highlight).toEqual(boxes.input);
    expect(boxes.highlightStyle).toEqual(boxes.inputStyle);
  });
});

test.describe("split workspace: the divider", () => {
  test("dragging the handle resizes the panes and the size persists", async ({ page }) => {
    await page.goto("/");
    const before = (await page.locator(EDITOR).boundingBox())!.width;

    const handleBox = (await page.locator(HANDLE).boundingBox())!;
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 200, handleBox.y + handleBox.height / 2, { steps: 10 });
    await page.mouse.up();

    await expect
      .poll(async () => (await page.locator(EDITOR).boundingBox())!.width)
      .toBeGreaterThan(before + 100);

    const widened = (await page.locator(EDITOR).boundingBox())!.width;
    await page.reload();
    await expect
      .poll(async () => (await page.locator(EDITOR).boundingBox())!.width)
      .toBeCloseTo(widened, -1);
  });

  test("the handle is a keyboard-operable separator", async ({ page }) => {
    await page.goto("/");
    const handle = page.locator(HANDLE);
    await expect(handle).toHaveAttribute("role", "separator");

    await handle.focus();
    const before = Number(await handle.getAttribute("aria-valuenow"));
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const after = Number(await handle.getAttribute("aria-valuenow"));
    expect(after).toBeGreaterThan(before);
    await expect
      .poll(async () => (await page.locator(EDITOR).boundingBox())!.width)
      .toBeGreaterThan(0);
  });
});

/**
 * Markdown mode hides the preview but does NOT stop feeding it: every keystroke still
 * runs the full pipeline into #canvas. Paged.js places breaks by measuring real
 * element heights, so the pane has to stay laid out even while invisible — under a
 * `display: none` ancestor every box measures zero and the run paginates wrongly.
 */
test.describe("split workspace: the hidden preview stays measurable", () => {
  test("the canvas keeps its real box in Markdown mode", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Markdown" }).click();
    await expect(page.locator(WORKSPACE)).toHaveAttribute("data-view-mode", "editor");
    await expect(page.locator("#canvas")).toBeHidden();

    const box = await page.locator("#canvas").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, display: getComputedStyle(el).display };
    });
    // Invisible, but still a laid-out box Paged.js can measure against.
    expect(box.display).not.toBe("none");
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
  });

  test("typing in Markdown mode paginates correctly, and Preview shows that result", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Markdown" }).click();

    await page
      .locator(INPUT)
      .fill("# Written blind\n\nParagraph one.\n\n```ts\nconst x: number = 1;\n```\n");
    const count = await waitForPagination(page);
    expect(count).toBeGreaterThan(0);

    // Sheets must have real height — the symptom of measuring under display:none.
    const heights = await page
      .locator("#paged-output .pagedjs_page")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBeGreaterThan(100);

    await page.getByRole("button", { name: "Preview", exact: true }).click();
    expect(await firstPageText(page)).toContain("Written blind");
    expect(await firstPageText(page)).toContain("const x");
  });
});

/**
 * Once the source overflows, a platform with layout-consuming scrollbars would narrow
 * only the `overflow: auto` textarea's content box; the two layers would then soft-wrap
 * at different characters and the colors would slide sideways off the caret.
 */
test.describe("split workspace: the two layers wrap identically", () => {
  test("the backdrop and the textarea keep one content width when scrolling", async ({
    page,
  }) => {
    await page.goto("/");
    const long = Array.from(
      { length: 200 },
      (_, i) => `- item ${i} with enough words on the line to be worth wrapping in a narrow pane`,
    ).join("\n");
    await page.locator(INPUT).fill(long);
    await expect(page.locator(EDITOR)).toHaveAttribute("data-highlight", "on", {
      timeout: 10_000,
    });

    const widths = await page.evaluate(() => {
      const input = document.querySelector<HTMLTextAreaElement>("#editor-input")!;
      const highlight = document.querySelector<HTMLElement>("#editor-highlight")!;
      return {
        overflowing: input.scrollHeight > input.clientHeight,
        inputClient: input.clientWidth,
        highlightClient: highlight.clientWidth,
      };
    });

    expect(widths.overflowing).toBe(true);
    expect(widths.highlightClient).toBe(widths.inputClient);
  });
});

test.describe("split workspace: the editing surface never reaches paper", () => {
  /**
   * The toolbar — and its Print action — is available in every view mode. Printing
   * from Markdown mode must still emit the sheets: the rule that hides the preview on
   * screen has to be undone for print, or the export is a blank PDF.
   */
  test("printing from Markdown mode still emits the page sheets", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, "# Printed blind\n\nThis must reach paper.");
    await waitForPagination(page);

    await page.getByRole("button", { name: "Markdown" }).click();
    await expect(page.locator("#canvas")).toBeHidden();

    await page.emulateMedia({ media: "print" });
    await expect(page.locator("#canvas")).toBeVisible();
    const sheet = page.locator("#paged-output .pagedjs_page").first();
    await expect(sheet).toBeVisible();
    expect(await sheet.innerText()).toContain("Printed blind");
    // ...and the editing surface still does not.
    await expect(page.locator(EDITOR)).toBeHidden();
    await expect(page.locator(HANDLE)).toBeHidden();

    await page.emulateMedia({ media: "screen" });
  });

  test("print media hides the source pane and the divider, keeping the sheets", async ({
    page,
  }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, "# Printed\n\nOnly the sheets should survive.");
    await waitForPagination(page);
    await expect(page.locator(EDITOR)).toBeVisible();

    // The primary export is window.print() over this very document, so the print
    // stylesheet is the only thing keeping a textarea off the exported PDF.
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(EDITOR)).toBeHidden();
    await expect(page.locator(HANDLE)).toBeHidden();
    await expect(page.locator("#toolbar")).toBeHidden();
    await expect(page.locator("#paged-output .pagedjs_page").first()).toBeVisible();

    await page.emulateMedia({ media: "screen" });
    await expect(page.locator(EDITOR)).toBeVisible();
  });
});
