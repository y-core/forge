import { beforeEach, describe, expect, it } from "bun:test";
import { initThemeCycler } from "./theme";
import { DARK_CLASS, THEME_ATTR, THEME_STORAGE_KEY } from "./theme-constants";

interface MqlMock {
  matches: boolean;
  listeners: EventListener[];
  addEventListener: (event: string, handler: EventListener) => void;
}

interface DocElMock {
  attrs: Record<string, string>;
  classes: Set<string>;
  setAttribute: (k: string, v: string) => void;
  getAttribute: (k: string) => string | null;
  classList: {
    toggle: (cls: string, force?: boolean) => void;
    contains: (cls: string) => boolean;
  };
}

interface GlobalMock {
  window: { matchMedia: (query: string) => MqlMock };
  document: {
    documentElement: DocElMock;
    querySelectorAll: (sel: string) => Array<{ addEventListener: (ev: string, handler: () => void) => void }>;
  };
  localStorage: {
    setItem: (k: string, v: string) => void;
  };
}

const g = globalThis as unknown as GlobalMock;

describe("initThemeCycler", () => {
  let mql: MqlMock;
  let docEl: DocElMock;
  let storedItems: Record<string, string>;
  let btnListeners: (() => void)[];

  beforeEach(() => {
    btnListeners = [];
    storedItems = {};

    mql = {
      matches: false,
      listeners: [],
      addEventListener: (ev, handler) => {
        if (ev === "change") mql.listeners.push(handler);
      },
    };

    docEl = {
      attrs: {},
      classes: new Set(),
      setAttribute: (k, v) => { docEl.attrs[k] = v; },
      getAttribute: (k) => docEl.attrs[k] ?? null,
      classList: {
        toggle: (cls, force?) => {
          if (force === true) docEl.classes.add(cls);
          else if (force === false) docEl.classes.delete(cls);
          else if (docEl.classes.has(cls)) docEl.classes.delete(cls);
          else docEl.classes.add(cls);
        },
        contains: (cls) => docEl.classes.has(cls),
      },
    };

    g.window = { matchMedia: () => mql };

    g.document = {
      documentElement: docEl,
      querySelectorAll: (_sel: string) => [
        {
          addEventListener: (_ev: string, handler: () => void) => {
            btnListeners.push(handler);
          },
        },
      ],
    };

    g.localStorage = {
      setItem: (k: string, v: string) => { storedItems[k] = v; },
    };
  });

  it("cycles from system to light on button click", () => {
    initThemeCycler();
    btnListeners[0]();
    expect(docEl.attrs[THEME_ATTR]).toBe("light");
  });

  it("cycles from light to dark on button click", () => {
    initThemeCycler();
    docEl.attrs[THEME_ATTR] = "light";
    btnListeners[0]();
    expect(docEl.attrs[THEME_ATTR]).toBe("dark");
  });

  it("cycles from dark back to system on button click", () => {
    initThemeCycler();
    docEl.attrs[THEME_ATTR] = "dark";
    btnListeners[0]();
    expect(docEl.attrs[THEME_ATTR]).toBe("system");
  });

  it("adds the dark class when cycling to dark pref", () => {
    initThemeCycler();
    docEl.attrs[THEME_ATTR] = "light"; // next cycle → dark
    btnListeners[0]();
    expect(docEl.classes.has(DARK_CLASS)).toBe(true);
  });

  it("removes the dark class when cycling to light pref", () => {
    initThemeCycler();
    docEl.classes.add(DARK_CLASS); // start dark
    // no THEME_ATTR → current = "system" → next = "light"
    btnListeners[0]();
    expect(docEl.classes.has(DARK_CLASS)).toBe(false);
  });

  it("persists the new pref to localStorage", () => {
    initThemeCycler();
    btnListeners[0](); // system → light
    expect(storedItems[THEME_STORAGE_KEY]).toBe("light");
  });

  it("adds dark class on media query change when pref is system and OS is dark", () => {
    initThemeCycler();
    mql.matches = true;
    mql.listeners[0](new Event("change"));
    expect(docEl.classes.has(DARK_CLASS)).toBe(true);
  });

  it("removes dark class on media query change when pref is system and OS is light", () => {
    initThemeCycler();
    docEl.classes.add(DARK_CLASS);
    mql.matches = false;
    mql.listeners[0](new Event("change"));
    expect(docEl.classes.has(DARK_CLASS)).toBe(false);
  });

  it("ignores media query changes when pref is not system", () => {
    initThemeCycler();
    docEl.attrs[THEME_ATTR] = "light"; // locked to explicit pref
    mql.matches = true;
    mql.listeners[0](new Event("change"));
    expect(docEl.classes.has(DARK_CLASS)).toBe(false);
  });
});
