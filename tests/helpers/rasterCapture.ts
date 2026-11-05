/** Model 2.6's synchronous iframe mount followed by an asynchronous onclone. */
export interface RasterCaptureOptions {
  iframeContainer?: HTMLElement | ShadowRoot;
  onclone(document: Document, sheet: HTMLElement): Promise<void>;
}

export function mountRasterClone(page: HTMLElement, options: unknown) {
  const captureOptions = options as RasterCaptureOptions;
  const frame = page.ownerDocument.createElement("iframe");
  frame.className = "html2canvas-container";
  (captureOptions.iframeContainer ?? page.ownerDocument.body).append(frame);
  const copy = frame.contentDocument!;
  copy.body.innerHTML = page.outerHTML;
  const sheet = copy.querySelector<HTMLElement>(".pagedjs_page")!;
  return { frame, copy, sheet, options: captureOptions };
}

export type RasterClone = ReturnType<typeof mountRasterClone>;

export const rasterCanvas = {
  toDataURL: (_type?: string) => "data:image/png;base64,AAAA" as const,
  width: 800,
  height: 1131,
};

export async function simulateRasterCapture(
  page: HTMLElement,
  options: unknown,
  configure?: (clone: RasterClone) => void | Promise<void>,
) {
  const clone = mountRasterClone(page, options);
  // Always yield once, even without setup: resource events and onclone cannot
  // run in html2canvas's synchronous mount call in a real browser.
  await configure?.(clone);
  clone.sheet = clone.copy.querySelector<HTMLElement>(".pagedjs_page")!;
  await clone.options.onclone(clone.copy, clone.sheet);
  clone.frame.remove();
  return rasterCanvas;
}
