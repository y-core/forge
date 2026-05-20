import { describe, expect, it } from "bun:test";
import { DARK_CLASS, DEFAULT_PREF, THEME_ATTR, THEME_STORAGE_KEY } from "./theme-constants";
import { FOUC_SCRIPT } from "./theme-fouc";

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

  it("checks prefers-color-scheme media query for system mode", () => {
    expect(FOUC_SCRIPT).toContain(`prefers-color-scheme: dark`);
  });
});
