import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { registerScope, resume, resumeScope } from "./resume";

// The number of scope-event types resume() installs delegated listeners for.
// Mirrors SCOPE_EVENTS in ../scope-events.ts: ["click", "input", "change", "submit"]
const EVENT_COUNT = 4;
// resume() also installs one `command` listener for the native Invoker Commands bridge.
const TOTAL_LISTENERS = EVENT_COUNT + 1;

// ---------------------------------------------------------------------------
// Document stub
// ---------------------------------------------------------------------------

interface ListenerRegistry {
  [event: string]: EventListener[];
}

interface DocStub {
  addCalls: Array<[string, EventListener, boolean]>;
  removeCalls: Array<[string, EventListener]>;
  listeners: ListenerRegistry;
  /** Elements returned from `querySelectorAll("[data-scope]")` — drives the eager-resume pass. */
  scopeElements: HTMLElement[];
  addEventListener: (type: string, handler: EventListener, options?: boolean | AddEventListenerOptions) => void;
  removeEventListener: (type: string, handler: EventListener, options?: boolean | EventListenerOptions) => void;
  querySelectorAll: (sel: string) => HTMLElement[];
}

interface GlobalMock {
  document: DocStub;
}

const g = globalThis as unknown as GlobalMock;

function makeDocStub(): DocStub {
  const listeners: ListenerRegistry = {};
  const addCalls: Array<[string, EventListener, boolean]> = [];
  const removeCalls: Array<[string, EventListener]> = [];
  const scopeElements: HTMLElement[] = [];

  return {
    addCalls,
    removeCalls,
    listeners,
    scopeElements,
    addEventListener(type, handler, options) {
      const capture = typeof options === "boolean" ? options : (options?.capture ?? false);
      addCalls.push([type, handler, capture]);
      listeners[type] = [...(listeners[type] ?? []), handler];
    },
    removeEventListener(type, handler) {
      removeCalls.push([type, handler]);
      listeners[type] = (listeners[type] ?? []).filter((h) => h !== handler);
    },
    querySelectorAll(sel) {
      return sel === "[data-scope]" ? scopeElements : [];
    },
  };
}

/** Minimal `[data-scope]` element stub: just the `dataset` fields the resume runtime reads. */
function makeScopeRoot(scope: string, state?: Record<string, unknown>): HTMLElement {
  return { dataset: { scope, state: state ? JSON.stringify(state) : undefined } } as unknown as HTMLElement;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a synthetic Event whose target has a working `closest` stub. */
function makeSyntheticEvent(type: string, target: { closest: (sel: string) => unknown }): Event {
  const ev = new Event(type, { bubbles: true });
  Object.defineProperty(ev, "target", { value: target, configurable: true });
  return ev;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("resume", () => {
  let doc: DocStub;
  let currentDisposer: (() => void) | null = null;

  beforeEach(() => {
    doc = makeDocStub();
    g.document = doc;
    currentDisposer = null;
  });

  afterEach(() => {
    // Always tear down any mounted listeners so the module-level `teardown`
    // variable is reset to null before the next test.
    if (currentDisposer) {
      currentDisposer();
      currentDisposer = null;
    }
  });

  // -------------------------------------------------------------------------
  // 1. Idempotency: second call does not register extra listeners
  // -------------------------------------------------------------------------
  it("is idempotent: a second call before teardown does not add extra listeners", () => {
    currentDisposer = resume();
    resume(); // second call — must be a no-op

    expect(doc.addCalls).toHaveLength(TOTAL_LISTENERS);
  });

  // -------------------------------------------------------------------------
  // 2. Second call returns the same disposer function reference
  // -------------------------------------------------------------------------
  it("returns the same disposer on a second call before teardown", () => {
    currentDisposer = resume();
    const second = resume();

    expect(second).toBe(currentDisposer);
  });

  // -------------------------------------------------------------------------
  // 3. Teardown removes exactly the registered listeners
  // -------------------------------------------------------------------------
  it("teardown removes all registered listeners", () => {
    const disposer = resume();
    currentDisposer = null; // we will call it manually below

    disposer();

    expect(doc.removeCalls).toHaveLength(TOTAL_LISTENERS);

    // Every type that was added must also be removed (same handler reference).
    for (const [addType, addHandler] of doc.addCalls) {
      const removed = doc.removeCalls.some(([rt, rh]) => rt === addType && rh === addHandler);
      expect(removed).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // 4. Re-mount after teardown installs a fresh set of listeners
  // -------------------------------------------------------------------------
  it("re-mount after teardown installs a fresh set of listeners and returns a distinct disposer", () => {
    const firstDisposer = resume();
    firstDisposer(); // explicit teardown resets module-level state

    // Second mount must add a fresh full set of listeners (total 2 × TOTAL_LISTENERS).
    currentDisposer = resume();

    expect(doc.addCalls).toHaveLength(TOTAL_LISTENERS * 2);

    // The new disposer must be a different function object.
    expect(currentDisposer).not.toBe(firstDisposer);
  });

  // -------------------------------------------------------------------------
  // 5. Single dispatched event fires the registered handler exactly once
  // -------------------------------------------------------------------------
  it("fires the scope handler exactly once on a single synthetic event dispatch", () => {
    // Register a scope with a click handler that counts invocations.
    let callCount = 0;
    const scopeName = `test-scope-resume-${Math.random().toString(36).slice(2)}`;
    registerScope(scopeName, {
      on: {
        "do-thing": () => {
          callCount++;
        },
      },
    });

    currentDisposer = resume();

    // Build mock elements matching what dispatch() expects:
    //   el   — has data-on-click="do-thing" and a closest("[data-scope]") that returns root
    //   root — has dataset.scope === scopeName
    const root = {
      dataset: { scope: scopeName, state: undefined as string | undefined },
      closest: (sel: string) => (sel === "[data-scope]" ? root : null),
      getAttribute: (_k: string) => null,
    };

    const el = {
      closest: (sel: string) => {
        if (sel === "[data-on-click]") return el;
        if (sel === "[data-scope]") return root;
        return null;
      },
      getAttribute: (k: string) => (k === "data-on-click" ? "do-thing" : null),
      dataset: {},
    };

    // event.target.closest("[data-on-click]") is how dispatch locates `el`.
    const target = { closest: (sel: string) => (sel === "[data-on-click]" ? el : null) };

    const event = makeSyntheticEvent("click", target);

    // Invoke each installed "click" listener (should be exactly one).
    const clickListeners = doc.listeners.click ?? [];
    expect(clickListeners).toHaveLength(1);

    clickListeners[0]!(event);

    expect(callCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 6. Eager pass: resume() hydrates an eager scope at install time (no interaction)
  // -------------------------------------------------------------------------
  it("eager-resumes a scope whose def has eager:true during resume()", () => {
    let setupRuns = 0;
    const scopeName = `test-eager-${Math.random().toString(36).slice(2)}`;
    registerScope(scopeName, {
      eager: true,
      setup: () => {
        setupRuns++;
      },
      on: {},
    });

    doc.scopeElements.push(makeScopeRoot(scopeName));

    currentDisposer = resume();

    // setup ran with zero interaction.
    expect(setupRuns).toBe(1);
  });

  it("does not eager-resume a scope without eager:true", () => {
    let setupRuns = 0;
    const scopeName = `test-lazy-${Math.random().toString(36).slice(2)}`;
    registerScope(scopeName, {
      setup: () => {
        setupRuns++;
      },
      on: {},
    });

    doc.scopeElements.push(makeScopeRoot(scopeName));

    currentDisposer = resume();

    expect(setupRuns).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 7. Generic registerScope<"foo"> still dispatches its action
  // -------------------------------------------------------------------------
  it("dispatches an action from a scope registered with a generic action union", () => {
    let called = false;
    const scopeName = `test-generic-${Math.random().toString(36).slice(2)}`;
    registerScope<"foo">(scopeName, {
      on: {
        foo: () => {
          called = true;
        },
      },
    });

    currentDisposer = resume();

    const root = {
      dataset: { scope: scopeName, state: undefined as string | undefined },
      closest: (sel: string) => (sel === "[data-scope]" ? root : null),
      getAttribute: () => null,
    };
    const el = {
      closest: (sel: string) => {
        if (sel === "[data-on-click]") return el;
        if (sel === "[data-scope]") return root;
        return null;
      },
      getAttribute: (k: string) => (k === "data-on-click" ? "foo" : null),
      dataset: {},
    };
    const target = { closest: (sel: string) => (sel === "[data-on-click]" ? el : null) };

    doc.listeners.click![0]!(makeSyntheticEvent("click", target));

    expect(called).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 8. Bubbling: unhandled action walks up to the enclosing scope
  // -------------------------------------------------------------------------
  it("bubbles an unhandled action from an inner scope to the outer scope", () => {
    let outerCalled = false;
    const outerScopeName = `test-outer-${Math.random().toString(36).slice(2)}`;
    const innerScopeName = `test-inner-${Math.random().toString(36).slice(2)}`;

    registerScope(outerScopeName, {
      on: {
        "bubble-action": () => {
          outerCalled = true;
        },
      },
    });
    registerScope(innerScopeName, { on: {} }); // no handler — should bubble

    currentDisposer = resume();

    const outerRoot = {
      dataset: { scope: outerScopeName, state: undefined as string | undefined },
      closest: (sel: string) => (sel === "[data-scope]" ? outerRoot : null),
      parentElement: { closest: (_s: string) => null },
    };
    const innerRoot = {
      dataset: { scope: innerScopeName, state: undefined as string | undefined },
      closest: (sel: string) => (sel === "[data-scope]" ? innerRoot : null),
      parentElement: { closest: (_s: string) => outerRoot },
    };
    const el = {
      closest: (sel: string) => {
        if (sel === "[data-on-click]") return el;
        if (sel === "[data-scope]") return innerRoot;
        return null;
      },
      getAttribute: (k: string) => (k === "data-on-click" ? "bubble-action" : null),
      dataset: {},
    };
    const target = { closest: (sel: string) => (sel === "[data-on-click]" ? el : null) };

    doc.listeners.click![0]!(makeSyntheticEvent("click", target));

    expect(outerCalled).toBe(true);
  });

  it("fires the inner scope handler when it owns the action (does not bubble to outer)", () => {
    let innerCalled = false;
    let outerCalled = false;
    const outerScopeName = `test-outer-stop-${Math.random().toString(36).slice(2)}`;
    const innerScopeName = `test-inner-stop-${Math.random().toString(36).slice(2)}`;

    registerScope(outerScopeName, {
      on: {
        "stop-action": () => {
          outerCalled = true;
        },
      },
    });
    registerScope(innerScopeName, {
      on: {
        "stop-action": () => {
          innerCalled = true;
        },
      },
    });

    currentDisposer = resume();

    const outerRoot = {
      dataset: { scope: outerScopeName, state: undefined as string | undefined },
      closest: (sel: string) => (sel === "[data-scope]" ? outerRoot : null),
      parentElement: { closest: (_s: string) => null },
    };
    const innerRoot = {
      dataset: { scope: innerScopeName, state: undefined as string | undefined },
      closest: (sel: string) => (sel === "[data-scope]" ? innerRoot : null),
      parentElement: { closest: (_s: string) => outerRoot },
    };
    const el = {
      closest: (sel: string) => {
        if (sel === "[data-on-click]") return el;
        if (sel === "[data-scope]") return innerRoot;
        return null;
      },
      getAttribute: (k: string) => (k === "data-on-click" ? "stop-action" : null),
      dataset: {},
    };
    const target = { closest: (sel: string) => (sel === "[data-on-click]" ? el : null) };

    doc.listeners.click![0]!(makeSyntheticEvent("click", target));

    expect(innerCalled).toBe(true);
    expect(outerCalled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Native Invoker Commands bridge
  // -------------------------------------------------------------------------
  it("routes a --command CommandEvent to the scope handler via event.source", () => {
    let called = 0;
    const scopeName = `test-command-${Math.random().toString(36).slice(2)}`;
    registerScope(scopeName, {
      on: {
        "do-thing": () => {
          called++;
        },
      },
    });

    currentDisposer = resume();

    const root = {
      dataset: { scope: scopeName, state: undefined as string | undefined },
      closest: (sel: string) => (sel === "[data-scope]" ? root : null),
      parentElement: { closest: (_s: string) => null },
    };
    // event.source is the invoker button — the bridge uses it as `el`, so it must resolve its scope.
    const source = { closest: (sel: string) => (sel === "[data-scope]" ? root : null), dataset: {} };
    const event = Object.assign(new Event("command", { bubbles: true }), { command: "--do-thing", source });

    const commandListeners = doc.listeners.command ?? [];
    expect(commandListeners).toHaveLength(1);
    commandListeners[0]!(event as unknown as Event);

    expect(called).toBe(1);
  });

  it("registers the command bridge in the capture phase (native command events do not bubble)", () => {
    currentDisposer = resume();

    const commandAdd = doc.addCalls.find(([type]) => type === "command");
    expect(commandAdd?.[2]).toBe(true);
    // The scope events stay in the bubble phase — only the command bridge captures.
    const scopeAdds = doc.addCalls.filter(([type]) => type !== "command");
    expect(scopeAdds.every(([, , capture]) => capture === false)).toBe(true);
  });

  it("ignores built-in commands with no -- prefix", () => {
    let called = 0;
    const scopeName = `test-builtin-${Math.random().toString(36).slice(2)}`;
    registerScope(scopeName, {
      on: {
        "toggle-popover": () => {
          called++;
        },
      },
    });

    currentDisposer = resume();

    const root = {
      dataset: { scope: scopeName, state: undefined as string | undefined },
      closest: (sel: string) => (sel === "[data-scope]" ? root : null),
      parentElement: { closest: (_s: string) => null },
    };
    const source = { closest: (sel: string) => (sel === "[data-scope]" ? root : null), dataset: {} };
    const event = Object.assign(new Event("command"), { command: "toggle-popover", source });

    (doc.listeners.command ?? [])[0]!(event as unknown as Event);

    expect(called).toBe(0);
  });

  it("ignores a --command whose source is null", () => {
    const scopeName = `test-nosource-${Math.random().toString(36).slice(2)}`;
    registerScope(scopeName, { on: { x: () => {} } });
    currentDisposer = resume();
    const event = Object.assign(new Event("command"), { command: "--x", source: null });
    expect(() => (doc.listeners.command ?? [])[0]!(event as unknown as Event)).not.toThrow();
  });

  it("single-scope dispatch still fires when there is no parent scope (regression)", () => {
    let called = false;
    const scopeName = `test-single-bubble-${Math.random().toString(36).slice(2)}`;
    registerScope(scopeName, {
      on: {
        "solo-action": () => {
          called = true;
        },
      },
    });

    currentDisposer = resume();

    const root = {
      dataset: { scope: scopeName, state: undefined as string | undefined },
      closest: (sel: string) => (sel === "[data-scope]" ? root : null),
      parentElement: { closest: (_s: string) => null },
    };
    const el = {
      closest: (sel: string) => {
        if (sel === "[data-on-click]") return el;
        if (sel === "[data-scope]") return root;
        return null;
      },
      getAttribute: (k: string) => (k === "data-on-click" ? "solo-action" : null),
      dataset: {},
    };
    const target = { closest: (sel: string) => (sel === "[data-on-click]" ? el : null) };

    doc.listeners.click![0]!(makeSyntheticEvent("click", target));

    expect(called).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Part C: a setup-only scope declared with NO `on` field dispatches gracefully
  // -------------------------------------------------------------------------
  it("dispatches an unknown action to a setup-only scope (no `on`) without throwing", () => {
    let setupRuns = 0;
    const scopeName = `test-no-on-dispatch-${Math.random().toString(36).slice(2)}`;
    registerScope(scopeName, {
      setup: () => {
        setupRuns++;
      },
    });

    currentDisposer = resume();

    const root = {
      dataset: { scope: scopeName, state: undefined as string | undefined },
      closest: (sel: string) => (sel === "[data-scope]" ? root : null),
      parentElement: { closest: (_s: string) => null },
    };
    const el = {
      closest: (sel: string) => {
        if (sel === "[data-on-click]") return el;
        if (sel === "[data-scope]") return root;
        return null;
      },
      getAttribute: (k: string) => (k === "data-on-click" ? "whatever" : null),
      dataset: {},
    };
    const target = { closest: (sel: string) => (sel === "[data-on-click]" ? el : null) };

    expect(() => doc.listeners.click![0]!(makeSyntheticEvent("click", target))).not.toThrow();
    // setup still ran (scope resumed on the way even though no handler matched).
    expect(setupRuns).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Part E: resume() warns for an unregistered data-scope element
// ---------------------------------------------------------------------------

describe("resume — unregistered scope warning", () => {
  let doc: DocStub;
  let currentDisposer: (() => void) | null = null;
  let warnCalls: string[];
  const originalWarn = console.warn;

  beforeEach(() => {
    doc = makeDocStub();
    g.document = doc;
    currentDisposer = null;
    warnCalls = [];
    console.warn = ((...args: unknown[]) => {
      warnCalls.push(String(args[0]));
    }) as typeof console.warn;
  });

  afterEach(() => {
    console.warn = originalWarn;
    if (currentDisposer) {
      currentDisposer();
      currentDisposer = null;
    }
  });

  it("warns exactly once for repeated unregistered data-scope elements", () => {
    const unknownName = `unregistered-${Math.random().toString(36).slice(2)}`;
    doc.scopeElements.push(makeScopeRoot(unknownName), makeScopeRoot(unknownName));

    currentDisposer = resume();

    const matching = warnCalls.filter((m) => m.includes(unknownName));
    expect(matching).toHaveLength(1);
  });

  it("does not warn for a registered data-scope element", () => {
    const knownName = `registered-${Math.random().toString(36).slice(2)}`;
    registerScope(knownName, {
      setup: () => {
        // registered — no warning expected
      },
    });
    doc.scopeElements.push(makeScopeRoot(knownName));

    currentDisposer = resume();

    const matching = warnCalls.filter((m) => m.includes(knownName));
    expect(matching).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// resumeScope — imperative single-scope resume
// ---------------------------------------------------------------------------

describe("resumeScope", () => {
  let doc: DocStub;

  beforeEach(() => {
    doc = makeDocStub();
    g.document = doc;
  });

  it("hydrates data-state into signals and runs setup once", () => {
    let setupRuns = 0;
    const scopeName = `test-resumescope-${Math.random().toString(36).slice(2)}`;
    registerScope(scopeName, {
      setup: () => {
        setupRuns++;
      },
      on: {},
    });

    const root = makeScopeRoot(scopeName, { query: "hello" });
    const state = resumeScope(root);

    expect(setupRuns).toBe(1);
    expect(state?.query?.value).toBe("hello");
  });

  it("is idempotent: a second call returns the same state without re-running setup", () => {
    let setupRuns = 0;
    const scopeName = `test-resumescope-idem-${Math.random().toString(36).slice(2)}`;
    registerScope(scopeName, {
      setup: () => {
        setupRuns++;
      },
      on: {},
    });

    const root = makeScopeRoot(scopeName, { n: 1 });
    const first = resumeScope(root);
    const second = resumeScope(root);

    expect(setupRuns).toBe(1);
    expect(second).toBe(first);
  });

  it("returns undefined when the element names no registered scope", () => {
    const root = makeScopeRoot(`unregistered-${Math.random().toString(36).slice(2)}`);
    expect(resumeScope(root)).toBeUndefined();
  });

  it("registers and resumes a setup-only scope declared with no `on` field", () => {
    let setupRuns = 0;
    const scopeName = `test-no-on-${Math.random().toString(36).slice(2)}`;
    registerScope(scopeName, {
      setup: () => {
        setupRuns++;
      },
    });

    const root = makeScopeRoot(scopeName, { q: "x" });
    let state: ReturnType<typeof resumeScope>;
    expect(() => {
      state = resumeScope(root);
    }).not.toThrow();

    expect(setupRuns).toBe(1);
    expect(state?.q?.value).toBe("x");
  });
});
