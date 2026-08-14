import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { lazy, loadScriptOnEvent, loadStylesheet } from "./lazy";

// Polyfill the browser-only `CSS.escape` for the Bun test runtime (per the CSSOM spec algorithm).
const cssGlobal = globalThis as unknown as { CSS?: { escape: (value: string) => string } };
if (typeof cssGlobal.CSS === "undefined") {
  cssGlobal.CSS = {
    escape(value: string): string {
      const string = String(value);
      const length = string.length;
      const firstCodeUnit = string.charCodeAt(0);
      let result = "";
      for (let index = 0; index < length; index++) {
        const codeUnit = string.charCodeAt(index);
        if (codeUnit === 0x0000) {
          result += "�";
          continue;
        }
        if (
          (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
          codeUnit === 0x007f ||
          (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
          (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002d)
        ) {
          result += `\\${codeUnit.toString(16)} `;
          continue;
        }
        if (index === 0 && length === 1 && codeUnit === 0x002d) {
          result += `\\${string.charAt(index)}`;
          continue;
        }
        if (
          codeUnit >= 0x0080 ||
          codeUnit === 0x002d ||
          codeUnit === 0x005f ||
          (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
          (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
          (codeUnit >= 0x0061 && codeUnit <= 0x007a)
        ) {
          result += string.charAt(index);
          continue;
        }
        result += `\\${string.charAt(index)}`;
      }
      return result;
    },
  };
}

/** The platform's own timer functions, captured before any block replaces them. The `lazy` block
 *  stubs `setTimeout` to capture the retry delay instead of running it, and `flush` below must keep
 *  draining against the real clock regardless. */
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

/** Drain the microtask queue so every promise chain that can settle has settled. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => realSetTimeout(resolve, 0));
}

interface MockObserver {
  observe: (el: Element) => void;
  disconnect: () => void;
}

type ObserverConstructor = new (callback: IntersectionObserverCallback, options?: IntersectionObserverInit) => MockObserver;

interface LazyGlobalMock {
  document: { querySelector: (selector: string) => Element | null; defaultView: typeof globalThis };
  IntersectionObserver: ObserverConstructor;
}

const lg = globalThis as unknown as LazyGlobalMock;

/** The delay `lazy` schedules its retry on, spelled out because the module constant is not exported. */
const RETRY_DELAY_MS = 500;

describe("lazy", () => {
  let mockElement: Element;
  let capturedCallback: IntersectionObserverCallback;
  let capturedOptions: IntersectionObserverInit | undefined;
  let observedElements: Element[];
  let disconnectCount: number;
  let observing: boolean;
  let capturedTimer: { fn: () => void; ms: number } | undefined;

  beforeEach(() => {
    mockElement = {} as Element;
    observedElements = [];
    disconnectCount = 0;
    observing = false;
    capturedOptions = undefined;
    capturedTimer = undefined;

    // `defaultView` is what makes the stubbed clock reachable: `ownerWindow` resolves through the
    // owner document, and the bare `window` fallback does not exist in the Bun test runtime.
    lg.document = { querySelector: (selector: string) => (selector === "[data-ref='target']" ? mockElement : null), defaultView: globalThis };

    // @ts-expect-error — intentionally replacing the global timer for test isolation
    globalThis.setTimeout = (fn: () => void, ms: number) => {
      capturedTimer = { fn, ms };
      return 1;
    };

    // biome-ignore lint/complexity/useArrowFunction: arrow functions cannot be constructed with `new`
    lg.IntersectionObserver = function (callback: IntersectionObserverCallback, options?: IntersectionObserverInit): MockObserver {
      capturedCallback = callback;
      capturedOptions = options;
      return {
        observe: (el: Element) => {
          observing = true;
          observedElements.push(el);
        },
        disconnect: () => {
          observing = false;
          disconnectCount++;
        },
      };
    } as unknown as ObserverConstructor;
  });

  afterEach(() => {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  });

  function makeEntry(isIntersecting: boolean): IntersectionObserverEntry {
    return { isIntersecting } as IntersectionObserverEntry;
  }

  /** Run the pending retry timer, as the platform would once the delay elapsed. */
  function elapseRetryDelay(): void {
    const timer = capturedTimer;
    capturedTimer = undefined;
    timer?.fn();
  }

  /** An intersection the platform would actually deliver: the real observer only calls back for an
   * element it is currently observing. */
  function intersect(): void {
    if (observing) capturedCallback([makeEntry(true)], {} as IntersectionObserver);
  }

  it("observes the element matching the data-ref", () => {
    lazy({ ref: "target", load: () => Promise.resolve({}), init: () => {} });
    expect(observedElements).toHaveLength(1);
    expect(observedElements[0]).toBe(mockElement);
  });

  it("calls load and then init when the element intersects", async () => {
    const mod = { doThing: () => {} };
    let initMod: unknown = null;
    let initEl: unknown = null;

    lazy({
      ref: "target",
      load: () => Promise.resolve(mod),
      init: (m, el) => {
        initMod = m;
        initEl = el;
      },
    });

    capturedCallback([makeEntry(true)], {} as IntersectionObserver);
    await Promise.resolve();

    expect(initMod).toBe(mod);
    expect(initEl).toBe(mockElement);
  });

  it("passes the trigger element to init", async () => {
    let receivedEl: Element | null = null;
    lazy({
      ref: "target",
      load: () => Promise.resolve({}),
      init: (_m, el) => {
        receivedEl = el;
      },
    });
    capturedCallback([makeEntry(true)], {} as IntersectionObserver);
    await Promise.resolve();
    expect(receivedEl).toBe(mockElement);
  });

  it("disconnects after the first intersection", () => {
    lazy({ ref: "target", load: () => Promise.resolve({}), init: () => {} });
    expect(disconnectCount).toBe(0);
    capturedCallback([makeEntry(true)], {} as IntersectionObserver);
    expect(disconnectCount).toBe(1);
  });

  it("returns a noop dispose function when element is not found", () => {
    lg.document.querySelector = () => null;
    const dispose = lazy({ ref: "missing", load: () => Promise.resolve({}), init: () => {} });
    expect(observedElements).toHaveLength(0);
    expect(() => dispose()).not.toThrow();
  });

  it("passes rootMargin to the IntersectionObserver constructor", () => {
    lazy({ ref: "target", rootMargin: "200px", load: () => Promise.resolve({}), init: () => {} });
    expect(capturedOptions?.rootMargin).toBe("200px");
  });

  it("passes threshold to the IntersectionObserver constructor", () => {
    lazy({ ref: "target", threshold: 0.5, load: () => Promise.resolve({}), init: () => {} });
    expect(capturedOptions?.threshold).toBe(0.5);
  });

  it("dispose disconnects the observer before intersection occurs", () => {
    const dispose = lazy({ ref: "target", load: () => Promise.resolve({}), init: () => {} });
    dispose();
    expect(disconnectCount).toBe(1);
  });

  it("does not call init when entry is not intersecting", async () => {
    let initCalled = false;
    lazy({
      ref: "target",
      load: () => Promise.resolve({}),
      init: () => {
        initCalled = true;
      },
    });
    capturedCallback([makeEntry(false)], {} as IntersectionObserver);
    await Promise.resolve();
    expect(initCalled).toBe(false);
  });

  it("routes a load rejection to onError rather than leaking an unhandled rejection", async () => {
    const failure = new Error("chunk fetch failed");
    const errors: unknown[] = [];
    let initCalled = false;

    lazy({
      ref: "target",
      load: () => Promise.reject(failure),
      init: () => {
        initCalled = true;
      },
      onError: (error) => errors.push(error),
    });
    intersect();
    await flush();

    expect(errors).toStrictEqual([failure]);
    expect(initCalled).toBe(false);
  });

  it("swallows a load rejection when no onError is supplied", async () => {
    const dispose = lazy({ ref: "target", load: () => Promise.reject(new Error("chunk fetch failed")), init: () => {} });
    intersect();
    await flush();
    expect(() => dispose()).not.toThrow();
  });

  it("re-observes the element after a failed load so a later intersection retries", async () => {
    lazy({ ref: "target", load: () => Promise.reject(new Error("boom")), init: () => {}, onError: () => {} });
    expect(observedElements).toHaveLength(1);

    intersect();
    await flush();
    elapseRetryDelay();

    expect(observedElements).toStrictEqual([mockElement, mockElement]);
  });

  it("waits out the retry delay before re-observing", async () => {
    lazy({ ref: "target", load: () => Promise.reject(new Error("boom")), init: () => {}, onError: () => {} });

    intersect();
    await flush();

    expect(observedElements).toStrictEqual([mockElement]);
    expect(capturedTimer?.ms).toBe(RETRY_DELAY_MS);

    elapseRetryDelay();
    expect(observedElements).toStrictEqual([mockElement, mockElement]);
  });

  it("stops retrying at the attempt cap", async () => {
    let attempts = 0;
    lazy({
      ref: "target",
      load: () => {
        attempts += 1;
        return Promise.reject(new Error("boom"));
      },
      init: () => {},
      onError: () => {},
    });

    for (let i = 0; i < 5; i++) {
      intersect();
      await flush();
      elapseRetryDelay();
    }

    expect(attempts).toBe(3);
    expect(observedElements).toHaveLength(3);
  });

  it("succeeds on a retry after a transient failure", async () => {
    const mod = { doThing: () => {} };
    let calls = 0;
    let initMod: unknown = null;

    lazy({
      ref: "target",
      load: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error("transient")) : Promise.resolve(mod);
      },
      init: (m) => {
        initMod = m;
      },
      onError: () => {},
    });

    intersect();
    await flush();
    expect(initMod).toBeNull();

    elapseRetryDelay();
    intersect();
    await flush();
    expect(initMod).toBe(mod);
  });

  it("reports an init throw to onError without retrying it", async () => {
    const failure = new Error("init exploded");
    const errors: unknown[] = [];
    let loads = 0;

    lazy({
      ref: "target",
      load: () => {
        loads += 1;
        return Promise.resolve({});
      },
      init: () => {
        throw failure;
      },
      onError: (error) => errors.push(error),
    });

    intersect();
    await flush();

    expect(errors).toStrictEqual([failure]);
    expect(loads).toBe(1);
    expect(capturedTimer).toBeUndefined();
    expect(observedElements).toStrictEqual([mockElement]);
  });

  it("does not re-observe when disposed while the retry timer is pending", async () => {
    const dispose = lazy({ ref: "target", load: () => Promise.reject(new Error("boom")), init: () => {}, onError: () => {} });

    intersect();
    await flush();
    expect(capturedTimer?.ms).toBe(RETRY_DELAY_MS);

    dispose();
    elapseRetryDelay();

    expect(observedElements).toStrictEqual([mockElement]);
  });

  it("does not re-observe when disposed while the load is in flight", async () => {
    let failLoad: (error: unknown) => void = () => {};
    const dispose = lazy({
      ref: "target",
      load: () =>
        new Promise<unknown>((_resolve, reject) => {
          failLoad = reject;
        }),
      init: () => {},
      onError: () => {},
    });

    intersect();
    dispose();
    failLoad(new Error("boom"));
    await flush();

    expect(observedElements).toStrictEqual([mockElement]);
  });

  it("does not run init when disposed while the load resolves in flight", async () => {
    let settleLoad: (mod: unknown) => void = () => {};
    let initCalls = 0;
    const errors: unknown[] = [];

    const dispose = lazy({
      ref: "target",
      load: () =>
        new Promise<unknown>((resolve) => {
          settleLoad = resolve;
        }),
      init: () => {
        initCalls += 1;
      },
      onError: (error) => errors.push(error),
    });

    intersect();
    dispose();
    settleLoad({ doThing: () => {} });
    await flush();

    expect(initCalls).toBe(0);
    expect(errors).toStrictEqual([]);
  });

  it("escapes a ref containing a quote so the selector cannot be broken out of", () => {
    let capturedSelector = "";
    lg.document.querySelector = (selector: string) => {
      capturedSelector = selector;
      return null;
    };
    lazy({ ref: "a'b", load: () => Promise.resolve({}), init: () => {} });
    expect(capturedSelector).toBe("[data-ref='a\\'b']");
  });
});

interface ScriptGlobalMock {
  document: {
    querySelector: (selector: string) => MockScriptElement | Record<string, unknown> | null;
    createElement: (tag: string) => MockScript;
    head: { appendChild: (el: MockScript) => void };
  };
}

const sg = globalThis as unknown as ScriptGlobalMock;

interface MockScriptElement {
  listeners: Record<string, { handler: EventListener; options?: AddEventListenerOptions | undefined }>;
  addEventListener: (event: string, handler: EventListener, options?: AddEventListenerOptions) => void;
}

interface MockScript {
  src: string;
  async: boolean;
  integrity: string;
  crossOrigin: string;
  loadListeners: EventListener[];
  addEventListener: (event: string, handler: EventListener) => void;
}

describe("loadScriptOnEvent", () => {
  let mockTrigger: MockScriptElement;
  let mockScript: MockScript;
  let appendedScripts: MockScript[];

  beforeEach(() => {
    appendedScripts = [];

    mockTrigger = {
      listeners: {},
      addEventListener(event, handler, options) {
        this.listeners[event] = { handler, options };
      },
    };

    mockScript = {
      src: "",
      async: false,
      integrity: "",
      crossOrigin: "",
      loadListeners: [],
      addEventListener(event, handler) {
        if (event === "load") this.loadListeners.push(handler);
      },
    };

    sg.document = {
      querySelector: (selector: string) => {
        if (selector.startsWith("script[src=")) return null;
        return mockTrigger;
      },
      createElement: (_tag: string) => mockScript,
      head: { appendChild: (el: MockScript) => appendedScripts.push(el) },
    };
  });

  it("attaches an event listener to the target element", () => {
    loadScriptOnEvent({ triggerSelector: "[data-ref='trigger']", event: "focus", scriptSrc: "https://example.com/script.js", integrity: false });
    expect(mockTrigger.listeners.focus).toBeDefined();
  });

  it("uses { once: true } so the listener fires only once", () => {
    loadScriptOnEvent({ triggerSelector: "[data-ref='trigger']", event: "focus", scriptSrc: "https://example.com/script.js", integrity: false });
    expect(mockTrigger.listeners.focus?.options).toEqual({ once: true });
  });

  it("appends a script tag when the event fires", () => {
    loadScriptOnEvent({ triggerSelector: "[data-ref='trigger']", event: "focus", scriptSrc: "https://example.com/script.js", integrity: false });
    mockTrigger.listeners.focus!.handler(new Event("focus"));
    expect(appendedScripts).toHaveLength(1);
    expect(appendedScripts[0]!.src).toBe("https://example.com/script.js");
    expect(appendedScripts[0]!.async).toBe(true);
  });

  it("does nothing when the trigger element is not found", () => {
    sg.document.querySelector = () => null;
    loadScriptOnEvent({ triggerSelector: "[data-ref='missing']", event: "focus", scriptSrc: "https://example.com/script.js", integrity: false });
    expect(appendedScripts).toHaveLength(0);
  });

  it("does not append a second script if one already exists", () => {
    sg.document.querySelector = (selector: string) => {
      if (selector.startsWith("script[src=")) return {}; // existing script found
      return mockTrigger;
    };
    loadScriptOnEvent({ triggerSelector: "[data-ref='trigger']", event: "focus", scriptSrc: "https://example.com/script.js", integrity: false });
    mockTrigger.listeners.focus!.handler(new Event("focus"));
    expect(appendedScripts).toHaveLength(0);
  });

  it("attaches an onLoad listener when provided", () => {
    const onLoad = () => {};
    loadScriptOnEvent({
      triggerSelector: "[data-ref='trigger']",
      event: "focus",
      scriptSrc: "https://example.com/script.js",
      integrity: false,
      onLoad,
    });
    mockTrigger.listeners.focus!.handler(new Event("focus"));
    expect(mockScript.loadListeners).toContain(onLoad);
  });

  it("sets integrity and crossOrigin when integrity option is provided", () => {
    loadScriptOnEvent({
      triggerSelector: "[data-ref='trigger']",
      event: "focus",
      scriptSrc: "https://example.com/script.js",
      integrity: "sha384-abc123",
    });
    mockTrigger.listeners.focus!.handler(new Event("focus"));
    expect(mockScript.integrity).toBe("sha384-abc123");
    expect(mockScript.crossOrigin).toBe("anonymous");
  });

  it("does not set integrity or crossOrigin when integrity is false", () => {
    loadScriptOnEvent({ triggerSelector: "[data-ref='trigger']", event: "focus", scriptSrc: "https://example.com/script.js", integrity: false });
    mockTrigger.listeners.focus!.handler(new Event("focus"));
    expect(mockScript.integrity).toBe("");
    expect(mockScript.crossOrigin).toBe("");
  });
});

interface StylesheetGlobalMock {
  document: {
    querySelector: (selector: string) => MockLink | null;
    createElement: (tag: string) => MockLink;
    head: { appendChild: (el: MockLink) => void };
  };
}

const cssG = globalThis as unknown as StylesheetGlobalMock;

interface MockLink {
  rel: string;
  href: string;
  integrity: string;
  crossOrigin: string;
  listeners: Record<string, EventListener>;
  addEventListener: (event: string, handler: EventListener) => void;
  remove: () => void;
}

describe("loadStylesheet", () => {
  let appendedLinks: MockLink[];
  let createdLinks: MockLink[];

  /** A distinct element per `createElement`, as the DOM gives: a shared singleton could not tell a
   * fresh link from a stale one. */
  function createLink(): MockLink {
    const link: MockLink = {
      rel: "",
      href: "",
      integrity: "",
      crossOrigin: "",
      listeners: {},
      addEventListener(event, handler) {
        this.listeners[event] = handler;
      },
      remove() {
        const at = appendedLinks.indexOf(link);
        if (at !== -1) appendedLinks.splice(at, 1);
      },
    };
    createdLinks.push(link);
    return link;
  }

  /** The link the call under test is waiting on. */
  function lastLink(): MockLink {
    return createdLinks[createdLinks.length - 1]!;
  }

  beforeEach(() => {
    appendedLinks = [];
    createdLinks = [];

    cssG.document = {
      // Faithful to the DOM: an appended <link> is findable immediately, long before its `load`
      // fires. That is exactly the window in which the duplicate check alone would resolve a second
      // caller — and, once a failed link is removed, the state that proves it cannot.
      querySelector: () => appendedLinks[0] ?? null,
      createElement: (_tag: string) => createLink(),
      head: { appendChild: (el: MockLink) => appendedLinks.push(el) },
    };
  });

  it("creates and appends a link element with correct rel and href", async () => {
    const promise = loadStylesheet("/assets/css/maplibre-gl.css", false);
    lastLink().listeners.load!(new Event("load"));
    await promise;
    expect(appendedLinks).toHaveLength(1);
    expect(appendedLinks[0]!.rel).toBe("stylesheet");
    expect(appendedLinks[0]!.href).toBe("/assets/css/maplibre-gl.css");
  });

  it("resolves the promise when the load event fires", async () => {
    const promise = loadStylesheet("/assets/css/maplibre-gl.css", false);
    lastLink().listeners.load!(new Event("load"));
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects the promise when the error event fires", async () => {
    const promise = loadStylesheet("/assets/css/maplibre-gl.css", false);
    lastLink().listeners.error!(new Event("error"));
    await expect(promise).rejects.toThrow("Failed to load stylesheet: /assets/css/maplibre-gl.css");
  });

  it("returns a resolved promise without DOM mutation when a matching link already exists", async () => {
    // A link this function did not create — SSR markup or third-party code — so it is not in
    // `appendedLinks` and there is no event left to wait for.
    const existing = createLink();
    cssG.document.querySelector = () => existing;

    const promise = loadStylesheet("/assets/css/maplibre-gl.css", false);
    await expect(promise).resolves.toBeUndefined();
    expect(appendedLinks).toHaveLength(0);
  });

  it("sets integrity and crossOrigin when integrity argument is provided", async () => {
    const promise = loadStylesheet("/assets/css/maplibre-gl.css", "sha384-xyz");
    lastLink().listeners.load!(new Event("load"));
    await promise;
    expect(appendedLinks[0]!.integrity).toBe("sha384-xyz");
    expect(appendedLinks[0]!.crossOrigin).toBe("anonymous");
  });

  it("does not set integrity or crossOrigin when integrity is false", async () => {
    const promise = loadStylesheet("/assets/css/maplibre-gl.css", false);
    lastLink().listeners.load!(new Event("load"));
    await promise;
    expect(appendedLinks[0]!.integrity).toBe("");
    expect(appendedLinks[0]!.crossOrigin).toBe("");
  });

  it("makes a concurrent caller wait for the link's real load event", async () => {
    const first = loadStylesheet("/assets/css/maplibre-gl.css", false);
    const second = loadStylesheet("/assets/css/maplibre-gl.css", false);

    let secondSettled = false;
    const watched = second.then(() => {
      secondSettled = true;
    });

    await flush();
    expect(appendedLinks).toHaveLength(1);
    expect(secondSettled).toBe(false);

    lastLink().listeners.load!(new Event("load"));
    await expect(first).resolves.toBeUndefined();
    await watched;
    expect(secondSettled).toBe(true);
  });

  it("rejects every concurrent caller when the link fails", async () => {
    const first = loadStylesheet("/assets/css/maplibre-gl.css", false);
    const second = loadStylesheet("/assets/css/maplibre-gl.css", false);
    expect(appendedLinks).toHaveLength(1);

    lastLink().listeners.error!(new Event("error"));

    await expect(first).rejects.toThrow("Failed to load stylesheet: /assets/css/maplibre-gl.css");
    await expect(second).rejects.toThrow("Failed to load stylesheet: /assets/css/maplibre-gl.css");
  });

  it("removes the failed link so a later call retries with a fresh one", async () => {
    const failed = loadStylesheet("/assets/css/maplibre-gl.css", false);
    const failedLink = lastLink();
    failedLink.listeners.error!(new Event("error"));
    await expect(failed).rejects.toThrow("Failed to load stylesheet: /assets/css/maplibre-gl.css");

    // Evicting the cache entry is only half of it. The retry below misses the map and falls through
    // to the duplicate check, which would find a dead link left in the head and resolve for a
    // stylesheet that never loaded — so the head has to be empty here, not merely the cache.
    expect(appendedLinks).toHaveLength(0);

    const retry = loadStylesheet("/assets/css/maplibre-gl.css", false);
    const retryLink = lastLink();
    expect(retryLink).not.toBe(failedLink);
    expect(appendedLinks).toHaveLength(1);
    expect(appendedLinks[0]).toBe(retryLink);

    // It resolves on its *own* load event, not on the duplicate check finding something.
    retryLink.listeners.load!(new Event("load"));
    await expect(retry).resolves.toBeUndefined();
  });

  it("keeps a loaded link in the head", async () => {
    const promise = loadStylesheet("/assets/css/maplibre-gl.css", false);
    lastLink().listeners.load!(new Event("load"));
    await promise;

    // Only the failure path removes; a stylesheet that loaded must stay applied to the page.
    expect(appendedLinks).toHaveLength(1);
  });

  it("escapes an href containing a quote in the duplicate-check selector", async () => {
    let capturedSelector = "";
    cssG.document.querySelector = (selector: string) => {
      capturedSelector = selector;
      return null;
    };
    const promise = loadStylesheet('a"b', false);
    lastLink().listeners.load!(new Event("load"));
    await promise;
    expect(capturedSelector).toBe('link[rel="stylesheet"][href="a\\"b"]');
  });
});
