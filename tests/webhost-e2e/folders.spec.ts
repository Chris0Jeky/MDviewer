import type { Page } from "@playwright/test";
import { test, expect, moreMenu, readyReader, writeFile } from "../desktop-e2e/helpers";

/**
 * A granted folder on the browser host (web parity W4), in Chromium on origin private file system
 * folders: the test-only picker override hands the app OPFS handles (`installPickers`, `__folder`).
 * Links, imports and images resolve inside the granted folder, never above it.
 */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const doc = (page: Page) => page.locator("#reader-document");

async function project(page: Page): Promise<void> {
  await writeFile(page, "proj/index.md", Buffer.from(
    "# Index\n\n[Next](docs/next.md) · [Plan](Plan) · [Agents](@AGENTS.md) · [Up](../outside.md) · [Data](rows.csv)\n\n![dot](img/dot.png)\n"));
  await writeFile(page, "proj/docs/next.md", Buffer.from("# Next\n\nBack to [index](../index.md).\n"));
  await writeFile(page, "proj/Plan.md", Buffer.from("# Plan\n"));
  await writeFile(page, "proj/AGENTS.md", Buffer.from("# Agents\n"));
  await writeFile(page, "proj/rows.csv", Buffer.from("a,b\n1,2\n"));
  await writeFile(page, "proj/img/dot.png", PNG);
  await writeFile(page, "proj/templates/Meeting notes.md", Buffer.from("# {{title}}\n\nOwner: {{owner}}\n"));
  await writeFile(page, "proj/node_modules/skip.md", Buffer.from("# Skipped\n"));
  await writeFile(page, "outside.md", Buffer.from("# Outside\n"));
}

test.describe("Chromium: a granted folder", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "File System Access API");

  test("links, imports, extensionless names, images and back/forward stay inside the granted folder", async ({ page }) => {
    await project(page);
    await page.evaluate(() => { window.__pick = ["proj/index.md"]; });
    await page.keyboard.press("Control+O");
    await readyReader(page, "Index");
    // No folder is granted yet: the image stays unloaded and a link offers the grant, once, in place.
    await expect(doc(page).locator("img")).not.toHaveAttribute("src", /^blob:/);
    await doc(page).getByRole("link", { name: "Next" }).click();
    const offer = page.locator(".am-notice");
    await expect(offer).toContainText("Choose the folder that holds this document");
    await page.evaluate(() => { window.__folder = "proj"; });
    await offer.getByRole("button", { name: "Choose folder…" }).click();
    await readyReader(page, "Next");

    // Back to the index: its image now loads from the granted folder.
    await page.keyboard.press("Alt+ArrowLeft");
    await readyReader(page, "Index");
    await expect(doc(page).locator("img")).toHaveAttribute("src", /^blob:/);
    await page.keyboard.press("Alt+ArrowRight");
    await readyReader(page, "Next");
    await page.keyboard.press("Alt+ArrowLeft");
    await readyReader(page, "Index");

    await doc(page).getByRole("link", { name: "Plan" }).click();
    await readyReader(page, "Plan");
    await page.keyboard.press("Alt+ArrowLeft");
    await readyReader(page, "Index");
    await doc(page).getByRole("link", { name: "Agents" }).click();
    await readyReader(page, "Agents");
    await page.keyboard.press("Alt+ArrowLeft");
    await readyReader(page, "Index");

    // Never above the granted folder, and links open Markdown only.
    await doc(page).getByRole("link", { name: "Up" }).click();
    await expect(page.locator("#reader-notice")).toContainText("inside the folder you chose");
    await doc(page).getByRole("link", { name: "Data" }).click();
    await expect(page.locator("#reader-notice")).toContainText("Links open Markdown documents only");
    await expect(doc(page).locator("h1")).toHaveText("Index");
  });

  test("the granted folder is a project: a bounded scan, and New from template reads its templates", async ({ page }) => {
    await project(page);
    await page.evaluate(() => { window.__folder = "proj"; });
    await page.keyboard.press("Control+K");
    await page.getByRole("combobox", { name: "Search commands and files" }).fill("Pin a project folder");
    await page.keyboard.press("Enter");
    await expect(page.locator("#reader-notice")).toContainText("Project pinned to the library.");

    await page.getByRole("button", { name: "Library and outline" }).click();
    await page.getByRole("tab", { name: "Library" }).click();
    const projects = page.locator("#shell-panel section", { has: page.getByRole("heading", { name: "Projects" }) });
    await projects.getByRole("button", { name: "proj", exact: true }).click();
    await expect(projects.getByRole("heading", { name: "Agent files" })).toBeVisible();
    // The project lists its agent files (and, with W5's seen marks, files changed since you looked).
    const names = await projects.locator(".shell-library-name").allTextContents();
    expect(names).toContain("AGENTS.md");
    expect(names).not.toContain("skip.md"); // node_modules is never walked
    await projects.getByRole("button", { name: /^AGENTS\.md/ }).click();
    await readyReader(page, "Agents");

    await moreMenu(page, "New from template…");
    const dialog = page.getByRole("dialog", { name: "New from template" });
    await dialog.getByRole("button", { name: /Meeting notes/ }).click();
    const owner = dialog.getByRole("textbox", { name: "owner" });
    await owner.fill("Ada");
    await owner.press("Enter");
    await expect(page.locator("#reader-edit #editor-input")).toHaveValue("# Meeting notes\n\nOwner: Ada\n");
  });
});
