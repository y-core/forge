import { beforeEach, describe, expect, it } from "bun:test";
import { lazy } from "./lazy-import";

interface MockObserver {
  observe: (el: Element) => void;
  disconnect: () => void;
}

type ObserverConstructor = new (
  callback: IntersectionObserverCallback,
  options?: IntersectionObserverInit,
) => MockObserver;

interface GlobalMock {
  document: {
    querySelector: (selector: string) => Element | null;
  };
  IntersectionObserver: ObserverConstructor;
}

const g = globalThis as unknown as GlobalMock;

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

  g.document = {
    querySelector: (selector: string) =>
      selector === "[data-ref='target']" ? mockElement : null,
  };

  // biome-ignore lint/complexity/useArrowFunction: arrow functions cannot be constructed with `new`
  g.IntersectionObserver = function (
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ): MockObserver {
    capturedCallback = callback;
    capturedOptions = options;
    return {
      observe: (el: Element) => { observedElements.push(el); },
      disconnect: () => { disconnectCount++; },
    };
  } as unknown as ObserverConstructor;
});

function makeEntry(isIntersecting: boolean): IntersectionObserverEntry {
  return { isIntersecting } as IntersectionObserverEntry;
}

describe("lazy", () => {
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
      init: (m, el) => { initMod = m; initEl = el; },
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
      init: (_m, el) => { receivedEl = el; },
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
    g.document.querySelector = () => null;
    const dispose = lazy({ ref: "missing", load: () => Promise.resolve({}), init: () => {} });
    expect(observedElements).toHaveLength(0);
    expect(() => dispose()).not.toThrow();
  });

  it("passes rootMargin to the IntersectionObserver constructor", () => {
    lazy({
      ref: "target",
      rootMargin: "200px",
      load: () => Promise.resolve({}),
      init: () => {},
    });
    expect(capturedOptions?.rootMargin).toBe("200px");
  });

  it("passes threshold to the IntersectionObserver constructor", () => {
    lazy({
      ref: "target",
      threshold: 0.5,
      load: () => Promise.resolve({}),
      init: () => {},
    });
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
      init: () => { initCalled = true; },
    });
    capturedCallback([makeEntry(false)], {} as IntersectionObserver);
    await Promise.resolve();
    expect(initCalled).toBe(false);
  });
});
