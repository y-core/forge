import { describe, expect, it } from "bun:test";

import { DARK_CLASS, DEFAULT_THEME_PREF, FOUC_SCRIPT, THEME_ATTR, THEME_PREFS, THEME_STORAGE_KEY } from "./theme";

describe("theme constants", () => {
  it("exposes the documented constant values", () => {
    expect(THEME_STORAGE_KEY).toBe("themePreference");
    expect(THEME_ATTR).toBe("data-theme-preference");
    expect(DARK_CLASS).toBe("dark");
    expect(DEFAULT_THEME_PREF).toBe("system");
  });
});

describe("FOUC_SCRIPT", () => {
  it("interpolates every theme constant value (no drift from the constants)", () => {
    expect(FOUC_SCRIPT).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}")`);
    expect(FOUC_SCRIPT).toContain(`e="${DEFAULT_THEME_PREF}"`);
    expect(FOUC_SCRIPT).toContain(`setAttribute("${THEME_ATTR}",e)`);
    expect(FOUC_SCRIPT).toContain(`e==="${DARK_CLASS}"`);
    expect(FOUC_SCRIPT).toContain(`e==="${DEFAULT_THEME_PREF}"`);
    expect(FOUC_SCRIPT).toContain(`classList.add("${DARK_CLASS}")`);
  });

  it("is a self-invoking IIFE", () => {
    expect(FOUC_SCRIPT.startsWith("(function(){")).toBe(true);
    expect(FOUC_SCRIPT.endsWith("})();")).toBe(true);
  });

  it("cannot break out of a <script> tag", () => {
    expect(FOUC_SCRIPT.toLowerCase()).not.toContain("</script");
    expect((FOUC_SCRIPT.match(/"/g) ?? []).length % 2).toBe(0);
    expect(FOUC_SCRIPT).not.toContain("'");
  });
});

interface FoucRun {
  pref: string | null;
  dark: boolean;
}

function runFoucScript(options: { stored?: string | null; getItemThrows?: boolean; matchMedia?: boolean; prefersDark?: boolean } = {}): FoucRun {
  const attrs = new Map<string, string>();
  const classes = new Set<string>();
  const localStorage = {
    getItem(key: string): string | null {
      if (options.getItemThrows === true) throw new DOMException("blocked", "SecurityError");
      return key === THEME_STORAGE_KEY ? (options.stored ?? null) : null;
    },
  };
  const document = {
    documentElement: {
      setAttribute: (name: string, value: string) => attrs.set(name, value),
      classList: { add: (token: string) => classes.add(token) },
    },
  };
  const window = options.matchMedia === false ? {} : { matchMedia: () => ({ matches: options.prefersDark === true }) };
  // oxlint-disable-next-line typescript/no-implied-eval -- runs the shipped inline-script string against stub globals, as a page would
  new Function("localStorage", "document", "window", FOUC_SCRIPT)(localStorage, document, window);
  return { pref: attrs.get(THEME_ATTR) ?? null, dark: classes.has(DARK_CLASS) };
}

describe("FOUC_SCRIPT — running it", () => {
  it("falls back to the system preference when reading storage throws", () => {
    expect(runFoucScript({ getItemThrows: true })).toEqual({ pref: DEFAULT_THEME_PREF, dark: false });
  });

  for (const stored of THEME_PREFS) {
    it(`keeps the stored preference ${JSON.stringify(stored)}`, () => {
      expect(runFoucScript({ stored }).pref).toBe(stored);
    });
  }

  for (const stored of ["auto", "", "Dark"]) {
    it(`replaces an unknown stored value ${JSON.stringify(stored)} with the system preference`, () => {
      expect(runFoucScript({ stored, prefersDark: true })).toEqual({ pref: DEFAULT_THEME_PREF, dark: true });
    });
  }

  it("applies a stored dark preference", () => {
    expect(runFoucScript({ stored: DARK_CLASS })).toEqual({ pref: DARK_CLASS, dark: true });
  });

  it("resolves the system preference to light in a realm without matchMedia", () => {
    expect(runFoucScript({ stored: DEFAULT_THEME_PREF, matchMedia: false })).toEqual({ pref: DEFAULT_THEME_PREF, dark: false });
  });
});
