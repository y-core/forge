import { beforeEach, describe, expect, it } from "bun:test";
import { initNav } from "./nav";

interface GlobalMock {
  document: {
    querySelector: (sel: string) => MockEl | null;
    addEventListener: (ev: string, handler: EventListener) => void;
  };
}

const g = globalThis as unknown as GlobalMock;

interface MockEl {
  classes: Set<string>;
  attrs: Record<string, string>;
  listeners: Record<string, EventListener[]>;
  classList: {
    add: (c: string) => void;
    toggle: (c: string, force?: boolean) => void;
    contains: (c: string) => boolean;
  };
  setAttribute: (k: string, v: string) => void;
  getAttribute: (k: string) => string | null;
  addEventListener: (event: string, handler: EventListener) => void;
  querySelectorAll: (sel: string) => MockEl[];
  contains: (node: unknown) => boolean;
}

function makeEl(opts?: { classes?: string[]; attrs?: Record<string, string> }): MockEl {
  const classes = new Set<string>(opts?.classes ?? []);
  const attrs: Record<string, string> = { ...opts?.attrs };
  const listeners: Record<string, EventListener[]> = {};
  return {
    classes,
    attrs,
    listeners,
    classList: {
      add: (c) => classes.add(c),
      toggle: (c, force?) => {
        if (force === true) classes.add(c);
        else if (force === false) classes.delete(c);
        else if (classes.has(c)) classes.delete(c);
        else classes.add(c);
      },
      contains: (c) => classes.has(c),
    },
    setAttribute: (k, v) => { attrs[k] = v; },
    getAttribute: (k) => attrs[k] ?? null,
    addEventListener: (ev, handler) => {
      if (!listeners[ev]) listeners[ev] = [];
      listeners[ev].push(handler);
    },
    querySelectorAll: () => [],
    contains: () => false,
  };
}

describe("initNav", () => {
  let toggle: MockEl;
  let menu: MockEl;
  let docListeners: Record<string, EventListener[]>;

  beforeEach(() => {
    toggle = makeEl({ attrs: { "aria-expanded": "false" } });
    menu = makeEl({ classes: ["hidden"] });
    docListeners = {};

    g.document = {
      querySelector: (sel: string) => {
        if (sel.includes("nav-toggle")) return toggle;
        if (sel.includes("nav-menu")) return menu;
        return null;
      },
      addEventListener: (ev: string, handler: EventListener) => {
        if (!docListeners[ev]) docListeners[ev] = [];
        docListeners[ev].push(handler);
      },
    };
  });

  it("opens the menu and sets aria-expanded=true when toggle is clicked", () => {
    initNav();
    toggle.listeners.click[0](new Event("click"));
    expect(menu.classes.has("hidden")).toBe(false);
    expect(toggle.attrs["aria-expanded"]).toBe("true");
  });

  it("closes the menu and sets aria-expanded=false on a second click", () => {
    initNav();
    toggle.listeners.click[0](new Event("click")); // open
    toggle.listeners.click[0](new Event("click")); // close
    expect(menu.classes.has("hidden")).toBe(true);
    expect(toggle.attrs["aria-expanded"]).toBe("false");
  });

  it("closes the menu when Escape is pressed while open", () => {
    initNav();
    toggle.listeners.click[0](new Event("click")); // open
    const keyEscape = Object.assign(new Event("keydown"), { key: "Escape" });
    docListeners.keydown[0](keyEscape as Event);
    expect(menu.classes.has("hidden")).toBe(true);
    expect(toggle.attrs["aria-expanded"]).toBe("false");
  });

  it("does not close the menu on Escape when it is already hidden", () => {
    initNav();
    const keyEscape = Object.assign(new Event("keydown"), { key: "Escape" });
    docListeners.keydown[0](keyEscape as Event);
    expect(menu.classes.has("hidden")).toBe(true);
  });

  it("closes the menu on an outside document click when menu is open", () => {
    initNav();
    toggle.listeners.click[0](new Event("click")); // open
    // target defaults to null, which is neither the menu nor the toggle
    docListeners.click[0](new Event("click"));
    expect(menu.classes.has("hidden")).toBe(true);
  });

  it("closes the menu when a nav-link is clicked", () => {
    const link = makeEl();
    menu.querySelectorAll = () => [link];
    initNav();
    toggle.listeners.click[0](new Event("click")); // open
    link.listeners.click[0](new Event("click"));
    expect(menu.classes.has("hidden")).toBe(true);
    expect(toggle.attrs["aria-expanded"]).toBe("false");
  });

  it("does nothing when toggle element is not found", () => {
    g.document.querySelector = () => null;
    initNav(); // must not throw
    expect(Object.keys(docListeners)).toHaveLength(0);
  });
});
