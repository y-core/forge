import { describe, expect, it } from "bun:test";
import { mountScrollSpy } from "./scroll-spy";

/**
 * `bun test` runs in a pristine Bun realm with no DOM, so the fixture below is a hand-built one —
 * just the surface `mountScrollSpy` touches. What is proven here is the bookkeeping: which link
 * carries the marker, that only one ever does, and that nothing throws on a fragment pointing
 * nowhere. Real intersection behaviour is the browser set's (`scroll-spy.browser.ts`).
 */

interface Records {
  target: FakeElement;
  isIntersecting: boolean;
}

class FakeElement {
  readonly nodeType = 1;
  private readonly attrs = new Map<string, string>();

  readonly ownerDocument: FakeDocument;
  readonly order: number;

  constructor(ownerDocument: FakeDocument, order: number) {
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

  /** Only the `DOCUMENT_POSITION_FOLLOWING` bit (4) matters to the sort under test. */
  compareDocumentPosition(other: FakeElement): number {
    return other.order > this.order ? 4 : 2;
  }
}

class FakeObserver {
  static latest: FakeObserver | undefined;
  readonly observed: FakeElement[] = [];
  disconnected = false;

  readonly callback: (records: Records[]) => void;

  constructor(callback: (records: Records[]) => void) {
    this.callback = callback;
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

interface Fixture {
  doc: FakeDocument;
  root: Element;
  links: FakeElement[];
  sections: FakeElement[];
  observer: () => FakeObserver;
  marked: () => string[];
}

/** A nav of fragment links over `hrefs`, with a section for every id in `sectionIds`. */
function fixture(hrefs: string[], sectionIds: string[] = hrefs.map((href) => href.slice(1))): Fixture {
  const doc = new FakeDocument();
  let order = 0;

  const sections = sectionIds.map((id) => {
    const section = new FakeElement(doc, ++order);
    doc.ids.set(id, section);
    return section;
  });

  const links = hrefs.map((href) => {
    const link = new FakeElement(doc, ++order);
    link.setAttribute("href", href);
    return link;
  });

  const root = { nodeType: 1, ownerDocument: doc, querySelectorAll: () => links } as unknown as Element;

  return {
    doc,
    root,
    links,
    sections,
    observer: () => FakeObserver.latest as FakeObserver,
    marked: () => hrefs.filter((_, i) => links[i]?.getAttribute("aria-current") === "location"),
  };
}

describe("mountScrollSpy", () => {
  it("marks the intersecting section's link with aria-current='location'", () => {
    const f = fixture(["#one", "#two"]);
    mountScrollSpy({ root: f.root });

    f.observer().emit([{ target: f.sections[1] as FakeElement, isIntersecting: true }]);

    expect(f.marked()).toEqual(["#two"]);
  });

  it("marks the first intersecting section in document order, and only that one", () => {
    const f = fixture(["#one", "#two", "#three"]);
    mountScrollSpy({ root: f.root });

    f.observer().emit([
      { target: f.sections[2] as FakeElement, isIntersecting: true },
      { target: f.sections[1] as FakeElement, isIntersecting: true },
    ]);

    expect(f.marked()).toEqual(["#two"]);
  });

  it("hands the marker on, removing it from the previous link", () => {
    const f = fixture(["#one", "#two"]);
    mountScrollSpy({ root: f.root });

    f.observer().emit([{ target: f.sections[0] as FakeElement, isIntersecting: true }]);
    expect(f.marked()).toEqual(["#one"]);

    f.observer().emit([
      { target: f.sections[0] as FakeElement, isIntersecting: false },
      { target: f.sections[1] as FakeElement, isIntersecting: true },
    ]);

    expect(f.marked()).toEqual(["#two"]);
  });

  it("marks nothing while no section intersects", () => {
    const f = fixture(["#one", "#two"]);
    mountScrollSpy({ root: f.root });

    f.observer().emit([{ target: f.sections[0] as FakeElement, isIntersecting: true }]);
    f.observer().emit([{ target: f.sections[0] as FakeElement, isIntersecting: false }]);

    expect(f.marked()).toEqual([]);
  });

  it("observes the sections in document order, whatever order the links are in", () => {
    const f = fixture(["#two", "#one"], ["one", "two"]);
    mountScrollSpy({ root: f.root });

    // Both sections intersect: the answer must be the earlier *section*, not the earlier link.
    f.observer().emit([
      { target: f.sections[0] as FakeElement, isIntersecting: true },
      { target: f.sections[1] as FakeElement, isIntersecting: true },
    ]);

    expect(f.marked()).toEqual(["#one"]);
  });

  it("skips a link whose fragment resolves to nothing rather than throwing", () => {
    const f = fixture(["#one", "#missing"], ["one"]);
    mountScrollSpy({ root: f.root });

    expect(f.observer().observed).toHaveLength(1);

    f.observer().emit([{ target: f.sections[0] as FakeElement, isIntersecting: true }]);

    expect(f.marked()).toEqual(["#one"]);
  });

  it("is idempotent per root — a second mount returns the same disposer", () => {
    const f = fixture(["#one"]);

    const first = mountScrollSpy({ root: f.root });
    const observer = f.observer();
    const second = mountScrollSpy({ root: f.root });

    expect(second).toBe(first);
    expect(f.observer()).toBe(observer);
  });

  it("disconnects and clears every stamped attribute on dispose", () => {
    const f = fixture(["#one", "#two"]);
    const dispose = mountScrollSpy({ root: f.root });
    f.observer().emit([{ target: f.sections[0] as FakeElement, isIntersecting: true }]);

    dispose();

    expect(f.observer().disconnected).toBe(true);
    expect(f.marked()).toEqual([]);
  });

  it("re-mounts after dispose", () => {
    const f = fixture(["#one"]);
    const first = mountScrollSpy({ root: f.root });
    first();

    const second = mountScrollSpy({ root: f.root });

    expect(second).not.toBe(first);
  });

  it("returns a working no-op when there are no links", () => {
    const f = fixture([]);

    const dispose = mountScrollSpy({ root: f.root });

    expect(() => dispose()).not.toThrow();
  });

  it("returns a working no-op when the realm has no IntersectionObserver", () => {
    const f = fixture(["#one"]);
    const view = f.doc.defaultView as { IntersectionObserver?: typeof FakeObserver | undefined };
    view.IntersectionObserver = undefined;

    const dispose = mountScrollSpy({ root: f.root });

    expect(() => dispose()).not.toThrow();
    expect(f.marked()).toEqual([]);
  });
});
