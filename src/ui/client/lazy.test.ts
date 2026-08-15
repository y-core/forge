import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { lazy } from "./lazy";

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

  it("reports a load rejection when no onError is supplied, rather than dropping it", async () => {
    const seen: unknown[] = [];
    const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      seen.push(args[1]);
    });
    try {
      const dispose = lazy({ ref: "target", load: () => Promise.reject(new Error("chunk fetch failed")), init: () => {} });
      intersect();
      await flush();
      expect(() => dispose()).not.toThrow();
    } finally {
      spy.mockRestore();
    }

    expect(seen.map((error) => (error as Error).message)).toContain("chunk fetch failed");
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
