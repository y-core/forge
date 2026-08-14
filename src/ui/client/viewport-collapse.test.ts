import { describe, expect, it } from "bun:test";
import { mountViewportCollapse } from "./viewport-collapse";

/** The fake fires `toggle` synchronously on every write to `open` — one event per change, in order
 * — which is the property the controller's own-write bookkeeping depends on. */

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

class FakeDetails {
  readonly nodeType = 1;
  readonly ownerDocument: { nodeType: number; defaultView: { matchMedia: (q: string) => FakeMediaQueryList } };
  private readonly listeners = new Map<string, Set<() => void>>();
  private isOpen: boolean;
  queries: string[] = [];

  readonly media: FakeMediaQueryList;

  constructor(open: boolean, media: FakeMediaQueryList) {
    this.isOpen = open;
    this.media = media;
    this.ownerDocument = {
      nodeType: 9,
      defaultView: {
        matchMedia: (q: string) => {
          this.queries.push(q);
          return this.media;
        },
      },
    };
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

function fixture(matches: boolean, open = true): { el: FakeDetails; media: FakeMediaQueryList; element: Element } {
  const media = new FakeMediaQueryList(matches);
  const el = new FakeDetails(open, media);
  return { el, media, element: el as unknown as Element };
}

describe("mountViewportCollapse", () => {
  it("collapses the SSR-open disclosure when the query already matches at mount", () => {
    const f = fixture(true);

    mountViewportCollapse({ element: f.element });

    expect(f.el.open).toBe(false);
  });

  it("leaves it open when the query does not match", () => {
    const f = fixture(false);

    mountViewportCollapse({ element: f.element });

    expect(f.el.open).toBe(true);
  });

  it("restores what it closed itself when the query stops matching", () => {
    const f = fixture(false);
    mountViewportCollapse({ element: f.element });

    f.media.set(true);
    expect(f.el.open).toBe(false);

    f.media.set(false);
    expect(f.el.open).toBe(true);
  });

  it("never opens a disclosure that was already closed at mount", () => {
    const f = fixture(true, false);
    mountViewportCollapse({ element: f.element });
    expect(f.el.open).toBe(false);

    f.media.set(false);
    expect(f.el.open).toBe(false);

    f.media.set(true);
    expect(f.el.open).toBe(false);
  });

  it("never opens a disclosure closed at mount even when the query never matched", () => {
    const f = fixture(false, false);
    mountViewportCollapse({ element: f.element });

    expect(f.el.open).toBe(false);

    f.media.set(true);
    f.media.set(false);

    expect(f.el.open).toBe(false);
  });

  it("abandons the restore it owed when the user toggles in between", () => {
    const f = fixture(false);
    mountViewportCollapse({ element: f.element });
    f.media.set(true);
    expect(f.el.open).toBe(false);

    f.el.userToggle();
    f.el.userToggle();

    f.media.set(false);

    expect(f.el.open).toBe(false);
  });

  it("does not reopen after the user closed it at a wide viewport", () => {
    const f = fixture(false);
    mountViewportCollapse({ element: f.element });

    f.el.userToggle();
    expect(f.el.open).toBe(false);

    f.media.set(true);
    f.media.set(false);

    expect(f.el.open).toBe(false);
  });

  it("stops overriding once the user has toggled the disclosure", () => {
    const f = fixture(true);
    mountViewportCollapse({ element: f.element });
    expect(f.el.open).toBe(false);

    f.el.userToggle();
    expect(f.el.open).toBe(true);

    f.media.set(false);
    f.media.set(true);

    expect(f.el.open).toBe(true);
  });

  it("treats a user toggle back to the controller's own value as the user taking over", () => {
    const f = fixture(true);
    mountViewportCollapse({ element: f.element });

    f.el.userToggle(); // open
    f.el.userToggle(); // closed again — same state the controller wrote, still the user's decision

    f.media.set(false);

    expect(f.el.open).toBe(false);
  });

  it("uses the default `md` breakpoint query, and honours an override", () => {
    const a = fixture(true);
    mountViewportCollapse({ element: a.element });
    const b = fixture(true);
    mountViewportCollapse({ element: b.element, query: "(max-width: 30rem)" });

    expect(a.el.queries).toEqual(["(max-width: 47.99rem)"]);
    expect(b.el.queries).toEqual(["(max-width: 30rem)"]);
  });

  it("is idempotent per element — a second mount returns the same disposer", () => {
    const f = fixture(true);

    const first = mountViewportCollapse({ element: f.element });
    const second = mountViewportCollapse({ element: f.element });

    expect(second).toBe(first);
    expect(f.media.listeners.size).toBe(1);
  });

  it("removes every listener and restores the SSR state on dispose", () => {
    const f = fixture(true);
    const dispose = mountViewportCollapse({ element: f.element });
    expect(f.el.open).toBe(false);

    dispose();

    expect(f.el.open).toBe(true);
    expect(f.media.listeners.size).toBe(0);
    expect(f.el.listenerCount()).toBe(0);
  });

  it("leaves a disclosure it never closed alone on dispose", () => {
    const f = fixture(true, false);
    const dispose = mountViewportCollapse({ element: f.element });

    dispose();

    expect(f.el.open).toBe(false);
  });

  it("does not undo the user on dispose", () => {
    const f = fixture(true);
    const dispose = mountViewportCollapse({ element: f.element });
    f.el.userToggle();

    dispose();

    expect(f.el.open).toBe(true);
  });

  it("re-mounts after dispose", () => {
    const f = fixture(true);
    const first = mountViewportCollapse({ element: f.element });
    first();

    const second = mountViewportCollapse({ element: f.element });

    expect(second).not.toBe(first);
  });

  it("no-ops when there is no element", () => {
    const dispose = mountViewportCollapse({ element: null });

    expect(() => dispose()).not.toThrow();
  });

  it("no-ops when the element is not a disclosure", () => {
    const dispose = mountViewportCollapse({ element: { nodeType: 1 } as unknown as Element });

    expect(() => dispose()).not.toThrow();
  });

  it("no-ops when the realm has no matchMedia", () => {
    const f = fixture(true);
    (f.el.ownerDocument.defaultView as { matchMedia?: unknown }).matchMedia = undefined;

    const dispose = mountViewportCollapse({ element: f.element });

    expect(f.el.open).toBe(true);
    expect(() => dispose()).not.toThrow();
  });
});
