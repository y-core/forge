import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { registerScope, resume } from "./resume";

// The number of event types that resume() installs delegated listeners for.
// Mirrors the EVENTS tuple in resume.ts: ["click", "input", "change", "submit"]
const EVENT_COUNT = 4;

// ---------------------------------------------------------------------------
// Document stub
// ---------------------------------------------------------------------------

interface ListenerRegistry {
  [event: string]: EventListener[];
}

interface DocStub {
  addCalls: Array<[string, EventListener]>;
  removeCalls: Array<[string, EventListener]>;
  listeners: ListenerRegistry;
  addEventListener: (type: string, handler: EventListener) => void;
  removeEventListener: (type: string, handler: EventListener) => void;
}

interface GlobalMock {
  document: DocStub;
}

const g = globalThis as unknown as GlobalMock;

function makeDocStub(): DocStub {
  const listeners: ListenerRegistry = {};
  const addCalls: Array<[string, EventListener]> = [];
  const removeCalls: Array<[string, EventListener]> = [];

  return {
    addCalls,
    removeCalls,
    listeners,
    addEventListener(type, handler) {
      addCalls.push([type, handler]);
      listeners[type] = [...(listeners[type] ?? []), handler];
    },
    removeEventListener(type, handler) {
      removeCalls.push([type, handler]);
      listeners[type] = (listeners[type] ?? []).filter((h) => h !== handler);
    },
  };
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

    expect(doc.addCalls).toHaveLength(EVENT_COUNT);
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

    expect(doc.removeCalls).toHaveLength(EVENT_COUNT);

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

    // Second mount must add EVENT_COUNT more listeners (total 2 × EVENT_COUNT).
    currentDisposer = resume();

    expect(doc.addCalls).toHaveLength(EVENT_COUNT * 2);

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
});
