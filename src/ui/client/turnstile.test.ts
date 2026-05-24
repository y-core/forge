import { beforeEach, describe, expect, it } from "bun:test";
import { createSignal, type Signal } from "./signal";
import { mountTurnstile } from "./turnstile";

interface ListenerRegistry {
  [event: string]: EventListener[];
}

interface GlobalMock {
  window: { turnstile?: { reset: (el: unknown) => void } | undefined };
  document: {
    querySelector: (sel: string) => MockEl | null;
    addEventListener: (ev: string, h: EventListener) => void;
    removeEventListener: (ev: string, h: EventListener) => void;
  };
}

const g = globalThis as unknown as GlobalMock;

interface MockEl {
  attrs: Record<string, string>;
  disabled: boolean;
  listeners: ListenerRegistry;
  reset?: () => void;
  setAttribute: (k: string, v: string) => void;
  querySelector: (sel: string) => MockEl | null;
  addEventListener: (event: string, handler: EventListener) => void;
  removeEventListener: (event: string, handler: EventListener) => void;
  matches: (sel: string) => boolean;
}

function removeListener(list: EventListener[] | undefined, handler: EventListener): EventListener[] {
  return (list ?? []).filter((entry) => entry !== handler);
}

function makeEl(): MockEl {
  const attrs: Record<string, string> = {};
  const listeners: ListenerRegistry = {};

  return {
    attrs,
    disabled: false,
    listeners,
    setAttribute: (k, v) => {
      attrs[k] = v;
    },
    querySelector: () => null,
    addEventListener: (event, handler) => {
      listeners[event] = [...(listeners[event] ?? []), handler];
    },
    removeEventListener: (event, handler) => {
      listeners[event] = removeListener(listeners[event], handler);
    },
    matches: () => false,
  };
}

describe("mountTurnstile", () => {
  let isDarkSignal: Signal<boolean>;
  let widgetEl: MockEl;
  let submitEl: MockEl;
  let formEl: MockEl;
  let resultEl: MockEl;
  let docListeners: ListenerRegistry;

  beforeEach(() => {
    isDarkSignal = createSignal(false);
    widgetEl = makeEl();
    submitEl = makeEl();
    formEl = makeEl();
    resultEl = makeEl();
    docListeners = {};

    g.window = { turnstile: undefined };
    g.document = {
      querySelector: (sel: string) => {
        if (sel.includes("turnstile")) return widgetEl;
        if (sel.includes("contact-submit")) return submitEl;
        if (sel.includes("contact-form")) return formEl;
        return null;
      },
      addEventListener: (event, handler) => {
        docListeners[event] = [...(docListeners[event] ?? []), handler];
      },
      removeEventListener: (event, handler) => {
        docListeners[event] = removeListener(docListeners[event], handler);
      },
    };
  });

  it("disables the submit button on init", () => {
    const cleanup = mountTurnstile(isDarkSignal);
    expect(submitEl.disabled).toBe(true);
    cleanup();
  });

  it("sets unique callback names on the widget", () => {
    const cleanup = mountTurnstile(isDarkSignal);
    expect(widgetEl.attrs["data-callback"]).toContain("__forgeTurnstile_");
    expect(widgetEl.attrs["data-expired-callback"]).toContain("__forgeTurnstile_");
    cleanup();
  });

  it("enables the submit button when the verification callback is called", () => {
    const cleanup = mountTurnstile(isDarkSignal);
    const callback = (globalThis as unknown as Record<string, () => void>)[
      widgetEl.attrs["data-callback"]
    ];
    callback();
    expect(submitEl.disabled).toBe(false);
    cleanup();
  });

  it("syncs the theme and resets the widget when turnstile is available", () => {
    let resetCalled = 0;
    g.window = {
      turnstile: {
        reset: (el: unknown) => {
          expect(el).toBe(widgetEl);
          resetCalled += 1;
        },
      },
    };

    const cleanup = mountTurnstile(isDarkSignal);
    expect(widgetEl.attrs["data-theme"]).toBe("light");
    isDarkSignal.value = true;
    expect(widgetEl.attrs["data-theme"]).toBe("dark");
    expect(resetCalled).toBeGreaterThanOrEqual(2);
    cleanup();
  });

  it("resets the form on a successful htmx swap", () => {
    let resetCount = 0;
    formEl.reset = () => {
      resetCount += 1;
    };

    const cleanup = mountTurnstile(isDarkSignal);
    const verify = (globalThis as unknown as Record<string, () => void>)[
      widgetEl.attrs["data-callback"]
    ];
    verify();

    resultEl.querySelector = (sel: string) => (sel.includes("data-success") ? makeEl() : null);
    resultEl.matches = (sel: string) => sel.includes("contact-result");

    docListeners["htmx:afterSwap"][0](new CustomEvent("htmx:afterSwap", { detail: { target: resultEl } }));

    expect(resetCount).toBe(1);
    expect(submitEl.disabled).toBe(true);
    cleanup();
  });

  it("is idempotent for the same widget", () => {
    const cleanupA = mountTurnstile(isDarkSignal);
    const cleanupB = mountTurnstile(isDarkSignal);
    expect(cleanupA).toBe(cleanupB);
    expect(docListeners["htmx:afterSwap"]).toHaveLength(1);
    cleanupA();
  });

  it("cleanup removes callbacks and listeners", () => {
    const cleanup = mountTurnstile(isDarkSignal);
    const callbackName = widgetEl.attrs["data-callback"];
    cleanup();
    expect((globalThis as Record<string, unknown>)[callbackName]).toBeUndefined();
    expect(docListeners["htmx:afterSwap"]).toHaveLength(0);
  });

  it("returns a noop cleanup when the widget is missing", () => {
    g.document.querySelector = () => null;
    const cleanup = mountTurnstile(isDarkSignal);
    expect(() => cleanup()).not.toThrow();
  });
});
