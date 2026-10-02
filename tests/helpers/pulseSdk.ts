import { createRequire } from "node:module";

type Realm = Window & typeof globalThis;
type PrivacySignals = { webdriver?: boolean; globalPrivacyControl?: boolean; doNotTrack?: string };
type Consent = { counts: boolean; diagnostics: boolean; journeys: boolean; blocked: boolean };
type Api = {
  route(name: string): boolean;
  count(name: string): boolean;
  track(name: string, props: Record<string, unknown>): boolean;
  consent: { get(): Consent; set(choice: Omit<Consent, "blocked">): Consent; open(): boolean };
};
export type Egress = { sink: string; url: string };
export type SdkRun = { calls: Egress[]; consent: Consent; accepted: boolean[]; errors: unknown[] };

// jsdom is already a dev dependency but publishes no TS declarations. Keep the
// typed boundary here rather than introducing a dependency just for this test.
const { JSDOM, requestInterceptor, VirtualConsole } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => { window: Realm };
  requestInterceptor: (callback: (request: Request) => Response) => unknown;
  VirtualConsole: new () => { on(event: string, listener: (error: unknown) => void): void };
};

const RESOURCE_ATTRIBUTES: Record<string, string[]> = {
  IMG: ["src", "srcset"], SCRIPT: ["src"], LINK: ["href"], IFRAME: ["src"],
  SOURCE: ["src", "srcset"], VIDEO: ["src", "poster"], AUDIO: ["src"],
  OBJECT: ["data"], EMBED: ["src"], INPUT: ["src"],
};

/** Execute the real generated IIFE in a disposable browser realm. Intercepted APIs
 * return synthetic responses and the resource dispatcher fails closed. Observe
 * resource references even when jsdom doesn't load them (notably parsed images). */
export async function runSdk(source: string, signals: PrivacySignals = {}, priorConsent = false): Promise<SdkRun> {
  const calls: Egress[] = [];
  const errors: unknown[] = [];
  const record = (sink: string, url: unknown) => { calls.push({ sink, url: String(url) }); };
  const console = new VirtualConsole();
  console.on("jsdomError", error => errors.push(error));
  const dom = new JSDOM('<!doctype html><html><body><div data-pulseboard-bar></div><div data-pulseboard-slot></div></body></html>', {
    url: "https://mdviewer-c9r.pages.dev/", runScripts: "outside-only",
    resources: {
      interceptors: [requestInterceptor(request => {
        record("resource", request.url);
        return new Response("", { headers: { "Content-Type": "text/css" } });
      })],
      // Fail closed if jsdom ever bypasses the interceptor.
      dispatcher: { dispatch() { throw new Error("Unintercepted jsdom resource request"); } },
    }, virtualConsole: console,
  });
  const realm = dom.window;
  let resourceObserver: MutationObserver | undefined;
  try {
    for (const [name, value] of Object.entries({ webdriver: false, globalPrivacyControl: false, doNotTrack: "0", ...signals })) {
      Object.defineProperty(realm.navigator, name, { configurable: true, value });
    }
    if (priorConsent) realm.localStorage.setItem("pulseboard:consent:v3:mdviewer", JSON.stringify({
      counts: true, diagnostics: true, journeys: true, decided: true, month: "2026-10",
    }));

    // A bounded, deterministic clock drives queued sends and timeout callbacks.
    let clock = 0, timerId = 0;
    const timers = new Map<number, { due: number; fn: () => void }>();
    Object.defineProperty(realm, "setTimeout", { value: (fn: () => void, delay = 0) => {
      const id = ++timerId; timers.set(id, { due: clock + delay, fn }); return id;
    } });
    Object.defineProperty(realm, "clearTimeout", { value: (id: number) => timers.delete(id) });
    const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    const advance = async (ms: number) => {
      const end = clock + ms;
      for (let steps = 0; steps < 100; steps++) {
        const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) { clock = end; return; }
        timers.delete(next[0]); clock = next[1].due; next[1].fn(); await settle();
      }
      throw new Error("SDK timer loop exceeded the test's bound");
    };

    Object.defineProperty(realm, "fetch", { value: async (url: unknown) => {
      record("fetch", url);
      // Successful synthetic hint enables the product lane in the active control.
      return { ok: true, json: async () => ({ v: 1, region: "other" }) };
    } });
    Object.defineProperty(realm.navigator, "sendBeacon", { value: (url: unknown) => { record("sendBeacon", url); return true; } });
    Object.defineProperty(realm, "XMLHttpRequest", { value: class {
      url = "";
      open(_method: string, url: unknown) { this.url = String(url); }
      send() { record("XMLHttpRequest", this.url); }
      setRequestHeader() {}
      abort() {}
    } });
    for (const sink of ["WebSocket", "EventSource", "Worker", "SharedWorker"]) {
      Object.defineProperty(realm, sink, { value: class { constructor(url: unknown) { record(sink, url); } close() {} terminate() {} } });
    }
    Object.defineProperty(realm, "importScripts", { value: (...urls: unknown[]) => urls.forEach(url => record("importScripts", url)) });

    // Capture both property writes (including new Image) and setAttribute. The
    // resource loader additionally catches innerHTML/insertAdjacentHTML links.
    const prototypes: [object, string[]][] = [
      [realm.HTMLImageElement.prototype, ["src", "srcset"]],
      [realm.HTMLScriptElement.prototype, ["src"]], [realm.HTMLLinkElement.prototype, ["href"]],
      [realm.HTMLIFrameElement.prototype, ["src"]], [realm.HTMLSourceElement.prototype, ["src", "srcset"]],
      [realm.HTMLMediaElement.prototype, ["src"]], [realm.HTMLVideoElement.prototype, ["poster"]],
      [realm.HTMLObjectElement.prototype, ["data"]], [realm.HTMLEmbedElement.prototype, ["src"]],
      [realm.HTMLInputElement.prototype, ["src"]],
    ];
    for (const [prototype, attributes] of prototypes) for (const attribute of attributes) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, attribute);
      if (!descriptor?.set) throw new Error(`Missing resource setter: ${attribute}`);
      Object.defineProperty(prototype, attribute, { ...descriptor, set(this: Element, value: string) {
        record(`${this.tagName}.${attribute}`, value); descriptor.set?.call(this, value);
      } });
    }
    const setAttribute = realm.Element.prototype.setAttribute;
    realm.Element.prototype.setAttribute = function (name, value) {
      const attribute = name.toLowerCase();
      if (RESOURCE_ATTRIBUTES[this.tagName]?.includes(attribute)) record(`${this.tagName}.setAttribute(${attribute})`, value);
      setAttribute.call(this, name, value);
    };

    // Parser-created attributes bypass JS setters. jsdom also skips image loads
    // without canvas, so the request interceptor alone cannot see these URLs.
    const inspect = (element: Element, change: "inserted" | "removed") => {
      for (const attribute of RESOURCE_ATTRIBUTES[element.tagName] ?? []) {
        const value = element.getAttribute(attribute);
        if (value) record(`${element.tagName}.${change}(${attribute})`, value);
      }
    };
    const inspectTree = (element: Element, change: "inserted" | "removed") => {
      inspect(element, change);
      element.querySelectorAll("*").forEach(child => inspect(child, change));
    };
    // Parsing into a detached element never reaches the document observer.
    // Inspect synchronously so later removal cannot erase a parsed resource.
    for (const property of ["innerHTML", "outerHTML"] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(realm.Element.prototype, property);
      if (!descriptor?.set) throw new Error(`Missing parser setter: ${property}`);
      Object.defineProperty(realm.Element.prototype, property, { ...descriptor, set(this: Element, value: string) {
        const target = property === "outerHTML" ? this.parentElement : this;
        descriptor.set?.call(this, value);
        if (target) inspectTree(target, "inserted");
      } });
    }
    const insertAdjacentHTML = realm.Element.prototype.insertAdjacentHTML;
    realm.Element.prototype.insertAdjacentHTML = function (position, text) {
      insertAdjacentHTML.call(this, position, text);
      const target = ["beforebegin", "afterend"].includes(position.toLowerCase()) ? this.parentElement : this;
      if (target) inspectTree(target, "inserted");
    };
    const inspectMutations = (mutations: MutationRecord[]) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          // A newly inserted subtree may already be empty by callback time.
          // Removed nodes retain references to resources that briefly existed.
          for (const [nodes, change] of [[mutation.addedNodes, "inserted"], [mutation.removedNodes, "removed"]] as const) {
            for (const node of nodes) if (node instanceof realm.Element) {
              inspectTree(node, change);
            }
          }
        } else if (mutation.target instanceof realm.Element && mutation.attributeName) {
          const element = mutation.target, attribute = mutation.attributeName;
          if (!RESOURCE_ATTRIBUTES[element.tagName]?.includes(attribute)) continue;
          // Preserve a URL even if code immediately changes/removes it before
          // delivery of this observer callback.
          if (mutation.oldValue) record(`${element.tagName}.previous(${attribute})`, mutation.oldValue);
          const value = element.getAttribute(attribute);
          if (value) record(`${element.tagName}.attribute(${attribute})`, value);
        }
      }
    };
    resourceObserver = new realm.MutationObserver(inspectMutations);
    resourceObserver.observe(realm.document, { childList: true, subtree: true, attributes: true, attributeOldValue: true });

    realm.eval(source);
    realm.document.dispatchEvent(new realm.Event("DOMContentLoaded"));
    await settle();
    const api = (realm as Realm & { Pulseboard: Api }).Pulseboard;
    if (!api) throw new Error("The vendored artifact did not publish Pulseboard");
    // Exercise consent overrides and every public event API, then timer and
    // lifecycle flushes. Privacy signals must win over an explicit opt-in.
    api.consent.set({ counts: true, diagnostics: true, journeys: true });
    const accepted = [api.route("editor"), api.count("export.print_requested"), api.track("doc.opened", { source: "file", sizeBucket: "<1k" })];
    api.consent.open();
    await settle();
    await advance(10_000);
    realm.document.dispatchEvent(new realm.Event("visibilitychange"));
    realm.dispatchEvent(new realm.PageTransitionEvent("pagehide", { persisted: true }));
    realm.dispatchEvent(new realm.PageTransitionEvent("pageshow", { persisted: true }));
    await advance(10_000);
    inspectMutations(resourceObserver.takeRecords());
    return { calls, consent: api.consent.get(), accepted, errors };
  } finally {
    resourceObserver?.disconnect();
    realm.close();
  }
}
