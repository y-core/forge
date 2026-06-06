import { beforeEach, describe, expect, it } from "bun:test";
import { mountNav } from "./nav";

interface ListenerRegistry {
  [event: string]: EventListener[];
}

interface GlobalMock {
  document: {
    querySelector: (sel: string) => MockEl | null;
    addEventListener: (ev: string, handler: EventListener) => void;
    removeEventListener: (ev: string, handler: EventListener) => void;
  };
}

const g = globalThis as unknown as GlobalMock;

interface MockEl {
  classes: Set<string>;
  attrs: Record<string, string>;
  listeners: ListenerRegistry;
  classList: { toggle: (c: string, force?: boolean) => void };
  setAttribute: (k: string, v: string) => void;
  addEventListener: (event: string, handler: EventListener) => void;
  removeEventListener: (event: string, handler: EventListener) => void;
  querySelectorAll: (sel: string) => MockEl[];
  contains: (node: unknown) => boolean;
}

function removeListener(list: EventListener[] | undefined, handler: EventListener): EventListener[] {
  return (list ?? []).filter((entry) => entry !== handler);
}

function makeEl(opts?: { classes?: string[]; contains?: (node: unknown) => boolean }): MockEl {
  const classes = new Set<string>(opts?.classes ?? []);
  const attrs: Record<string, string> = {};
  const listeners: ListenerRegistry = {};

  return {
    classes,
    attrs,
    listeners,
    classList: {
      toggle: (c, force) => {
        if (force === false) {
          classes.delete(c);
          return;
        }
        if (force === true) {
          classes.add(c);
          return;
        }
        if (classes.has(c)) classes.delete(c);
        else classes.add(c);
      },
    },
    setAttribute: (k, v) => {
      attrs[k] = v;
    },
    addEventListener: (event, handler) => {
      listeners[event] = [...(listeners[event] ?? []), handler];
    },
    removeEventListener: (event, handler) => {
      listeners[event] = removeListener(listeners[event], handler);
    },
    querySelectorAll: () => [],
    contains: opts?.contains ?? (() => false),
  };
}

describe("mountNav", () => {
  let toggle: MockEl;
  let menu: MockEl;
  let docListeners: ListenerRegistry;

  beforeEach(() => {
    toggle = makeEl();
    menu = makeEl({ classes: ["hidden"] });
    docListeners = {};

    g.document = {
      querySelector: (sel: string) => {
        if (sel.includes("nav-toggle")) return toggle;
        if (sel.includes("nav-menu")) return menu;
        return null;
      },
      addEventListener: (event, handler) => {
        docListeners[event] = [...(docListeners[event] ?? []), handler];
      },
      removeEventListener: (event, handler) => {
        docListeners[event] = removeListener(docListeners[event], handler);
      },
    };
  });

  it("opens the menu and sets aria-expanded=true when toggled", () => {
    mountNav();
    toggle.listeners.click![0]!(new Event("click"));
    expect(menu.classes.has("hidden")).toBe(false);
    expect(toggle.attrs["aria-expanded"]).toBe("true");
  });

  it("closes the menu on Escape", () => {
    mountNav();
    toggle.listeners.click![0]!(new Event("click"));
    docListeners.keydown![0]!(Object.assign(new Event("keydown"), { key: "Escape" }));
    expect(menu.classes.has("hidden")).toBe(true);
  });

  it("closes the menu on outside clicks", () => {
    mountNav();
    toggle.listeners.click![0]!(new Event("click"));
    docListeners.click![0]!(new Event("click"));
    expect(menu.classes.has("hidden")).toBe(true);
  });

  it("closes the menu when a nav-link is clicked", () => {
    const link = makeEl();
    menu.querySelectorAll = () => [link];

    mountNav();
    toggle.listeners.click![0]!(new Event("click"));
    link.listeners.click![0]!(new Event("click"));
    expect(menu.classes.has("hidden")).toBe(true);
  });

  it("is idempotent for the same toggle element", () => {
    const cleanupA = mountNav();
    const cleanupB = mountNav();
    expect(cleanupA).toBe(cleanupB);
    expect(toggle.listeners.click).toHaveLength(1);
  });

  it("cleanup removes the listeners", () => {
    const cleanup = mountNav();
    expect(toggle.listeners.click).toHaveLength(1);
    cleanup();
    expect(toggle.listeners.click).toHaveLength(0);
    expect(docListeners.click).toHaveLength(0);
    expect(docListeners.keydown).toHaveLength(0);
  });

  it("returns a noop cleanup when the elements are missing", () => {
    g.document.querySelector = () => null;
    const cleanup = mountNav();
    expect(() => cleanup()).not.toThrow();
  });
});
