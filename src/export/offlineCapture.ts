export function captureLifecycleError(): Error {
  return new Error("The PDF capture lifecycle could not be verified. Try Print / Save as PDF.");
}

export function offlineCaptureController(document: Document): string | undefined {
  const navigator = document.defaultView?.navigator;
  if (navigator?.onLine !== false) return;
  // Packaged desktop documents may have no service-worker API. Their existing
  // capture path loads assets through the native asset protocol.
  try { return navigator.serviceWorker?.controller?.scriptURL; }
  catch { return; }
}

function stylesheetLinks(document: Document): HTMLLinkElement[] {
  return [...document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')];
}

/**
 * Chromium's initial about:blank capture frame is not service-worker controlled.
 * Prepare a controlled destination before cloning, then adopt the renderer's
 * nodes without document.open(), which would replace the document lifecycle.
 * Linked CSS loads only in this destination; its normal load/error guard still
 * decides whether the PDF can be saved. No CSS text or asset URLs are rewritten.
 */
export async function createOfflineCapture(source: Document, container: HTMLElement, controller: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const view = source.defaultView;
  if (!view) throw captureLifecycleError();
  const links = stylesheetLinks(source);
  // MDviewer's external styles belong to the app head. Reject an unsupported
  // structure instead of moving linked body CSS to a different cascade position.
  if (links.some(link => link.parentElement !== source.head || new URL(link.href, source.baseURI).origin !== view.location.origin)) {
    throw captureLifecycleError();
  }
  const linkSet = new Set<Element>(links);
  const styleOrder = () => [...source.head.children].filter(node => node.localName === "style" || linkSet.has(node));
  const sourceOrder = styleOrder();
  const sourceInline = sourceOrder.filter(node => node.localName === "style");
  if (sourceInline.some(node => node.hasAttribute("data-html2canvas-ignore"))) throw captureLifecycleError();
  let inlineBefore = 0;
  const planned = sourceOrder.flatMap(node => {
    if (node.localName === "style") { inlineBefore++; return []; }
    const link = node as HTMLLinkElement;
    return [{ source: link, html: link.outerHTML, disabled: link.disabled,
      template: link.cloneNode(false) as HTMLLinkElement, inlineBefore }];
  });
  const omitted = new Set<Element>();

  const frame = source.createElement("iframe");
  frame.className = "html2canvas-container";
  frame.style.cssText = "visibility:hidden;position:fixed;left:-10000px;top:0;border:0";
  frame.width = String(view.innerWidth);
  frame.height = String(view.innerHeight);
  frame.scrolling = "no";
  frame.srcdoc = "<!doctype html><html><head></head><body></body></html>";
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      view.clearTimeout(timeout);
      frame.removeEventListener("load", loaded);
      frame.removeEventListener("error", failed);
      signal?.removeEventListener("abort", aborted);
      if (error) reject(error); else resolve();
    };
    const loaded = () => { if (frame.contentDocument?.URL === "about:srcdoc") finish(); };
    const failed = () => finish(captureLifecycleError());
    const aborted = () => finish(signal?.reason);
    const timeout = view.setTimeout(failed, 10_000);
    signal?.addEventListener("abort", aborted, { once: true });
    frame.addEventListener("load", loaded);
    frame.addEventListener("error", failed);
    container.append(frame);
  });
  const document = frame.contentDocument;
  const validate = () => {
    if (!document || frame.contentDocument !== document || !container.contains(frame) ||
        document.URL !== "about:srcdoc" || document.defaultView?.navigator.serviceWorker?.controller?.scriptURL !== controller) {
      throw captureLifecycleError();
    }
  };
  validate();
  let adopted = false;
  return {
    frame,
    validate,
    ignoreElements(element: Element): boolean {
      if (!linkSet.has(element)) return false;
      omitted.add(element);
      return true;
    },
    adopt(clone: Document): Document {
      validate();
      const currentOrder = styleOrder();
      const currentLinks = stylesheetLinks(source);
      if (adopted || !document || omitted.size !== links.length || stylesheetLinks(clone).length !== 0 ||
          currentLinks.length !== links.length || currentLinks.some((link, i) => link !== links[i]) ||
          currentOrder.length !== sourceOrder.length || currentOrder.some((node, i) => node !== sourceOrder[i]) ||
          planned.some(plan => plan.source.outerHTML !== plan.html || plan.source.disabled !== plan.disabled)) {
        throw captureLifecycleError();
      }
      const inline = [...clone.head.querySelectorAll<HTMLStyleElement>("style")];
      if (inline.length < sourceInline.length || !clone.defaultView) throw captureLifecycleError();
      frame.width = String(clone.defaultView.innerWidth);
      frame.height = String(clone.defaultView.innerHeight);
      // Source inline styles are cloned in order. The renderer appends adopted
      // styles to head and puts pseudo-hiding styles in body. Inserting before
      // the next source style (or the first appended style) preserves all three.
      const root = document.adoptNode(clone.documentElement);
      const head = root.querySelector("head");
      if (!head) throw captureLifecycleError();
      for (const plan of planned) {
        const link = plan.template.cloneNode(false) as HTMLLinkElement;
        link.disabled = plan.disabled;
        head.insertBefore(link, inline[plan.inlineBefore] ?? null);
      }
      document.replaceChild(root, document.documentElement);
      adopted = true;
      validate();
      return document;
    },
  };
}
