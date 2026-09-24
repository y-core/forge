import { describe, expect, it } from "bun:test";

import { mountFragmentObserver, resolveFragmentEntries } from "./fragment-observer";

class FakeElement {
  readonly nodeType = 1;
  private readonly attrs = new Map<string, string>();

  readonly ownerDocument: FakeDocument;
  readonly order: number;

  constructor(ownerDocument: FakeDocument, order = 0) {
    this.ownerDocument = ownerDocument;
    this.order = order;
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  getRootNode(): FakeDocument {
    return this.ownerDocument;
  }

  compareDocumentPosition(other: FakeElement): number {
    return other.order > this.order ? 4 : 2;
  }
}

class FakeObserver {
  static latest: FakeObserver | undefined;
  readonly observed: FakeElement[] = [];
  disconnected = false;

  readonly callback: (records: unknown[]) => void;
  readonly options: unknown;

  constructor(callback: (records: unknown[]) => void, options: unknown) {
    this.callback = callback;
    this.options = options;
    FakeObserver.latest = this;
  }

  observe(el: FakeElement): void {
    this.observed.push(el);
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeDocument {
  readonly nodeType = 9;
  readonly ids = new Map<string, FakeElement>();
  readonly defaultView: { IntersectionObserver?: typeof FakeObserver | undefined } = { IntersectionObserver: FakeObserver };

  getElementById(id: string): FakeElement | null {
    return this.ids.get(id) ?? null;
  }
}

/** A nav whose links carry `hrefs`, over targets named `t-1…t-n` in the order given by `positions`. */
function fixture(hrefs: string[], positions: number[] = []): { doc: FakeDocument; root: Element; targets: FakeElement[] } {
  const doc = new FakeDocument();
  const targets = positions.map((order, index) => {
    const target = new FakeElement(doc, order);
    doc.ids.set(`t-${index + 1}`, target);
    return target;
  });
  const links = hrefs.map((href) => {
    const link = new FakeElement(doc);
    link.setAttribute("href", href);
    return link;
  });
  return { doc, targets, root: { nodeType: 1, ownerDocument: doc, querySelectorAll: () => links } as unknown as Element };
}

const captured = (): { warnings: string[]; run: (body: () => void) => void } => {
  const warnings: string[] = [];
  return {
    warnings,
    run: (body) => {
      const original = console.warn;
      console.warn = (message: string) => warnings.push(message);
      try {
        body();
      } finally {
        console.warn = original;
      }
    },
  };
};

const plan = () => ({ init: {}, onRecords: () => {} });

const config = (root: Element, overrides: Partial<Parameters<typeof mountFragmentObserver>[0]> = {}) => ({
  root,
  selector: "a",
  fn: "mountThing",
  label: "thing",
  requires: "pass the nav",
  emptyTarget: "an element",
  degraded: "nothing will be marked",
  mounted: new WeakMap<Element, () => void>(),
  plan,
  ...overrides,
});

describe("resolveFragmentEntries()", () => {
  it("pairs each fragment link with the element it names", () => {
    const f = fixture(["#t-1", "#t-2"], [0, 1]);
    expect(resolveFragmentEntries(f.root, "a").map((entry) => entry.target)).toEqual(f.targets);
  });

  it("drops a link whose href is not a fragment", () => {
    const f = fixture(["/elsewhere", "#t-1"], [0]);
    expect(resolveFragmentEntries(f.root, "a").map((entry) => entry.target)).toEqual([f.targets[0] as FakeElement]);
  });

  it("drops a fragment that resolves to nothing", () => {
    const f = fixture(["#missing", "#t-1"], [0]);
    expect(resolveFragmentEntries(f.root, "a").map((entry) => entry.target)).toEqual([f.targets[0] as FakeElement]);
  });

  it("keeps one entry per target when two links name the same one", () => {
    const f = fixture(["#t-1", "#t-1"], [0]);
    expect(resolveFragmentEntries(f.root, "a")).toHaveLength(1);
  });

  it("orders by the targets' document position, not by the nav's markup order", () => {
    const f = fixture(["#t-1", "#t-2"], [5, 1]);
    expect(resolveFragmentEntries(f.root, "a").map((entry) => entry.target)).toEqual([f.targets[1], f.targets[0]] as FakeElement[]);
  });
});

describe("mountFragmentObserver()", () => {
  it("observes every resolved target with the plan's own options", () => {
    const f = fixture(["#t-1", "#t-2"], [0, 1]);
    mountFragmentObserver(config(f.root, { plan: () => ({ init: { rootMargin: "1px" }, onRecords: () => {} }) }));

    expect(FakeObserver.latest?.observed).toEqual(f.targets);
    expect(FakeObserver.latest?.options).toEqual({ rootMargin: "1px" });
  });

  it("is idempotent per root — a second mount returns the first disposer", () => {
    const f = fixture(["#t-1"], [0]);
    const mounted = new WeakMap<Element, () => void>();

    const first = mountFragmentObserver(config(f.root, { mounted }));
    expect(mountFragmentObserver(config(f.root, { mounted }))).toBe(first);
  });

  it("disconnects, runs the plan's cleanup and frees the root on dispose", () => {
    const f = fixture(["#t-1"], [0]);
    const mounted = new WeakMap<Element, () => void>();
    let cleaned = false;

    const dispose = mountFragmentObserver(
      config(f.root, { mounted, plan: () => ({ init: {}, onRecords: () => {}, cleanup: () => (cleaned = true) }) }),
    );
    const observer = FakeObserver.latest;
    dispose();

    expect(observer?.disconnected).toBe(true);
    expect(cleaned).toBe(true);
    expect(mountFragmentObserver(config(f.root, { mounted }))).not.toBe(dispose);
  });

  it("warns and returns a working noop when nothing resolves", () => {
    const f = fixture(["#missing"]);
    const log = captured();

    log.run(() => expect(() => mountFragmentObserver(config(f.root))()).not.toThrow());

    expect(log.warnings).toEqual(['[thing] no links matching "a" resolve to an element in this document; nothing to mark']);
  });

  it("warns and returns a working noop when the realm has no IntersectionObserver", () => {
    const f = fixture(["#t-1"], [0]);
    f.doc.defaultView.IntersectionObserver = undefined;
    const log = captured();

    log.run(() => expect(() => mountFragmentObserver(config(f.root))()).not.toThrow());

    expect(log.warnings).toEqual(["[thing] IntersectionObserver is unavailable in this realm; nothing will be marked"]);
  });

  it("returns a working noop when the plan itself refuses, and mounts no observer", () => {
    const f = fixture(["#t-1"], [0]);
    FakeObserver.latest = undefined;

    expect(() => mountFragmentObserver(config(f.root, { plan: () => null }))()).not.toThrow();
    expect(FakeObserver.latest).toBeUndefined();
  });

  it("throws the mounting function's own message when root is missing", () => {
    expect(() => mountFragmentObserver(config(null as unknown as Element))).toThrow("mountThing: `root` is required — pass the nav");
  });
});
