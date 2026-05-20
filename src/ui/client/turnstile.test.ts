import { beforeEach, describe, expect, it } from "bun:test";
import { initTurnstile } from "./turnstile";

type ObserverCallback = (mutations: unknown[]) => void;

interface GlobalMock {
  _fts_verified?: () => void;
  _fts_expired?: () => void;
  MutationObserver: new (cb: ObserverCallback) => { observe(): void; disconnect(): void };
  window: { turnstile?: { reset: (el: unknown) => void } | undefined };
  document: {
    documentElement: MockEl;
    querySelector: (sel: string) => MockEl | null;
    addEventListener: (ev: string, h: EventListener) => void;
  };
}

const g = globalThis as unknown as GlobalMock;

interface MockEl {
  attrs: Record<string, string>;
  classes: Set<string>;
  reset: (() => void) | undefined;
  disabled: boolean;
  listeners: Record<string, EventListener[]>;
  classList: {
    contains: (c: string) => boolean;
    add: (c: string) => void;
    remove: (c: string) => void;
  };
  setAttribute: (k: string, v: string) => void;
  getAttribute: (k: string) => string | null;
  querySelector: (sel: string) => MockEl | null;
  querySelectorAll: (sel: string) => MockEl[];
  addEventListener: (event: string, handler: EventListener) => void;
  matches: (sel: string) => boolean;
}

function makeEl(classes: string[] = []): MockEl {
  const cls = new Set<string>(classes);
  const attrs: Record<string, string> = {};
  const listeners: Record<string, EventListener[]> = {};
  const el: MockEl = {
    attrs,
    classes: cls,
    reset: undefined,
    disabled: false,
    listeners,
    classList: {
      contains: (c) => cls.has(c),
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
    },
    setAttribute: (k, v) => { attrs[k] = v; },
    getAttribute: (k) => attrs[k] ?? null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (ev, h) => { if (!listeners[ev]) listeners[ev] = []; listeners[ev].push(h); },
    matches: () => false,
  };
  return el;
}

describe("initTurnstile", () => {
  let htmlEl: MockEl;
  let widgetEl: MockEl;
  let submitEl: MockEl;
  let formEl: MockEl;
  let resultEl: MockEl;
  let docListeners: Record<string, EventListener[]>;
  let observerCallback: ObserverCallback | null;

  beforeEach(() => {
    htmlEl = makeEl();
    widgetEl = makeEl();
    submitEl = makeEl();
    formEl = makeEl();
    resultEl = makeEl();
    docListeners = {};
    observerCallback = null;

    delete g._fts_verified;
    delete g._fts_expired;

    g.MutationObserver = class {
      constructor(cb: ObserverCallback) { observerCallback = cb; }
      observe(): void {}
      disconnect(): void {}
    };

    g.window = { turnstile: undefined };

    g.document = {
      documentElement: htmlEl,
      querySelector: (sel: string) => {
        if (sel.includes("turnstile")) return widgetEl;
        if (sel.includes("contact-submit")) return submitEl;
        if (sel.includes("contact-form")) return formEl;
        return null;
      },
      addEventListener: (ev: string, h: EventListener) => {
        if (!docListeners[ev]) docListeners[ev] = [];
        docListeners[ev].push(h);
      },
    };
  });

  it("disables the submit button on init", () => {
    initTurnstile();
    expect(submitEl.disabled).toBe(true);
  });

  it("sets data-callback and data-expired-callback on the widget", () => {
    initTurnstile();
    expect(widgetEl.attrs["data-callback"]).toBe("_fts_verified");
    expect(widgetEl.attrs["data-expired-callback"]).toBe("_fts_expired");
  });

  it("enables the submit button when _fts_verified is called", () => {
    initTurnstile();
    g._fts_verified?.();
    expect(submitEl.disabled).toBe(false);
  });

  it("disables the submit button when _fts_expired is called", () => {
    initTurnstile();
    g._fts_verified?.();
    g._fts_expired?.();
    expect(submitEl.disabled).toBe(true);
  });

  it("sets data-theme=light when html element has no dark class", () => {
    initTurnstile();
    expect(widgetEl.attrs["data-theme"]).toBe("light");
  });

  it("sets data-theme=dark when html element has dark class", () => {
    htmlEl.classes.add("dark");
    initTurnstile();
    expect(widgetEl.attrs["data-theme"]).toBe("dark");
  });

  it("syncs theme via MutationObserver when dark class is added", () => {
    initTurnstile();
    htmlEl.classes.add("dark");
    observerCallback?.([]);
    expect(widgetEl.attrs["data-theme"]).toBe("dark");
  });

  it("calls turnstile.reset during theme sync when available", () => {
    let resetCalledWith: unknown;
    g.window = {
      turnstile: { reset: (el: unknown) => { resetCalledWith = el; } },
    };
    initTurnstile();
    expect(resetCalledWith).toBe(widgetEl);
  });

  it("resets the form and re-disables submit on htmx:afterSwap with data-success", () => {
    let formReset = false;
    formEl.reset = () => { formReset = true; };

    g.document.querySelector = (sel: string) => {
      if (sel.includes("turnstile")) return widgetEl;
      if (sel.includes("contact-submit")) return submitEl;
      if (sel.includes("contact-form")) return formEl;
      return null;
    };

    initTurnstile();
    g._fts_verified?.();
    expect(submitEl.disabled).toBe(false);

    const successMarker = makeEl();
    resultEl.querySelector = (sel: string) => sel.includes("data-success") ? successMarker : null;
    resultEl.matches = (sel: string) => sel.includes("contact-result");

    const swapEvent = new CustomEvent("htmx:afterSwap", { detail: { target: resultEl } });
    docListeners["htmx:afterSwap"][0](swapEvent);

    expect(formReset).toBe(true);
    expect(submitEl.disabled).toBe(true);
  });

  it("does not reset the form when htmx:afterSwap target lacks data-success", () => {
    let formReset = false;
    formEl.reset = () => { formReset = true; };

    initTurnstile();

    resultEl.querySelector = () => null;
    resultEl.matches = (sel: string) => sel.includes("contact-result");

    const swapEvent = new CustomEvent("htmx:afterSwap", { detail: { target: resultEl } });
    docListeners["htmx:afterSwap"][0](swapEvent);

    expect(formReset).toBe(false);
  });
});
