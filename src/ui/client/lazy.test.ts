import { beforeEach, describe, expect, it } from "bun:test";
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

// ── lazy ──────────────────────────────────────────────────────────────────────

interface MockObserver {
  observe: (el: Element) => void;
  disconnect: () => void;
}

type ObserverConstructor = new (callback: IntersectionObserverCallback, options?: IntersectionObserverInit) => MockObserver;

interface LazyGlobalMock {
  document: { querySelector: (selector: string) => Element | null };
  IntersectionObserver: ObserverConstructor;
}

const lg = globalThis as unknown as LazyGlobalMock;

describe("lazy", () => {
  let mockElement: Element;
  let capturedCallback: IntersectionObserverCallback;
  let capturedOptions: IntersectionObserverInit | undefined;
  let observedElements: Element[];
  let disconnectCount: number;

  beforeEach(() => {
    mockElement = {} as Element;
    observedElements = [];
    disconnectCount = 0;
    capturedOptions = undefined;

    lg.document = { querySelector: (selector: string) => (selector === "[data-ref='target']" ? mockElement : null) };

    // biome-ignore lint/complexity/useArrowFunction: arrow functions cannot be constructed with `new`
    lg.IntersectionObserver = function (callback: IntersectionObserverCallback, options?: IntersectionObserverInit): MockObserver {
      capturedCallback = callback;
      capturedOptions = options;
      return {
        observe: (el: Element) => {
          observedElements.push(el);
        },
        disconnect: () => {
          disconnectCount++;
        },
      };
    } as unknown as ObserverConstructor;
  });

  function makeEntry(isIntersecting: boolean): IntersectionObserverEntry {
    return { isIntersecting } as IntersectionObserverEntry;
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

// ── loadScriptOnEvent ─────────────────────────────────────────────────────────

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

// ── loadStylesheet ────────────────────────────────────────────────────────────

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
}

describe("loadStylesheet", () => {
  let mockLink: MockLink;
  let appendedLinks: MockLink[];

  beforeEach(() => {
    appendedLinks = [];

    mockLink = {
      rel: "",
      href: "",
      integrity: "",
      crossOrigin: "",
      listeners: {},
      addEventListener(event, handler) {
        this.listeners[event] = handler;
      },
    };

    cssG.document = {
      querySelector: () => null,
      createElement: (_tag: string) => mockLink,
      head: { appendChild: (el: MockLink) => appendedLinks.push(el) },
    };
  });

  it("creates and appends a link element with correct rel and href", async () => {
    const promise = loadStylesheet("/assets/css/maplibre-gl.css", false);
    mockLink.listeners.load!(new Event("load"));
    await promise;
    expect(appendedLinks).toHaveLength(1);
    expect(appendedLinks[0]!.rel).toBe("stylesheet");
    expect(appendedLinks[0]!.href).toBe("/assets/css/maplibre-gl.css");
  });

  it("resolves the promise when the load event fires", async () => {
    const promise = loadStylesheet("/assets/css/maplibre-gl.css", false);
    mockLink.listeners.load!(new Event("load"));
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects the promise when the error event fires", async () => {
    const promise = loadStylesheet("/assets/css/maplibre-gl.css", false);
    mockLink.listeners.error!(new Event("error"));
    await expect(promise).rejects.toThrow("Failed to load stylesheet: /assets/css/maplibre-gl.css");
  });

  it("returns a resolved promise without DOM mutation when a matching link already exists", async () => {
    cssG.document.querySelector = () => mockLink;
    const promise = loadStylesheet("/assets/css/maplibre-gl.css", false);
    await expect(promise).resolves.toBeUndefined();
    expect(appendedLinks).toHaveLength(0);
  });

  it("sets integrity and crossOrigin when integrity argument is provided", async () => {
    const promise = loadStylesheet("/assets/css/maplibre-gl.css", "sha384-xyz");
    mockLink.listeners.load!(new Event("load"));
    await promise;
    expect(appendedLinks[0]!.integrity).toBe("sha384-xyz");
    expect(appendedLinks[0]!.crossOrigin).toBe("anonymous");
  });

  it("does not set integrity or crossOrigin when integrity is false", async () => {
    const promise = loadStylesheet("/assets/css/maplibre-gl.css", false);
    mockLink.listeners.load!(new Event("load"));
    await promise;
    expect(appendedLinks[0]!.integrity).toBe("");
    expect(appendedLinks[0]!.crossOrigin).toBe("");
  });

  it("escapes an href containing a quote in the duplicate-check selector", async () => {
    let capturedSelector = "";
    cssG.document.querySelector = (selector: string) => {
      capturedSelector = selector;
      return null;
    };
    const promise = loadStylesheet('a"b', false);
    mockLink.listeners.load!(new Event("load"));
    await promise;
    expect(capturedSelector).toBe('link[rel="stylesheet"][href="a\\"b"]');
  });
});
