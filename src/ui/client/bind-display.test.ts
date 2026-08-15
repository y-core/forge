import { describe, expect, it } from "bun:test";
import { bindAttr, bindText } from "./bind-display";
import { createSignal } from "./signal";
import type { SignalRecord } from "./signal-record";

/** The slice of `Element` the binders touch, plus the tree walk `queryAcross` performs. */
class FakeElement {
  readonly nodeType = 1;
  readonly attrs = new Map<string, string>();
  readonly children: FakeElement[] = [];
  textContent: string | null = null;
  shadowRoot: FakeElement | null = null;
  /** Counts every write, so a test can prove a no-op write was skipped rather than merely equal. */
  writes = 0;

  constructor(attrs: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(attrs)) this.attrs.set(name, value);
  }

  append(...kids: FakeElement[]): this {
    this.children.push(...kids);
    return this;
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.writes += 1;
    this.attrs.set(name, value);
  }

  removeAttribute(name: string): void {
    this.writes += 1;
    this.attrs.delete(name);
  }

  matches(selector: string): boolean {
    return this.attrs.has(selector.slice(1, -1));
  }

  querySelectorAll(_selector: "*"): FakeElement[] {
    const out: FakeElement[] = [];
    for (const kid of this.children) out.push(kid, ...kid.querySelectorAll("*"));
    return out;
  }
}

/** `textContent` is a plain field on the fake, so writes are counted through an accessor instead. */
function watchText(el: FakeElement): { get: () => string | null; writes: () => number } {
  let value: string | null = null;
  let writes = 0;
  Object.defineProperty(el, "textContent", {
    get: () => value,
    set: (next: string | null) => {
      writes += 1;
      value = next;
    },
  });
  return { get: () => value, writes: () => writes };
}

function root(...children: FakeElement[]): HTMLElement {
  return new FakeElement().append(...children) as unknown as HTMLElement;
}

function signals<T extends Record<string, unknown>>(values: T): SignalRecord<T> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, createSignal(value)])) as SignalRecord<T>;
}

describe("bindText", () => {
  it("writes the signal's value on bind and again on every change", () => {
    const el = new FakeElement({ "data-bind-text": "count" });
    const state = signals({ count: 1 });

    bindText(root(el), state);
    expect(el.textContent).toBe("1");

    state.count.value = 2;
    expect(el.textContent).toBe("2");
  });

  it("renders through the caller's formatter rather than String", () => {
    const el = new FakeElement({ "data-bind-text": "on" });
    const state = signals({ on: true });

    bindText(root(el), state, { format: (value) => (value === true ? "yes" : "no") });

    expect(el.textContent).toBe("yes");
  });

  it("skips a write that would not change the text, so a selection inside it survives", () => {
    const el = new FakeElement({ "data-bind-text": "count" });
    const text = watchText(el);
    const state = signals({ count: 1 });

    bindText(root(el), state);
    expect(text.writes()).toBe(1);

    state.count.value = 1;
    expect(text.writes()).toBe(1);

    state.count.value = 2;
    expect(text.writes()).toBe(2);
  });

  it("stops writing once disposed", () => {
    const el = new FakeElement({ "data-bind-text": "count" });
    const state = signals({ count: 1 });

    bindText(root(el), state)();
    state.count.value = 9;

    expect(el.textContent).toBe("1");
  });

  it("binds several elements to one signal, and each element to its own", () => {
    const a = new FakeElement({ "data-bind-text": "count" });
    const b = new FakeElement({ "data-bind-text": "count" });
    const c = new FakeElement({ "data-bind-text": "name" });
    const state = signals({ count: 1, name: "ada" });

    bindText(root(a, b, c), state);
    state.count.value = 7;

    expect([a.textContent, b.textContent, c.textContent]).toEqual(["7", "7", "ada"]);
  });

  it("reaches an element inside an open shadow root", () => {
    const inner = new FakeElement({ "data-bind-text": "count" });
    const host = new FakeElement();
    host.shadowRoot = new FakeElement().append(inner);
    const state = signals({ count: 3 });

    bindText(root(host), state);

    expect(inner.textContent).toBe("3");
  });

  it("reports an element naming no signal, and leaves the rest bound", () => {
    const bad = new FakeElement({ "data-bind-text": "nope" });
    const good = new FakeElement({ "data-bind-text": "count" });
    const state = signals({ count: 1 });

    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args[0]);
    try {
      bindText(root(bad, good), state);
    } finally {
      console.warn = original;
    }

    expect(warnings).toEqual(['[data-bind-text] "nope" names no signal in this scope']);
    expect(good.textContent).toBe("1");
  });
});

describe("bindAttr", () => {
  it("writes the named attribute on bind and again on every change", () => {
    const el = new FakeElement({ "data-bind-attr": "aria-valuenow:level" });
    const state = signals({ level: 40 });

    bindAttr(root(el), state);
    expect(el.getAttribute("aria-valuenow")).toBe("40");

    state.level.value = 55;
    expect(el.getAttribute("aria-valuenow")).toBe("55");
  });

  it("spells a boolean attribute by presence: true writes empty, false removes", () => {
    const el = new FakeElement({ "data-bind-attr": "hidden:closed" });
    const state = signals({ closed: true });

    bindAttr(root(el), state);
    expect(el.getAttribute("hidden")).toBe("");

    state.closed.value = false;
    expect(el.attrs.has("hidden")).toBe(false);
  });

  it("removes the attribute for null and undefined too", () => {
    for (const empty of [null, undefined]) {
      const el = new FakeElement({ "data-bind-attr": "title:label" });
      const state = signals({ label: "set" as unknown });

      bindAttr(root(el), state);
      expect(el.getAttribute("title")).toBe("set");

      state.label.value = empty;
      expect(el.attrs.has("title")).toBe(false);
    }
  });

  it("splits on the last colon, so a namespaced attribute stays addressable", () => {
    const el = new FakeElement({ "data-bind-attr": "xlink:href:target" });
    const state = signals({ target: "#a" });

    bindAttr(root(el), state);

    expect(el.getAttribute("xlink:href")).toBe("#a");
  });

  it("reports a malformed pair instead of binding it", () => {
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args[0]);
    try {
      bindAttr(root(new FakeElement({ "data-bind-attr": "novalue" }), new FakeElement({ "data-bind-attr": ":field" })), signals({ field: 1 }));
    } finally {
      console.warn = original;
    }

    expect(warnings).toEqual([
      '[data-bind-attr] "novalue" is not an "attribute:field" pair',
      '[data-bind-attr] ":field" is not an "attribute:field" pair',
    ]);
  });

  it("stops writing once disposed", () => {
    const el = new FakeElement({ "data-bind-attr": "title:label" });
    const state = signals({ label: "first" });

    bindAttr(root(el), state)();
    state.label.value = "second";

    expect(el.getAttribute("title")).toBe("first");
  });
});
