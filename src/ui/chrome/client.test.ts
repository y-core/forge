import { describe, expect, it } from "bun:test";
// Side-effect import: registers the "theme" and "navbar" scopes at module load time
// (top-level `registerScope` calls; no DOM access at import time).
import { isDark } from "./client";

/**
 * What is left of this file once the scopes are proven in a real browser.
 *
 * The theme cycle, the `prefers-color-scheme` resolution, the `localStorage` persistence and the
 * `navbar:filters` sync all live in `client.browser.ts` now — they are DOM behaviour, and the
 * hand-rolled harness that used to stand in for a document, a media query and local storage could
 * only ever assert against its own model of the platform. Two of the cases that replaced it were
 * unreachable from it at any price: a colour scheme the browser actually resolves, and a live media
 * change arriving after resume.
 *
 * This one case stays here because it needs no DOM at all — it is a fact about a module binding.
 */

describe("isDark — stable accessor", () => {
  it("reads false until the theme scope resumes (no theme scope resumed here)", () => {
    // The exported binding is a stable object; reading `.value` delegates to the
    // module-local current signal, which is the `false` stub until theme setup runs.
    expect(isDark.value).toBe(false);
  });
});
