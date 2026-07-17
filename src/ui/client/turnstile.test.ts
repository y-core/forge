import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { TURNSTILE_SCRIPT_SRC } from "../turnstile-contract";
import { mountTurnstile } from "./turnstile";

// --- Minimal DOM mock (forge has no jsdom; controllers are tested against a hand-rolled DOM). ---

type Handler = (event?: unknown) => void;

interface MockEl {
  attrs: Record<string, string>;
  hidden: boolean;
  listeners: Record<string, Handler[]>;
  reset?: () => void;
  form?: MockEl | null;
  src?: string;
  async?: boolean;
  getAttribute(k: string): string | null;
  setAttribute(k: string, v: string): void;
  addEventListener(e: string, h: Handler, opts?: unknown): void;
  removeEventListener(e: string, h: Handler): void;
  closest(sel: string): MockEl | null;
  /** Test helper: invoke every listener registered for `event`. */
  fire(event: string, payload?: unknown): void;
}

function makeEl(): MockEl {
  const el: MockEl = {
    attrs: {},
    hidden: true,
    listeners: {},
    getAttribute: (k) => el.attrs[k] ?? null,
    setAttribute: (k, v) => {
      el.attrs[k] = v;
    },
    addEventListener: (e, h) => {
      const existing = el.listeners[e];
      if (existing) existing.push(h);
      else el.listeners[e] = [h];
    },
    removeEventListener: (e, h) => {
      el.listeners[e] = (el.listeners[e] ?? []).filter((x) => x !== h);
    },
    closest: () => el.form ?? null,
    fire: (event, payload) => {
      for (const h of [...(el.listeners[event] ?? [])]) h(payload);
    },
  };
  return el;
}

interface TurnstileMock {
  render: (el: unknown, params: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
}

interface MockWindow {
  turnstile?: TurnstileMock;
  setTimeout: (fn: () => void, ms?: number) => number;
  clearTimeout: (id: number) => void;
  setInterval: (fn: () => void, ms?: number) => number;
  clearInterval: (id: number) => void;
}

interface MockDocument {
  documentElement: { classList: { contains: (c: string) => boolean } };
  head: { appendChild: (node: MockEl) => void };
  createElement: (tag: string) => MockEl;
  querySelector: (sel: string) => MockEl | null;
}

interface GlobalMock {
  window: MockWindow;
  document: MockDocument;
  CSS: { escape: (s: string) => string };
}

const g = globalThis as unknown as GlobalMock;

describe("mountTurnstile", () => {
  let widgetEl: MockEl;
  let fallbackEl: MockEl;
  let formEl: MockEl;
  let appended: MockEl[];
  let createdScripts: MockEl[];
  let renderParams: Array<Record<string, unknown>>;
  let resetCalls: number;
  let removeCalls: number;
  let isDark: boolean;
  let timeouts: Array<() => void>;

  const savedWindow = g.window;
  const savedDocument = g.document;
  const savedCSS = g.CSS;

  /** Install a working Turnstile API on the mock window (call before firing the script `load`). */
  const installTurnstile = () => {
    g.window.turnstile = {
      render: (_el, params) => {
        renderParams.push(params);
        return "widget-1";
      },
      reset: () => {
        resetCalls += 1;
      },
      remove: () => {
        removeCalls += 1;
      },
    };
  };

  /** Drive the full happy path up to a rendered widget (widgetId assigned). */
  const mountAndRender = () => {
    const cleanup = mountTurnstile();
    formEl.fire("focusin");
    installTurnstile();
    createdScripts[0]?.fire("load");
    return cleanup;
  };

  beforeEach(() => {
    widgetEl = makeEl();
    fallbackEl = makeEl();
    formEl = makeEl();
    widgetEl.form = formEl;
    widgetEl.attrs["data-sitekey"] = "site-key";
    widgetEl.attrs["data-size"] = "normal";
    appended = [];
    createdScripts = [];
    renderParams = [];
    resetCalls = 0;
    removeCalls = 0;
    isDark = false;
    timeouts = [];

    g.CSS = { escape: (s) => s };
    g.window = {
      setTimeout: (fn) => {
        timeouts.push(fn);
        return timeouts.length;
      },
      clearTimeout: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
    };
    g.document = {
      documentElement: { classList: { contains: () => isDark } },
      head: {
        appendChild: (node) => {
          appended.push(node);
        },
      },
      createElement: () => {
        const script = makeEl();
        createdScripts.push(script);
        return script;
      },
      querySelector: (sel) => {
        if (sel.includes("turnstile-fallback")) return fallbackEl;
        if (sel.includes("data-ref='turnstile'")) return widgetEl;
        return null; // script[src=…] dedup → nothing already present
      },
    };
  });

  afterEach(() => {
    g.window = savedWindow;
    g.document = savedDocument;
    g.CSS = savedCSS;
  });

  it("does not load the Turnstile script until the form is engaged", () => {
    const cleanup = mountTurnstile();
    expect(appended).toHaveLength(0);
    cleanup();
  });

  it("loads the script once on the first focusin within the form", () => {
    const cleanup = mountTurnstile();
    formEl.fire("focusin");
    expect(appended).toHaveLength(1);
    expect(createdScripts[0]?.src).toBe(TURNSTILE_SCRIPT_SRC);
    expect(createdScripts[0]?.async).toBe(true);
    formEl.fire("focusin"); // second engagement must not inject a second script
    expect(appended).toHaveLength(1);
    cleanup();
  });

  it("renders the widget with the sitekey, size, and resolved theme when the script loads", () => {
    const cleanup = mountAndRender();
    expect(renderParams).toHaveLength(1);
    expect(renderParams[0]?.sitekey).toBe("site-key");
    expect(renderParams[0]?.size).toBe("normal");
    expect(renderParams[0]?.theme).toBe("light");
    cleanup();
  });

  it("renders with the dark theme when <html> carries the dark class", () => {
    isDark = true;
    const cleanup = mountAndRender();
    expect(renderParams[0]?.theme).toBe("dark");
    cleanup();
  });

  it("resets the single-use token after every submission, clearing the form only on success", () => {
    let formResets = 0;
    formEl.reset = () => {
      formResets += 1;
    };
    const cleanup = mountAndRender();

    formEl.fire("htmx:afterRequest", { detail: { successful: true } });
    expect(resetCalls).toBe(1);
    expect(formResets).toBe(1);

    formEl.fire("htmx:afterRequest", { detail: { successful: false } });
    expect(resetCalls).toBe(2); // token still reset on failure…
    expect(formResets).toBe(1); // …but the fields are preserved for correction
    cleanup();
  });

  it("resets the token when the expired-callback fires", () => {
    const cleanup = mountAndRender();
    (renderParams[0]?.["expired-callback"] as () => void)();
    expect(resetCalls).toBe(1);
    cleanup();
  });

  it("reveals the fallback when the script fails to load", () => {
    const cleanup = mountTurnstile();
    formEl.fire("focusin");
    createdScripts[0]?.fire("error");
    expect(fallbackEl.hidden).toBe(false);
    cleanup();
  });

  it("reveals the fallback when the load times out", () => {
    const cleanup = mountTurnstile();
    formEl.fire("focusin");
    // window.turnstile never becomes available; the scheduled timeout fires the fallback.
    timeouts[0]?.();
    expect(fallbackEl.hidden).toBe(false);
    cleanup();
  });

  it("reveals the fallback when Turnstile's error-callback fires", () => {
    const cleanup = mountAndRender();
    (renderParams[0]?.["error-callback"] as () => void)();
    expect(fallbackEl.hidden).toBe(false);
    cleanup();
  });

  it("is idempotent for the same widget", () => {
    const a = mountTurnstile();
    const b = mountTurnstile();
    expect(a).toBe(b);
    expect(formEl.listeners.focusin).toHaveLength(1);
    a();
  });

  it("returns a no-op cleanup when the widget is missing", () => {
    g.document.querySelector = () => null;
    const cleanup = mountTurnstile();
    expect(() => cleanup()).not.toThrow();
    expect(appended).toHaveLength(0);
  });

  it("returns a no-op cleanup when the widget has no enclosing form", () => {
    widgetEl.form = null;
    const cleanup = mountTurnstile();
    expect(formEl.listeners.focusin).toBeUndefined();
    expect(() => cleanup()).not.toThrow();
  });

  it("cleanup removes the form listeners and the rendered widget", () => {
    const cleanup = mountAndRender();
    cleanup();
    expect(formEl.listeners.focusin).toHaveLength(0);
    expect(formEl.listeners["htmx:afterRequest"]).toHaveLength(0);
    expect(removeCalls).toBe(1);
  });
});
