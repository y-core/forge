import { beforeEach, describe, expect, it } from "bun:test";
import { initThemeSwitch } from "./theme";
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
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
  };
}

const g = globalThis as unknown as GlobalMock;

describe("initThemeSwitch", () => {
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
      getItem: (k: string) => storedItems[k] ?? null,
      setItem: (k: string, v: string) => { storedItems[k] = v; },
    };
  });

  it("cycles from system to light on button click", () => {
    initThemeSwitch();
    btnListeners[0]();
    expect(docEl.attrs[THEME_ATTR]).toBe("light");
  });

  it("cycles from light to dark on button click", () => {
    storedItems[THEME_STORAGE_KEY] = "light";
    initThemeSwitch();
    btnListeners[0]();
    expect(docEl.attrs[THEME_ATTR]).toBe("dark");
  });

  it("cycles from dark back to system on button click", () => {
    storedItems[THEME_STORAGE_KEY] = "dark";
    initThemeSwitch();
    btnListeners[0]();
    expect(docEl.attrs[THEME_ATTR]).toBe("system");
  });

  it("adds the dark class when cycling to dark pref", () => {
    storedItems[THEME_STORAGE_KEY] = "light";
    initThemeSwitch();
    btnListeners[0]();
    expect(docEl.classes.has(DARK_CLASS)).toBe(true);
  });

  it("removes the dark class when cycling to light pref", () => {
    mql.matches = true; // OS dark so isDark=true with system pref
    initThemeSwitch(); // effect adds dark class
    btnListeners[0](); // system → light, isDark transitions to false
    expect(docEl.classes.has(DARK_CLASS)).toBe(false);
  });

  it("persists the new pref to localStorage", () => {
    initThemeSwitch();
    btnListeners[0](); // system → light
    expect(storedItems[THEME_STORAGE_KEY]).toBe("light");
  });

  it("adds dark class on media query change when pref is system and OS is dark", () => {
    initThemeSwitch();
    mql.matches = true;
    mql.listeners[0](new Event("change"));
    expect(docEl.classes.has(DARK_CLASS)).toBe(true);
  });

  it("removes dark class on media query change when pref is system and OS is light", () => {
    mql.matches = true; // start OS-dark so isDark=true on init
    initThemeSwitch();
    mql.matches = false;
    mql.listeners[0](new Event("change")); // OS → light
    expect(docEl.classes.has(DARK_CLASS)).toBe(false);
  });

  it("ignores media query changes when pref is not system", () => {
    storedItems[THEME_STORAGE_KEY] = "light"; // locked to explicit pref
    initThemeSwitch();
    mql.matches = true;
    mql.listeners[0](new Event("change"));
    expect(docEl.classes.has(DARK_CLASS)).toBe(false);
  });
});
