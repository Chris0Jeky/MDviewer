import type { Page } from "@playwright/test";
import { test, expect, readyReader } from "./helpers";

/**
 * The Library panel against a faked Windows host (S4 panel). The fake keeps the library in page
 * memory and answers the same commands as `src-tauri/src/commands/library.rs`; ids are opaque and
 * the webview never sends a path. Native bounds and the store live in the Rust tests.
 */
interface Fake { calls: Array<[string, unknown]> }
declare global { interface Window { __fake: Fake } }

async function fakeHost(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const entry = (id: string, name: string, dir: string) => ({ id, name, dir, path: `${dir}\\${name}`, at: 1 });
    const state = {
      recent: [entry("r1", "notes.md", "C:\\work\\board"), entry("r2", "plan.md", "C:\\work\\board")],
      pinned: [] as ReturnType<typeof entry>[],
      projects: [{ ...entry("p1", "board", "C:\\work"), path: "C:\\work\\board" }],
      seen: new Set<string>(),
    };
    const files = () => [
      { id: "f1", name: "CLAUDE.md", relative: "CLAUDE.md", path: "C:\\work\\board\\CLAUDE.md", modified: 10, agent: true },
      { id: "f2", name: "todo.md", relative: "docs\\todo.md", path: "C:\\work\\board\\docs\\todo.md", modified: 30, agent: false },
      { id: "f3", name: "old.md", relative: "old.md", path: "C:\\work\\board\\old.md", modified: 5, agent: false },
    ].map(file => ({ ...file, unseen: file.id !== "f3" && !state.seen.has(file.id) }));
    const texts: Record<string, [string, string]> = {
      r1: ["notes.md", "# Notes\n\nRecent file.\n"], r2: ["plan.md", "# Plan\n\nAnother.\n"], f2: ["todo.md", "# Todo\n\nChanged.\n"],
    };
    const fake: Fake = { calls: [] };
    window.__fake = fake;
    let callback = 0;
    const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
      take_pending_files: () => ({ documents: [], errors: [], canceled: false }),
      session_restore: () => ({ documents: [], errors: [], canceled: false }),
      library_list: () => ({ recent: state.recent, pinned: state.pinned, projects: state.projects }),
      library_scan: () => ({ files: files(), truncated: false }),
      library_open: ({ id }) => {
        const [name, text] = texts[id as string] ?? ["missing.md", "# Missing\n"];
        state.seen.add(id as string);
        return { documents: [{ name, text, bytes: text.length, token: `${id as string}`.padEnd(32, "0"), path: `C:\\work\\board\\${name}`, dir: "C:\\work\\board", encoding: "utf-8", eol: "lf" }], errors: [], canceled: false };
      },
      library_pin: ({ id }) => {
        const found = state.recent.find(item => item.id === id);
        if (!found) return false;
        if (!state.pinned.some(item => item.id === id)) state.pinned.push(found);
        return true;
      },
      library_unpin: ({ id }) => {
        state.pinned = state.pinned.filter(item => item.id !== id);
        state.projects = state.projects.filter(item => item.id !== id);
      },
      library_forget: ({ id }) => { state.recent = state.recent.filter(item => item.id !== id); },
      library_mark_seen: ({ id }) => { state.seen.add(id as string); },
      library_clear: () => { state.recent = []; state.pinned = []; state.projects = []; },
      "plugin:event|listen": () => ++callback,
    };
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
        transformCallback: () => ++callback,
        convertFileSrc: (path: string) => path,
        invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
          fake.calls.push([cmd, args]);
          const handler = handlers[cmd];
          return handler ? handler(args) : null;
        },
      },
    });
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

  // Remove from Recent.
  await recent.getByRole("button", { name: "Remove plan.md from Recent" }).click();
  await expect(recent.getByRole("button", { name: /^plan\.md/ })).toHaveCount(0);

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
  expect(await scans()).toBe(0);
  await activity.getByRole("button", { name: "Changed since you looked" }).click();
  await expect(activity.getByRole("button", { name: "Changed since you looked" })).toHaveAttribute("aria-expanded", "true");
  await expect(activity.locator(".shell-library-name")).toHaveText(["todo.md", "CLAUDE.md"]);
  await expect(activity.getByRole("img", { name: "Changed on disk since you last viewed it" })).toHaveCount(2);

  await projects.getByRole("button", { name: "board", exact: true }).click();
  await expect(projects.getByRole("heading", { name: "Agent files" })).toBeVisible();
  await expect(projects.getByRole("heading", { name: "Changed since you looked" })).toBeVisible();
  await expect(projects.locator(".shell-library-name")).toHaveText(["CLAUDE.md", "todo.md"]);

  // Mark all as seen clears the changed marks here and in Activity.
  await projects.getByRole("button", { name: "Mark all as seen" }).click();
  await expect(projects.getByRole("heading", { name: "Changed since you looked" })).toHaveCount(0);
  await expect(projects.getByRole("img", { name: "Changed on disk since you last viewed it" })).toHaveCount(0);
  await expect(activity.getByRole("listitem")).toHaveCount(0);

  // Remove the project.
  await projects.getByRole("button", { name: "Remove project board" }).click();
  await expect(projects.getByRole("listitem")).toHaveCount(0);
});

test("Clear library asks first and empties every section", async ({ page }) => {
  await openLibrary(page);
  const recent = panel(page).locator("section", { has: page.getByRole("heading", { name: "Recent" }) });
  page.once("dialog", dialog => void dialog.dismiss());
  await page.keyboard.press("Control+K");
  await page.keyboard.type("Clear library");
  await page.keyboard.press("Enter");
  await expect(recent.getByRole("listitem")).toHaveCount(2);
  page.once("dialog", dialog => void dialog.accept());
  await page.keyboard.press("Control+K");
  await page.keyboard.type("Clear library");
  await page.keyboard.press("Enter");
  await expect(recent.getByRole("listitem")).toHaveCount(0);
  await expect(panel(page).getByRole("listitem")).toHaveCount(0);
});
