import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/app/settings";

const capture = vi.hoisted(() => vi.fn(async (_page: HTMLElement, _options: unknown) => ({
  toDataURL: () => "data:image/png;base64,AAAA",
})));
vi.mock("html2canvas-pro", () => ({ default: capture }));
vi.mock("jspdf", () => ({ jsPDF: class { addImage() {} addPage() {} save() {} } }));
import { exportPaginatedToPdf } from "../src/export/download";

beforeEach(() => { capture.mockClear(); });
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

async function pendingClone() {
  const host = document.createElement("div");
  host.innerHTML = '<div class="pagedjs_page"></div>';
  document.body.append(host);
  await exportPaginatedToPdf(host, DEFAULT_SETTINGS);
  const { onclone } = capture.mock.calls[0]![1] as { onclone(doc: Document, sheet: HTMLElement): Promise<void> };
  const copy = document.implementation.createHTMLDocument("capture");
  Object.defineProperty(copy, "defaultView", { value: window, configurable: true });
  copy.head.innerHTML = '<link rel="stylesheet" href="/assets/document.css">';
  copy.body.innerHTML = '<div class="pagedjs_page" style="visibility:hidden"></div>';
  return { onclone, copy, link: copy.querySelector<HTMLLinkElement>("link")!, sheet: copy.querySelector<HTMLElement>(".pagedjs_page")! };
}

it("waits for cloned CSS and the fonts it introduces before allowing capture", async () => {
  const { onclone, copy, link, sheet } = await pendingClone();
  let releaseFonts!: () => void;
  Object.defineProperty(copy, "fonts", { value: { ready: new Promise<void>(resolve => { releaseFonts = resolve; }) } });
  let complete = false;
  const pending = onclone(copy, sheet).then(() => { complete = true; });
  await Promise.resolve();
  expect(complete).toBe(false);
  expect(sheet.style.visibility).toBe("hidden");
  Object.defineProperty(link, "sheet", { value: {} });
  link.dispatchEvent(new Event("load"));
  await Promise.resolve();
  await Promise.resolve();
  expect(complete).toBe(false);
  releaseFonts();
  await pending;
  expect(complete).toBe(true);
  expect(sheet.style.visibility).toBe("visible");
});

it.each(["error", "timeout"])("rejects a cloned stylesheet %s and releases the failed capture", async mode => {
  vi.useFakeTimers();
  const { onclone, copy, link, sheet } = await pendingClone();
  const second = copy.createElement("link");
  second.rel = "stylesheet";
  second.href = "/assets/workspace.css";
  copy.head.append(second);
  const frame = document.createElement("iframe");
  document.body.append(frame);
  // A real capture document's defaultView owns its iframe. Use that relationship
  // here without allowing the test environment to perform stylesheet requests.
  Object.defineProperty(copy, "defaultView", { value: { frameElement: frame } });
  const rejected = expect(onclone(copy, sheet)).rejects.toThrow("stylesheet could not load. Try Print / Save as PDF.");
  if (mode === "error") link.dispatchEvent(new Event("error"));
  else await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  expect(sheet.style.visibility).toBe("hidden");
  expect(frame.isConnected).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("gives fonts only the remaining readiness budget and releases a timed-out capture", async () => {
  vi.useFakeTimers();
  const { onclone, copy, link, sheet } = await pendingClone();
  const frame = document.createElement("iframe");
  document.body.append(frame);
  Object.defineProperty(copy, "defaultView", { value: frame.contentWindow });
  Object.defineProperty(copy, "fonts", { value: { ready: new Promise<void>(() => {}) } });
  const rejected = expect(onclone(copy, sheet)).rejects.toThrow("fonts did not finish loading. Try Print / Save as PDF.");
  await vi.advanceTimersByTimeAsync(9_000);
  Object.defineProperty(link, "sheet", { value: {} });
  link.dispatchEvent(new Event("load"));
  await vi.advanceTimersByTimeAsync(999);
  expect(frame.isConnected).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  expect(frame.isConnected).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
