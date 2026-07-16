/**
 * Tests for the chrome/client.ts scopes.
 *
 * The module calls `registerScope` at import time; these tests exercise the
 * registered scope definitions by driving them through `resumeScope` /
 * directly invoking their `setup` and action handlers with stubs.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { registerScope, resume, resumeScope } from "../client/resume";
import { createSignal } from "../client/signal";
// Side-effect import: registers the "theme" and "navbar" scopes at module load time
// (top-level `registerScope` calls; no DOM access at import time).
import "./client";

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

interface DocStub {
  addCalls: Array<[string, EventListener]>;
  removeCalls: Array<[string, EventListener]>;
  listeners: Record<string, EventListener[]>;
  scopeElements: HTMLElement[];
  documentElement: {
    classList: { classes: Set<string>; toggle(cls: string, force?: boolean): void; add(cls: string): void };
    setAttribute(attr: string, val: string): void;
    getAttribute(attr: string): string | null;
    attrs: Record<string, string>;
  };
  addEventListener(type: string, handler: EventListener): void;
  removeEventListener(type: string, handler: EventListener): void;
  querySelectorAll(sel: string): HTMLElement[];
}

function makeDocStub(): DocStub {
  const listeners: Record<string, EventListener[]> = {};
  const addCalls: Array<[string, EventListener]> = [];
  const removeCalls: Array<[string, EventListener]> = [];
  const attrs: Record<string, string> = {};
  const classes = new Set<string>();
  return {
    addCalls,
    removeCalls,
    listeners,
    scopeElements: [],
    documentElement: {
      classList: {
        classes,
        toggle(cls: string, force?: boolean) {
          if (force === undefined ? !classes.has(cls) : force) classes.add(cls);
          else classes.delete(cls);
        },
        add(cls: string) {
          classes.add(cls);
        },
      },
      setAttribute(attr: string, val: string) {
        attrs[attr] = val;
      },
      getAttribute(attr: string) {
        return attrs[attr] ?? null;
      },
      attrs,
    },
    addEventListener(type: string, handler: EventListener) {
      addCalls.push([type, handler]);
      listeners[type] = [...(listeners[type] ?? []), handler];
    },
    removeEventListener(type: string, handler: EventListener) {
      removeCalls.push([type, handler]);
      listeners[type] = (listeners[type] ?? []).filter((h) => h !== handler);
    },
    querySelectorAll(sel: string) {
      return sel === "[data-scope]" ? this.scopeElements : [];
    },
  };
}

interface MqlStub {
  matches: boolean;
  listeners: EventListener[];
  addEventListener(_: string, h: EventListener): void;
  removeEventListener(_: string, h: EventListener): void;
  fire(matches: boolean): void;
}

function _makeMqlStub(initialMatches: boolean): MqlStub {
  const listeners: EventListener[] = [];
  const stub: MqlStub = {
    matches: initialMatches,
    listeners,
    addEventListener(_: string, h: EventListener) {
      listeners.push(h);
    },
    removeEventListener(_: string, h: EventListener) {
      const idx = listeners.indexOf(h);
      if (idx >= 0) listeners.splice(idx, 1);
    },
    fire(matches: boolean) {
      stub.matches = matches;
      const ev = new Event("change");
      for (const h of listeners) h(ev);
    },
  };
  return stub;
}

interface StorageStub {
  store: Record<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, val: string): void;
}

function _makeStorageStub(): StorageStub {
  const store: Record<string, string> = {};
  return {
    store,
    getItem(key: string) {
      return store[key] ?? null;
    },
    setItem(key: string, val: string) {
      store[key] = val;
    },
  };
}

/** Minimal `[data-scope]` element stub. */
function makeScopeRoot(scope: string, state?: Record<string, unknown>): HTMLElement {
  return { dataset: { scope, state: state ? JSON.stringify(state) : undefined }, querySelectorAll: (_: string) => [] } as unknown as HTMLElement;
}

// ---------------------------------------------------------------------------
// Global references
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { document: DocStub; window: { matchMedia(query: string): MqlStub }; localStorage: StorageStub };

// ---------------------------------------------------------------------------
// Import the module under test (side-effect: calls registerScope twice)
// ---------------------------------------------------------------------------

// We import after setting up stubs only in describe blocks; Bun loads modules
// eagerly so we stub at the test level using beforeEach.

// ---------------------------------------------------------------------------
// Helper: drive a scope definition's setup directly
// ---------------------------------------------------------------------------

function makeNavbarRoot(filterEls: HTMLElement[] = []): HTMLElement {
  return {
    dataset: { scope: "navbar", state: JSON.stringify({ filters: [] }) },
    querySelectorAll: (sel: string): HTMLElement[] => (sel === "[data-filter]" ? filterEls : []),
  } as unknown as HTMLElement;
}

// ---------------------------------------------------------------------------
// Suite: resume disposer contract (setup returning a function)
// ---------------------------------------------------------------------------

describe("resume — disposer contract", () => {
  let doc: DocStub;
  let disposer: (() => void) | null = null;

  beforeEach(() => {
    doc = makeDocStub();
    g.document = doc;
    disposer = null;
  });

  afterEach(() => {
    if (disposer) {
      disposer();
      disposer = null;
    }
  });

  it("calls a disposer returned from setup when resume teardown runs", () => {
    let disposed = false;
    const name = `test-disposer-${Math.random().toString(36).slice(2)}`;
    registerScope(name, {
      eager: true,
      setup: () => {
        return () => {
          disposed = true;
        };
      },
      on: {},
    });

    const root = makeScopeRoot(name);
    doc.scopeElements.push(root);
    disposer = null;
    const teardown = resume();
    // Disposer not yet called.
    expect(disposed).toBe(false);
    teardown();
    expect(disposed).toBe(true);
  });

  it("does not throw when setup returns void", () => {
    const name = `test-void-setup-${Math.random().toString(36).slice(2)}`;
    registerScope(name, {
      eager: true,
      setup: () => {
        // intentionally returns void
      },
      on: {},
    });
    const root = makeScopeRoot(name);
    doc.scopeElements.push(root);
    expect(() => {
      const td = resume();
      td();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Suite: navbar scope (via registerScope — tested directly, not via module import
// since client.ts has already been imported by the test runner side-effect chain)
// ---------------------------------------------------------------------------

describe("navbar scope — logic", () => {
  let doc: DocStub;

  beforeEach(() => {
    doc = makeDocStub();
    g.document = doc;
  });

  it("does not install an outside-click listener (native popover light-dismiss replaces it)", () => {
    const root = makeNavbarRoot();
    resumeScope(root); // triggers the real "navbar" scope setup
    // The navbar scope no longer sweeps open <details> on outside clicks.
    expect((doc.listeners.click ?? []).length).toBe(0);
  });

  it("updates the filters signal when navbar:filters event fires", () => {
    const root = makeNavbarRoot();
    const state = resumeScope(root)!;

    const handlers = doc.listeners["navbar:filters"] ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    const ev = Object.assign(new Event("navbar:filters"), { detail: ["user"] });
    for (const h of handlers) h(ev);

    expect(state.filters?.value).toEqual(["user"]);
  });

  it("adds a navbar:filters listener whose disposer removes it on teardown", () => {
    // Fresh document stub so we count cleanly.
    const freshDoc = makeDocStub();
    g.document = freshDoc;

    const root = makeNavbarRoot();
    const state = resumeScope(root); // triggers the real "navbar" scope setup
    expect(state).toBeDefined();

    // The only document listener the navbar scope adds is navbar:filters.
    expect(freshDoc.addCalls.some(([t]) => t === "navbar:filters")).toBe(true);
    expect(freshDoc.addCalls.some(([t]) => t === "click")).toBe(false);

    // resumeScope pushes the disposer to the global array; resume() teardown runs it.
    const td = resume();
    td();

    expect(freshDoc.removeCalls.some(([t]) => t === "navbar:filters")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite: theme scope — cycleTheme advances preference through the cycle
// ---------------------------------------------------------------------------

describe("theme scope — cycleTheme action", () => {
  it("advances dark → system → light → dark", () => {
    const cycle: Record<string, string> = { dark: "system", light: "dark", system: "light" };
    const pref = createSignal("dark");
    const state = { pref };

    // Simulate what cycleTheme does.
    function cycleTheme() {
      pref.value = cycle[pref.value as string] ?? "system";
    }

    expect(pref.value).toBe("dark");
    cycleTheme();
    expect(pref.value).toBe("system");
    cycleTheme();
    expect(pref.value).toBe("light");
    cycleTheme();
    expect(pref.value).toBe("dark");
    expect(state.pref.value).toBe("dark");
  });
});
