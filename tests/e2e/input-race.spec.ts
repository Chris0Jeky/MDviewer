import { expect, test } from "@playwright/test";

test("late file reads preserve the newer editor's focus, selection and native undo", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== "old.md" && this.name !== "new.md") return original.call(this);
      const name = this.name;
      return new Promise<string>((resolve) => {
        window.addEventListener(`read-${name}`, () => resolve(name === "old.md" ? "Old document" : "New document"), { once: true });
      });
    };
    const transfer = new DataTransfer();
    transfer.items.add(new File(["old"], "old.md", { type: "text/markdown" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, cancelable: true }));
    const newer = new DataTransfer();
    newer.items.add(new File(["new"], "new.md", { type: "text/markdown" }));
    const input = document.querySelector<HTMLInputElement>("#file-input")!;
    input.files = newer.files;
    input.dispatchEvent(new Event("change"));
    window.dispatchEvent(new Event("read-new.md"));
  });
  const editor = page.locator("#editor-input");
  await expect(editor).toHaveValue("New document");
  const switcher = page.getByRole("combobox", { name: "Active document" });
  const activeId = await switcher.inputValue();
  await editor.focus();
  await editor.press("Control+End");
  await editor.pressSequentially("!");
  await editor.evaluate((input: HTMLTextAreaElement) => input.setSelectionRange(2, 6, "backward"));
  await page.evaluate(() => window.dispatchEvent(new Event("read-old.md")));
  await expect(switcher.locator("option")).toHaveText(["new.md", "old.md"]);
  await expect(switcher).toHaveValue(activeId);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("New document!");
  expect(await editor.evaluate((input: HTMLTextAreaElement) => [input.selectionStart, input.selectionEnd, input.selectionDirection]))
    .toEqual([2, 6, "backward"]);
  await editor.press("Control+z");
  await expect(editor).toHaveValue("New document");
  await switcher.selectOption({ label: "old.md" });
  await expect(editor).toHaveValue("Old document");
  await switcher.selectOption(activeId);
  await expect(editor).toHaveValue("New document");
});
