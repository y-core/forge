import { describe, expect, it } from "bun:test";
import { DARK_CLASS, DEFAULT_PREF, FOUC_SCRIPT, THEME_ATTR, THEME_STORAGE_KEY } from "./theme";

describe("theme constants", () => {
  it("exposes the documented constant values", () => {
    expect(THEME_STORAGE_KEY).toBe("themePreference");
    expect(THEME_ATTR).toBe("data-theme-preference");
    expect(DARK_CLASS).toBe("dark");
    expect(DEFAULT_PREF).toBe("system");
  });
});

describe("FOUC_SCRIPT", () => {
  it("interpolates every theme constant value (no drift from the constants)", () => {
    expect(FOUC_SCRIPT).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}")`);
    expect(FOUC_SCRIPT).toContain(`||"${DEFAULT_PREF}"`);
    expect(FOUC_SCRIPT).toContain(`setAttribute("${THEME_ATTR}",e)`);
    expect(FOUC_SCRIPT).toContain(`e==="${DARK_CLASS}"`);
    expect(FOUC_SCRIPT).toContain(`e==="${DEFAULT_PREF}"`);
    expect(FOUC_SCRIPT).toContain(`classList.add("${DARK_CLASS}")`);
  });

  it("is a self-invoking IIFE", () => {
    expect(FOUC_SCRIPT.startsWith("(function(){")).toBe(true);
    expect(FOUC_SCRIPT.endsWith("})();")).toBe(true);
  });

  it("cannot break out of a <script> tag", () => {
    // The only breakout vector inside a raw <script> element is a literal closing tag.
    expect(FOUC_SCRIPT.toLowerCase()).not.toContain("</script");
    // Every quote is a balanced string delimiter — no dangling/unescaped quote.
    expect((FOUC_SCRIPT.match(/"/g) ?? []).length % 2).toBe(0);
    expect(FOUC_SCRIPT).not.toContain("'");
  });
});
