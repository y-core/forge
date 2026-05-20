import { beforeEach, describe, expect, it } from "bun:test";
import { loadScriptOnEvent } from "./lazy-load";

interface GlobalMock {
  document: {
    querySelector: (selector: string) => MockElement | Record<string, unknown> | null;
    createElement: (tag: string) => MockScript;
    head: { appendChild: (el: MockScript) => void };
  };
}

const g = globalThis as unknown as GlobalMock;

interface MockElement {
  listeners: Record<string, { handler: EventListener; options?: AddEventListenerOptions }>;
  addEventListener: (event: string, handler: EventListener, options?: AddEventListenerOptions) => void;
}

interface MockScript {
  src: string;
  async: boolean;
  loadListeners: EventListener[];
  addEventListener: (event: string, handler: EventListener) => void;
}

let mockElement: MockElement;
let mockScript: MockScript;
let appendedScripts: MockScript[];
let queriedSelectors: string[];

beforeEach(() => {
  appendedScripts = [];
  queriedSelectors = [];

  mockElement = {
    listeners: {},
    addEventListener(event, handler, options) {
      this.listeners[event] = { handler, options };
    },
  };

  mockScript = {
    src: "",
    async: false,
    loadListeners: [],
    addEventListener(event, handler) {
      if (event === "load") this.loadListeners.push(handler);
    },
  };

  g.document = {
    querySelector: (selector: string) => {
      queriedSelectors.push(selector);
      // Return null for script deduplication check, return element for the trigger
      if (selector.startsWith("script[src=")) return null;
      return mockElement;
    },
    createElement: (_tag: string) => mockScript,
    head: {
      appendChild: (el: MockScript) => appendedScripts.push(el),
    },
  };
});

describe("loadScriptOnEvent", () => {
  it("attaches an event listener to the target element", () => {
    loadScriptOnEvent({
      triggerSelector: "[data-ref='trigger']",
      event: "focus",
      scriptSrc: "https://example.com/script.js",
    });
    expect(mockElement.listeners.focus).toBeDefined();
  });

  it("uses { once: true } so the listener fires only once", () => {
    loadScriptOnEvent({
      triggerSelector: "[data-ref='trigger']",
      event: "focus",
      scriptSrc: "https://example.com/script.js",
    });
    expect(mockElement.listeners.focus?.options).toEqual({ once: true });
  });

  it("appends a script tag when the event fires", () => {
    loadScriptOnEvent({
      triggerSelector: "[data-ref='trigger']",
      event: "focus",
      scriptSrc: "https://example.com/script.js",
    });
    mockElement.listeners.focus.handler(new Event("focus"));
    expect(appendedScripts).toHaveLength(1);
    expect(appendedScripts[0].src).toBe("https://example.com/script.js");
    expect(appendedScripts[0].async).toBe(true);
  });

  it("does nothing when the trigger element is not found", () => {
    g.document.querySelector = () => null;
    loadScriptOnEvent({
      triggerSelector: "[data-ref='missing']",
      event: "focus",
      scriptSrc: "https://example.com/script.js",
    });
    expect(appendedScripts).toHaveLength(0);
  });

  it("does not append a second script if one already exists", () => {
    g.document.querySelector = (selector: string) => {
      if (selector.startsWith("script[src=")) return {}; // existing script found
      return mockElement;
    };
    loadScriptOnEvent({
      triggerSelector: "[data-ref='trigger']",
      event: "focus",
      scriptSrc: "https://example.com/script.js",
    });
    mockElement.listeners.focus.handler(new Event("focus"));
    expect(appendedScripts).toHaveLength(0);
  });

  it("attaches an onLoad listener when provided", () => {
    const onLoad = () => {};
    loadScriptOnEvent({
      triggerSelector: "[data-ref='trigger']",
      event: "focus",
      scriptSrc: "https://example.com/script.js",
      onLoad,
    });
    mockElement.listeners.focus.handler(new Event("focus"));
    expect(mockScript.loadListeners).toContain(onLoad);
  });
});
