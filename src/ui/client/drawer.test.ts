import { describe, expect, it } from "bun:test";
import { mountNavDrawer } from "./drawer";

/** The fake fires `toggle` synchronously on every write to `open`, and routes focus through the
 * document the way a real one does — the two facts every case below reads back. */

class FakeMediaQueryList {
  readonly listeners = new Set<() => void>();

  matches: boolean;

  constructor(matches: boolean) {
    this.matches = matches;
  }

  addEventListener(_type: string, listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: () => void): void {
    this.listeners.delete(listener);
  }

  /** A resize or orientation change across the breakpoint. */
  set(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) listener();
  }
}

/** The slice of CSSOM the scroll lock writes through: one property, set and removed by name. */
class FakeStyle {
  readonly properties = new Map<string, string>();

  getPropertyValue(name: string): string {
    return this.properties.get(name) ?? "";
  }

  setProperty(name: string, value: string): void {
    this.properties.set(name, value);
  }

  removeProperty(name: string): void {
    this.properties.delete(name);
  }
}

class FakeNode {
  readonly nodeType = 1;
  ownerDocument: FakeDocument | null = null;

  focus(): void {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  getRootNode(): FakeDocument | FakeNode {
    return this.ownerDocument ?? this;
  }

  contains(other: FakeNode | null): boolean {
    return other === this;
  }
}

/** The panel: a box that owns an ordered list of focusables and reports containment over it. */
class FakePanel extends FakeNode {
  readonly items: FakeNode[] = [];
  queried: string[] = [];

  querySelectorAll(selector: string): FakeNode[] {
    this.queried.push(selector);
    return this.items;
  }

  override contains(other: FakeNode | null): boolean {
    return other === this || (other !== null && this.items.includes(other));
  }
}

class FakeDocument {
  readonly nodeType = 9;
  readonly documentElement = { style: new FakeStyle() };
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  activeElement: FakeNode | null = null;

  readonly defaultView: { matchMedia?: ((query: string) => FakeMediaQueryList) | undefined };

  constructor(media: FakeMediaQueryList, queries: string[]) {
    this.defaultView = {
      matchMedia: (query: string) => {
        queries.push(query);
        return media;
      },
    };
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set<(event: unknown) => void>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, set) => total + set.size, 0);
  }

  /** A key the reader pressed, with the `preventDefault` the trap is expected to call. */
  press(key: string, shiftKey = false): { defaultPrevented: boolean } {
    const event = {
      key,
      shiftKey,
      defaultPrevented: false,
      preventDefault(): void {
        this.defaultPrevented = true;
      },
    };
    for (const listener of this.listeners.get("keydown") ?? []) listener(event);
    return event;
  }
}

class FakeDetails extends FakeNode {
  private readonly listeners = new Map<string, Set<() => void>>();
  private isOpen: boolean;

  readonly summary = new FakeNode();
  readonly panel = new FakePanel();
  readonly selectors: string[] = [];

  constructor(open: boolean, doc: FakeDocument, links: number) {
    super();
    this.isOpen = open;
    this.ownerDocument = doc;
    this.summary.ownerDocument = doc;
    this.panel.ownerDocument = doc;
    for (let i = 0; i < links; i += 1) {
      const link = new FakeNode();
      link.ownerDocument = doc;
      this.panel.items.push(link);
    }
  }

  get open(): boolean {
    return this.isOpen;
  }

  set open(value: boolean) {
    if (this.isOpen === value) return;
    this.isOpen = value;
    for (const listener of this.listeners.get("toggle") ?? []) listener();
  }

  /** A summary click: the platform flips `open` itself and the event follows. */
  userToggle(): void {
    this.open = !this.isOpen;
  }

  querySelector(selector: string): FakeNode | null {
    this.selectors.push(selector);
    return selector === "summary" ? this.summary : this.panel;
  }

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, set) => total + set.size, 0);
  }
}

interface Fixture {
  el: FakeDetails;
  doc: FakeDocument;
  media: FakeMediaQueryList;
  queries: string[];
  element: Element;
  overflow: () => string | undefined;
}

function fixture(matches: boolean, open = false, links = 3): Fixture {
  const media = new FakeMediaQueryList(matches);
  const queries: string[] = [];
  const doc = new FakeDocument(media, queries);
  const el = new FakeDetails(open, doc, links);
  return { el, doc, media, queries, element: el as unknown as Element, overflow: () => doc.documentElement.style.properties.get("overflow") };
}

describe("mountNavDrawer", () => {
  it("locks the document's scroll when the drawer opens at drawer width", () => {
    const f = fixture(true);
    mountNavDrawer({ element: f.element });
    expect(f.overflow()).toBeUndefined();

    f.el.userToggle();

    expect(f.overflow()).toBe("hidden");
  });

  it("leaves the scroll alone for a disclosure opened above the breakpoint", () => {
    const f = fixture(false);
    mountNavDrawer({ element: f.element });

    f.el.userToggle();

    expect(f.overflow()).toBeUndefined();
  });

  it("restores the page's own overflow exactly, rather than merely removing the property", () => {
    const f = fixture(true);
    f.doc.documentElement.style.setProperty("overflow", "clip");
    mountNavDrawer({ element: f.element });

    f.el.userToggle();
    expect(f.overflow()).toBe("hidden");

    f.el.userToggle();

    expect(f.overflow()).toBe("clip");
  });

  it("restores the scroll on dispose, from a drawer left open", () => {
    const f = fixture(true);
    const dispose = mountNavDrawer({ element: f.element });
    f.el.userToggle();
    expect(f.overflow()).toBe("hidden");

    dispose();

    expect(f.overflow()).toBeUndefined();
    expect(f.doc.documentElement.style.properties.size).toBe(0);
  });

  it("unlocks when the viewport widens past the breakpoint under an open drawer", () => {
    const f = fixture(true);
    mountNavDrawer({ element: f.element });
    f.el.userToggle();

    f.media.set(false);

    expect(f.overflow()).toBeUndefined();
  });

  it("moves focus to the first focusable in the panel on open", () => {
    const f = fixture(true);
    mountNavDrawer({ element: f.element });

    f.el.userToggle();

    expect(f.doc.activeElement).toBe(f.el.panel.items[0] as FakeNode);
  });

  it("returns focus to the summary on close", () => {
    const f = fixture(true);
    mountNavDrawer({ element: f.element });
    f.el.userToggle();

    f.el.userToggle();

    expect(f.doc.activeElement).toBe(f.el.summary);
  });

  it("leaves focus where it is when the reader is no longer inside the panel", () => {
    const f = fixture(true);
    const elsewhere = new FakeNode();
    elsewhere.ownerDocument = f.doc;
    mountNavDrawer({ element: f.element });
    f.el.userToggle();

    elsewhere.focus();
    f.el.userToggle();

    expect(f.doc.activeElement).toBe(elsewhere);
  });

  it("closes on Escape", () => {
    const f = fixture(true);
    mountNavDrawer({ element: f.element });
    f.el.userToggle();

    f.doc.press("Escape");

    expect(f.el.open).toBe(false);
  });

  it("ignores Escape while the drawer is shut, and above the breakpoint", () => {
    const shut = fixture(true);
    mountNavDrawer({ element: shut.element });
    shut.doc.press("Escape");
    expect(shut.el.open).toBe(false);

    const wide = fixture(false, true);
    mountNavDrawer({ element: wide.element });

    wide.doc.press("Escape");

    expect(wide.el.open).toBe(true);
  });

  it("cycles Tab from the last focusable back to the first", () => {
    const f = fixture(true);
    mountNavDrawer({ element: f.element });
    f.el.userToggle();
    (f.el.panel.items.at(-1) as FakeNode).focus();

    const event = f.doc.press("Tab");

    expect(event.defaultPrevented).toBe(true);
    expect(f.doc.activeElement).toBe(f.el.panel.items[0] as FakeNode);
  });

  it("cycles Shift+Tab from the first focusable back to the last", () => {
    const f = fixture(true);
    mountNavDrawer({ element: f.element });
    f.el.userToggle();

    const event = f.doc.press("Tab", true);

    expect(event.defaultPrevented).toBe(true);
    expect(f.doc.activeElement).toBe(f.el.panel.items.at(-1) as FakeNode);
  });

  it("leaves a Tab in the middle of the panel to the browser", () => {
    const f = fixture(true);
    mountNavDrawer({ element: f.element });
    f.el.userToggle();
    (f.el.panel.items[1] as FakeNode).focus();

    const event = f.doc.press("Tab");

    expect(event.defaultPrevented).toBe(false);
    expect(f.doc.activeElement).toBe(f.el.panel.items[1] as FakeNode);
  });

  it("traps nothing when focus is outside the panel", () => {
    const f = fixture(true);
    const elsewhere = new FakeNode();
    elsewhere.ownerDocument = f.doc;
    mountNavDrawer({ element: f.element });
    f.el.userToggle();
    elsewhere.focus();

    const event = f.doc.press("Tab");

    expect(event.defaultPrevented).toBe(false);
    expect(f.doc.activeElement).toBe(elsewhere);
  });

  it("uses the default `md` breakpoint query, and honours an override", () => {
    const a = fixture(true);
    mountNavDrawer({ element: a.element });
    const b = fixture(true);
    mountNavDrawer({ element: b.element, query: "(max-width: 30rem)" });

    expect(a.queries).toEqual(["(max-width: 47.99rem)"]);
    expect(b.queries).toEqual(["(max-width: 30rem)"]);
  });

  it("is idempotent per element — a second mount returns the same disposer", () => {
    const f = fixture(true);

    const first = mountNavDrawer({ element: f.element });
    const second = mountNavDrawer({ element: f.element });

    expect(second).toBe(first);
    expect(f.media.listeners.size).toBe(1);
  });

  it("removes every listener it added on dispose, and re-mounts after one", () => {
    const f = fixture(true);
    const first = mountNavDrawer({ element: f.element });

    first();

    expect(f.media.listeners.size).toBe(0);
    expect(f.el.listenerCount()).toBe(0);
    expect(f.doc.listenerCount()).toBe(0);
    expect(mountNavDrawer({ element: f.element })).not.toBe(first);
  });

  // A target the call named and that did not resolve is deterministic for that call site, so it
  // throws rather than returning a disposer that quietly does nothing.
  it("throws when there is no element", () => {
    expect(() => mountNavDrawer({ element: null })).toThrow("did not resolve to a disclosure");
  });

  it("throws when the element is not a disclosure", () => {
    expect(() => mountNavDrawer({ element: { nodeType: 1 } as unknown as Element })).toThrow("did not resolve to a disclosure");
  });

  it("no-ops when the realm has no matchMedia", () => {
    const f = fixture(true, true);
    f.doc.defaultView.matchMedia = undefined;

    const dispose = mountNavDrawer({ element: f.element });

    expect(f.overflow()).toBeUndefined();
    expect(f.doc.listenerCount()).toBe(0);
    expect(() => dispose()).not.toThrow();
  });

  it("locks a drawer that was already open at mount, and unlocks it on dispose", () => {
    const f = fixture(true, true);

    const dispose = mountNavDrawer({ element: f.element });
    expect(f.overflow()).toBe("hidden");
    // Mounting is not an interaction, so it must not move the reader's focus.
    expect(f.doc.activeElement).toBeNull();

    dispose();

    expect(f.overflow()).toBeUndefined();
  });
});
