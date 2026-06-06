import { beforeEach, describe, expect, it } from "bun:test";
import { DARK_CLASS, DEFAULT_PREF, FOUC_SCRIPT, mountTheme, THEME_ATTR, THEME_STORAGE_KEY } from "./theme";

interface MqlMock {
  matches: boolean;
  listeners: EventListener[];
  addEventListener: (event: string, handler: EventListener) => void;
  removeEventListener: (event: string, handler: EventListener) => void;
}

interface DocElMock {
  attrs: Record<string, string>;
  classes: Set<string>;
  setAttribute: (k: string, v: string) => void;
  classList: { toggle: (cls: string, force?: boolean) => void; contains: (cls: string) => boolean };
}

interface ButtonMock {
  listeners: (() => void)[];
  addEventListener: (ev: string, handler: () => void) => void;
  removeEventListener: (ev: string, handler: () => void) => void;
}

interface GlobalMock {
  window: { matchMedia: (query: string) => MqlMock };
  document: { documentElement: DocElMock; querySelectorAll: (sel: string) => ButtonMock[] };
  localStorage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };
}

const g = globalThis as unknown as GlobalMock;

describe("mountTheme", () => {
  let mql: MqlMock;
  let docEl: DocElMock;
  let storedItems: Record<string, string>;
  let button: ButtonMock;

  beforeEach(() => {
    storedItems = {};

    mql = {
      matches: false,
      listeners: [],
      addEventListener: (_ev, handler) => {
        mql.listeners.push(handler);
      },
      removeEventListener: (_ev, handler) => {
        mql.listeners = mql.listeners.filter((entry) => entry !== handler);
      },
    };

    docEl = {
      attrs: {},
      classes: new Set<string>(),
      setAttribute: (k, v) => {
        docEl.attrs[k] = v;
      },
      classList: {
        toggle: (cls, force) => {
          if (force === true) docEl.classes.add(cls);
          else if (force === false) docEl.classes.delete(cls);
          else if (docEl.classes.has(cls)) docEl.classes.delete(cls);
          else docEl.classes.add(cls);
        },
        contains: (cls) => docEl.classes.has(cls),
      },
    };

    button = {
      listeners: [],
      addEventListener: (_ev, handler) => {
        button.listeners.push(handler);
      },
      removeEventListener: (_ev, handler) => {
        button.listeners = button.listeners.filter((entry) => entry !== handler);
      },
    };

    g.window = { matchMedia: () => mql };
    g.document = { documentElement: docEl, querySelectorAll: () => [button] };
    g.localStorage = {
      getItem: (k) => storedItems[k] ?? null,
      setItem: (k, v) => {
        storedItems[k] = v;
      },
    };
  });

  it("cycles from system to light on button click", () => {
    const cleanup = mountTheme();
    button.listeners[0]!();
    expect(docEl.attrs[THEME_ATTR]).toBe("light");
    cleanup();
  });

  it("adds the dark class when cycling to dark", () => {
    storedItems[THEME_STORAGE_KEY] = "light";
    const cleanup = mountTheme();
    button.listeners[0]!();
    expect(docEl.classes.has(DARK_CLASS)).toBe(true);
    cleanup();
  });

  it("reacts to system preference changes while in system mode", () => {
    const cleanup = mountTheme();
    mql.matches = true;
    mql.listeners[0]!(new Event("change"));
    expect(docEl.classes.has(DARK_CLASS)).toBe(true);
    cleanup();
  });

  it("is idempotent while mounted", () => {
    const cleanupA = mountTheme();
    const cleanupB = mountTheme();
    expect(cleanupA).toBe(cleanupB);
    expect(button.listeners).toHaveLength(1);
    cleanupA();
  });

  it("cleanup removes button and media query listeners", () => {
    const cleanup = mountTheme();
    expect(button.listeners).toHaveLength(1);
    expect(mql.listeners).toHaveLength(1);
    cleanup();
    expect(button.listeners).toHaveLength(0);
    expect(mql.listeners).toHaveLength(0);
  });
});

describe("FOUC_SCRIPT", () => {
  it("is an IIFE", () => {
    expect(FOUC_SCRIPT.startsWith("(function(){")).toBe(true);
    expect(FOUC_SCRIPT.endsWith("})();")).toBe(true);
  });

  it("reads from localStorage with the correct key", () => {
    expect(FOUC_SCRIPT).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}")`);
  });

  it("sets the correct attribute on documentElement", () => {
    expect(FOUC_SCRIPT).toContain(`setAttribute("${THEME_ATTR}"`);
  });

  it("adds the dark class", () => {
    expect(FOUC_SCRIPT).toContain(`classList.add("${DARK_CLASS}")`);
  });

  it("defaults to the default preference when nothing is stored", () => {
    expect(FOUC_SCRIPT).toContain(`||"${DEFAULT_PREF}"`);
  });
});
