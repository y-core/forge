import { describe, expect, it } from "bun:test";

import { mountCarouselDots } from "./carousel";

interface Records {
  target: FakeElement;
  intersectionRatio: number;
}

class FakeElement {
  readonly nodeType = 1;
  private readonly attrs = new Map<string, string>();

  readonly ownerDocument: FakeDocument;
  /** The strip `closest()` resolves to, or `null` for an element outside one. */
  readonly strip: FakeElement | null;
  /** Document position, which the shared resolver sorts entries by. */
  readonly order: number;

  constructor(ownerDocument: FakeDocument, strip: FakeElement | null = null, order = 0) {
    this.ownerDocument = ownerDocument;
    this.strip = strip;
    this.order = order;
  }

  compareDocumentPosition(other: FakeElement): number {
    return other.order > this.order ? 4 : 2;
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

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  getRootNode(): FakeDocument {
    return this.ownerDocument;
  }

  /** Only the strip lookup is under test, so the selector is not matched — the fixture wires it. */
  closest(): FakeElement | null {
    return this.strip;
  }
}

class FakeObserver {
  static latest: FakeObserver | undefined;
  readonly observed: FakeElement[] = [];
  readonly options: { root?: unknown; threshold?: unknown };
  disconnected = false;

  readonly callback: (records: Records[]) => void;

  constructor(callback: (records: Records[]) => void, options: { root?: unknown; threshold?: unknown } = {}) {
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

  emit(records: Records[]): void {
    this.callback(records);
  }
}

class FakeDocument {
  readonly nodeType = 9;
  readonly ids = new Map<string, FakeElement>();
  readonly defaultView = { IntersectionObserver: FakeObserver };

  getElementById(id: string): FakeElement | null {
    return this.ids.get(id) ?? null;
  }
}

const ON = "dot-on";
const OFF = "dot-off";

interface Fixture {
  doc: FakeDocument;
  root: Element;
  strip: FakeElement;
  dots: FakeElement[];
  slides: FakeElement[];
  observer: () => FakeObserver;
  marked: () => number[];
  classes: () => (string | null)[];
}

/** A dots nav over `count` slides, with the dot at `current` rendered selected as the server would. */
function fixture(count: number, current = 0, options: { slides?: number; inStrip?: boolean } = {}): Fixture {
  const doc = new FakeDocument();
  const strip = new FakeElement(doc);
  const slideCount = options.slides ?? count;

  const slides = Array.from({ length: slideCount }, (_, index) => {
    const slide = new FakeElement(doc, options.inStrip === false ? null : strip, index);
    doc.ids.set(`s-${index + 1}`, slide);
    return slide;
  });

  const dots = Array.from({ length: count }, (_, index) => {
    const dot = new FakeElement(doc);
    dot.setAttribute("href", `#s-${index + 1}`);
    dot.setAttribute("class", index === current ? ON : OFF);
    if (index === current) {
      dot.setAttribute("aria-current", "page");
      dot.setAttribute("data-selected", "");
    }
    return dot;
  });

  const root = { nodeType: 1, ownerDocument: doc, querySelectorAll: () => dots } as unknown as Element;

  return {
    doc,
    root,
    strip,
    dots,
    slides,
    observer: () => FakeObserver.latest as FakeObserver,
    marked: () => dots.flatMap((dot, index) => (dot.getAttribute("aria-current") === "page" ? [index] : [])),
    classes: () => dots.map((dot) => dot.getAttribute("class")),
  };
}

describe("mountCarouselDots", () => {
  it("observes every slide inside the strip, against the strip", () => {
    const f = fixture(3);
    mountCarouselDots({ root: f.root });

    expect(f.observer().observed).toEqual(f.slides);
    expect(f.observer().options.root).toBe(f.strip);
  });

  it("hands the marker to the most-visible slide's dot, and only that one", () => {
    const f = fixture(3);
    mountCarouselDots({ root: f.root });

    f.observer().emit([
      { target: f.slides[0] as FakeElement, intersectionRatio: 0.25 },
      { target: f.slides[1] as FakeElement, intersectionRatio: 1 },
    ]);

    expect(f.marked()).toEqual([1]);
    expect(f.dots[1]?.getAttribute("data-selected")).toBe("");
    expect(f.dots[0]?.getAttribute("data-selected")).toBeNull();
  });

  it("moves the server's selected class onto the new dot and the idle one onto the old", () => {
    const f = fixture(3);
    mountCarouselDots({ root: f.root });

    f.observer().emit([
      { target: f.slides[0] as FakeElement, intersectionRatio: 0 },
      { target: f.slides[2] as FakeElement, intersectionRatio: 1 },
    ]);

    expect(f.classes()).toEqual([OFF, OFF, ON]);
  });

  it("keeps the last marking while no slide is visible, rather than blanking the row mid-scroll", () => {
    const f = fixture(3);
    mountCarouselDots({ root: f.root });

    f.observer().emit([{ target: f.slides[1] as FakeElement, intersectionRatio: 1 }]);
    f.observer().emit([{ target: f.slides[1] as FakeElement, intersectionRatio: 0 }]);

    expect(f.marked()).toEqual([1]);
    expect(f.classes()).toEqual([OFF, ON, OFF]);
  });

  it("skips a dot whose fragment resolves to nothing rather than throwing", () => {
    const f = fixture(3, 0, { slides: 2 });
    mountCarouselDots({ root: f.root });

    expect(f.observer().observed).toHaveLength(2);

    f.observer().emit([{ target: f.slides[1] as FakeElement, intersectionRatio: 1 }]);

    expect(f.marked()).toEqual([1]);
  });

  it("is idempotent per nav — a second mount returns the same disposer", () => {
    const f = fixture(2);

    const first = mountCarouselDots({ root: f.root });
    const observer = f.observer();
    const second = mountCarouselDots({ root: f.root });

    expect(second).toBe(first);
    expect(f.observer()).toBe(observer);
  });

  it("disconnects on dispose and re-mounts after it", () => {
    const f = fixture(2);
    const first = mountCarouselDots({ root: f.root });

    first();

    expect(f.observer().disconnected).toBe(true);
    expect(mountCarouselDots({ root: f.root })).not.toBe(first);
  });

  it("returns a working no-op when no dot resolves to a slide", () => {
    const f = fixture(0);

    const dispose = mountCarouselDots({ root: f.root });

    expect(() => dispose()).not.toThrow();
  });

  it("returns a working no-op when the slides sit outside any strip", () => {
    const f = fixture(2, 0, { inStrip: false });

    const dispose = mountCarouselDots({ root: f.root });

    expect(() => dispose()).not.toThrow();
    expect(f.marked()).toEqual([0]);
  });

  it("returns a working no-op when the realm has no IntersectionObserver", () => {
    const f = fixture(2);
    const view = f.doc.defaultView as { IntersectionObserver?: typeof FakeObserver | undefined };
    view.IntersectionObserver = undefined;

    const dispose = mountCarouselDots({ root: f.root });

    expect(() => dispose()).not.toThrow();
    expect(f.marked()).toEqual([0]);
  });

  it("throws when the call names no nav", () => {
    expect(() => mountCarouselDots({ root: null as unknown as Element })).toThrow(
      "mountCarouselDots: `root` is required — pass the nav rendered by `Carousel.Dots`",
    );
  });
});

// Both come from the resolver `scroll-spy` already carried and `carousel` used to clone without.
describe("mountCarouselDots — the two fixes the shared resolver brings", () => {
  it("observes a slide once when two dots point at it, rather than twice", () => {
    const f = fixture(2);
    f.dots[1]?.setAttribute("href", "#s-1");

    mountCarouselDots({ root: f.root });

    expect(f.observer().observed).toEqual([f.slides[0] as FakeElement]);
  });

  it("orders entries by the slides' document position, not by the dots' markup order", () => {
    const f = fixture(3);
    f.dots[0]?.setAttribute("href", "#s-3");
    f.dots[2]?.setAttribute("href", "#s-1");

    mountCarouselDots({ root: f.root });

    expect(f.observer().observed).toEqual([f.slides[0], f.slides[1], f.slides[2]] as FakeElement[]);
  });
});

describe("mountCarouselDots — a row the server marked no dot on", () => {
  // `Carousel.Dots` takes `current` as an unclamped public `number`, so `current={-1}` used to mark
  // no dot at all: `on` came back `undefined`, every class write was skipped while `mark` still ran,
  // and the row settled unselected forever without a word. The two adjacent failures both warn.
  it("warns and mounts nothing rather than driving a row it cannot paint", () => {
    const f = fixture(3, -1);
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message: string) => warnings.push(message);
    try {
      const dispose = mountCarouselDots({ root: f.root });
      dispose();
    } finally {
      console.warn = original;
    }

    expect(warnings.length).toBe(1);
    expect(warnings[0]?.startsWith("[carousel-dots] no dot carries data-selected")).toBe(true);
    expect(f.classes()).toEqual([OFF, OFF, OFF]);
    expect(f.marked()).toEqual([]);
  });
});
