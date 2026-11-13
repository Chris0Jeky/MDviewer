import type { Page } from "@playwright/test";
import { installFakeHost, fakeEntry, fakeCalls } from "./fakeHost";
import { test, expect, readyReader } from "./helpers";

/**
 * The Library panel against the shared faked Windows host (S4 panel; `fakeHost.ts`). The fake keeps
 * the library in page memory and answers the same commands as `src-tauri/src/commands/library.rs`;
 * ids are opaque and the webview never sends a path. Native bounds and the store live in the Rust tests.
 */
async function fakeHost(page: Page): Promise<void> {
  await installFakeHost(page, {
    recent: [fakeEntry("r1", "notes.md", "C:\\work\\board"), fakeEntry("r2", "plan.md", "C:\\work\\board")],
    projects: [
      { ...fakeEntry("p1", "board", "C:\\work"), path: "C:\\work\\board" },
      { ...fakeEntry("p2", "gone", "C:\\work"), path: "C:\\work\\gone" },
    ],
    scans: {
      p1: [
        { id: "f1", name: "CLAUDE.md", relative: "CLAUDE.md", path: "C:\\work\\board\\CLAUDE.md", modified: 10, agent: true },
        { id: "f2", name: "todo.md", relative: "docs\\todo.md", path: "C:\\work\\board\\docs\\todo.md", modified: 30, agent: false },
        { id: "f3", name: "old.md", relative: "old.md", path: "C:\\work\\board\\old.md", modified: 5, agent: false, seen: true },
        { id: "t1", name: "Meeting notes.md", relative: "templates\\Meeting notes.md", path: "C:\\work\\board\\templates\\Meeting notes.md", modified: 1, agent: false, seen: true },
      ],
    },
    texts: { r1: ["notes.md", "# Notes\n\nRecent file.\n"], r2: ["plan.md", "# Plan\n\nAnother.\n"], f2: ["todo.md", "# Todo\n\nChanged.\n"] },
    templates: { t1: ["Meeting notes.md", "# {{title}}\n\nOwner: {{owner}}\nOn {{date}}\n"] },
  });
}

const panel = (page: Page) => page.locator("#shell-panel");

async function openLibrary(page: Page): Promise<void> {
  await page.goto("/desktop.html");
  await page.getByRole("button", { name: "Library and outline" }).click();
  await page.getByRole("tab", { name: "Library" }).click();
  await expect(panel(page).getByRole("heading", { name: "Recent" })).toBeVisible();
}

test.beforeEach(async ({ page }) => { await fakeHost(page); });

test("the library opens, pins, unpins and removes entries by id only", async ({ page }) => {
  await openLibrary(page);
  const recent = panel(page).locator("section", { has: page.getByRole("heading", { name: "Recent" }) });
  const pinned = panel(page).locator("section", { has: page.getByRole("heading", { name: "Pinned" }) });
  await expect(recent.getByRole("button", { name: /^notes\.md/ })).toBeVisible();

  // Open a recent file: it opens through its id and shows in the reader.
  await recent.getByRole("button", { name: /^notes\.md/ }).click();
  await readyReader(page, "Notes");

  // Pin from Recent, then unpin from Pinned.
  await recent.getByRole("button", { name: "Pin notes.md" }).click();
  await expect(pinned.getByRole("button", { name: /^notes\.md/ })).toBeVisible();
  await expect(recent.getByRole("button", { name: "Pin notes.md" })).toHaveCount(0);
  await pinned.getByRole("button", { name: "Unpin notes.md" }).click();
  await expect(pinned.getByRole("listitem")).toHaveCount(0);

  // Remove from Recent: announced, and focus moves to the section rather than the page.
  await recent.getByRole("button", { name: "Remove plan.md from Recent" }).click();
  await expect(recent.getByRole("button", { name: /^plan\.md/ })).toHaveCount(0);
  await expect(panel(page).getByRole("status")).toHaveText("Removed plan.md from Recent.");
  await expect(recent.getByRole("heading", { name: "Recent" })).toBeFocused();

  // The webview sent ids, never paths.
  const sent = await page.evaluate(() => window.__fake.calls.filter(([cmd]) => cmd.startsWith("library_")).map(([, args]) => JSON.stringify(args)));
  expect(sent.join(" ")).not.toContain("C:\\\\");
});

test("projects show agent files, changes since you looked and activity across projects", async ({ page }) => {
  await openLibrary(page);
  const projects = panel(page).locator("section", { has: page.getByRole("heading", { name: "Projects" }) });
  const activity = panel(page).locator("section", { has: page.getByRole("heading", { name: "Activity" }) });

  // Activity scans only when shown, and lists changed files newest first.
  const scans = () => page.evaluate(() => window.__fake.calls.filter(([cmd]) => cmd === "library_scan").length);
  await expect(projects.getByRole("button", { name: "Remove project board" })).toBeVisible(); // the library has loaded
  expect(await scans()).toBe(0);
  await activity.getByRole("button", { name: "Changed since you looked" }).click();
  await expect(activity.getByRole("button", { name: "Changed since you looked" })).toHaveAttribute("aria-expanded", "true");
  await expect(activity.locator(".shell-library-name")).toHaveText(["todo.md", "CLAUDE.md"]);
  await expect(activity.getByRole("img", { name: "Changed on disk since you last viewed it" })).toHaveCount(2);
  await expect(activity.getByText("1 project could not be read.")).toBeVisible();

  await projects.getByRole("button", { name: "board", exact: true }).click();
  await expect(projects.getByRole("heading", { name: "Agent files" })).toBeVisible();
  await expect(projects.getByRole("heading", { name: "Changed since you looked" })).toBeVisible();
  await expect(projects.locator(".shell-library-name")).toHaveText(["CLAUDE.md", "todo.md"]);

  // The project stays expanded when the library re-reads (here, after a pin).
  const recent = panel(page).locator("section", { has: page.getByRole("heading", { name: "Recent" }) });
  await recent.getByRole("button", { name: "Pin notes.md" }).click();
  await expect(panel(page).getByRole("status")).toHaveText("Pinned notes.md.");
  await expect(projects.getByRole("button", { name: "board", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(projects.getByRole("heading", { name: "Agent files" })).toBeVisible();

  // Mark all as seen clears the changed marks here and in Activity.
  await projects.getByRole("button", { name: "Mark all as seen" }).click();
  await expect(projects.getByRole("heading", { name: "Changed since you looked" })).toHaveCount(0);
  await expect(projects.getByRole("img", { name: "Changed on disk since you last viewed it" })).toHaveCount(0);
  await expect(panel(page).getByRole("status")).toHaveText("Marked 2 files in board as seen.");
  await expect(activity.getByRole("button")).toHaveCount(1); // only the section toggle: no changed file remains
  await expect(activity.getByText("1 project could not be read.")).toBeVisible();

  // Remove the project.
  await projects.getByRole("button", { name: "Remove project board" }).click();
  await expect(projects.getByRole("button", { name: "board", exact: true })).toHaveCount(0);
  await expect(projects.getByRole("button", { name: "gone", exact: true })).toBeVisible();

  // Hidden behind the Outline tab, the library neither re-reads nor scans; it catches up when shown.
  await page.getByRole("tab", { name: "Outline" }).click();
  const before = await scans();
  const lists = () => page.evaluate(() => window.__fake.calls.filter(([cmd]) => cmd === "library_list").length);
  const listed = await lists();
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("mdviewer:library-changed")); });
  await page.waitForTimeout(300); // nothing should happen; give it the chance to
  expect([await scans(), await lists()]).toEqual([before, listed]);
  await page.getByRole("tab", { name: "Library" }).click();
  await expect.poll(lists).toBeGreaterThan(listed);
});

test("Clear library asks first and empties every section", async ({ page }) => {
  await openLibrary(page);
  const recent = panel(page).locator("section", { has: page.getByRole("heading", { name: "Recent" }) });
  await expect(recent.getByRole("listitem")).toHaveCount(2);
  const clear = async (answer: "accept" | "dismiss"): Promise<void> => {
    // Answer from the listener: window.confirm blocks the page until it is handled.
    const asked = new Promise<string>(resolve => page.once("dialog", dialog => { resolve(dialog.message()); void dialog[answer](); }));
    await page.keyboard.press("Control+K");
    await page.getByRole("combobox", { name: "Search commands and files" }).fill("Clear library");
    await page.keyboard.press("Enter");
    expect(await asked).toContain("No file is deleted.");
  };
  await clear("dismiss");
  await expect(recent.getByRole("listitem")).toHaveCount(2);
  await clear("accept");
  await expect(recent.getByRole("listitem")).toHaveCount(0);
  await expect(panel(page).getByRole("listitem")).toHaveCount(0);
});

test("New from template reads the template without opening it and starts a filled note in Edit", async ({ page }) => {
  await page.goto("/desktop.html");
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menu", { name: "More" }).getByText("New from template…", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New from template" });
  await dialog.getByRole("button", { name: /Meeting notes/ }).click();
  const owner = dialog.getByRole("textbox", { name: "owner" });
  await expect(owner).toBeFocused();
  await owner.fill("Ada {{date}}"); // a typed value stays text
  await owner.press("Enter");
  await expect(dialog).toHaveCount(0);
  const edit = page.locator("#reader-edit #editor-input");
  await expect(edit).toBeFocused();
  await expect(edit).toHaveValue(/^# Meeting notes\n\nOwner: Ada \{\{date\}\}\nOn \d{4}-\d{2}-\d{2}\n$/);
  await expect(page.locator("#reader-document h1")).toHaveText("Meeting notes");
  await expect(page.locator('#shell-tabs [role="tab"]')).toHaveText(["Untitled.md, unsaved changes"]);
  // Read-only: no open, no Recent entry, no seen mark.
  const calls = await fakeCalls(page);
  expect(calls).toContain("library_read_template");
  expect(calls).not.toContain("library_open");
  expect(calls).not.toContain("library_mark_seen");
});
