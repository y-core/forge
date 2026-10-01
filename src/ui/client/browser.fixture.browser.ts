import { expect } from "@playwright/test";

import { classesOf, mount, renderedClasses, test } from "./browser.fixture";

const NO_PREFERENCE_RULE = `<style>@media (prefers-reduced-motion: no-preference) { #probe { translate: 100px; } }</style><div id="probe">probe</div>`;

const prefersReduce = (page: import("@playwright/test").Page): Promise<boolean> =>
  page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);

test.describe("the harness without a media option", () => {
  test("leaves the page on the no-preference branch", async ({ page }) => {
    await mount(page, NO_PREFERENCE_RULE);
    expect(await prefersReduce(page)).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#probe") as HTMLElement).translate)).toBe("100px");
  });
});

test.describe("the harness under test.use({ reducedMotion })", () => {
  test.use({ reducedMotion: "reduce" });

  test("reaches the page before any markup lands", async ({ page }) => {
    expect(await prefersReduce(page)).toBe(true);
  });

  test("survives the origin navigation mount performs", async ({ page }) => {
    await mount(page, NO_PREFERENCE_RULE);
    expect(await prefersReduce(page)).toBe(true);
  });

  test("takes a no-preference rule out of the cascade", async ({ page }) => {
    await mount(page, NO_PREFERENCE_RULE);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#probe") as HTMLElement).translate)).toBe("none");
  });
});

test.describe("the harness under test.use({ forcedColors })", () => {
  test.use({ forcedColors: "active" });

  test("reaches the page", async ({ page }) => {
    await mount(page, "<div>probe</div>");
    expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
  });
});

test.describe("the class readers", () => {
  const ESCAPED = `<svg data-slot="icon" class="[[open]&gt;summary&gt;&amp;]:rotate-180 [&amp;:has(&lt;x)]:p-1 content-[&quot;a&quot;] after:content-[&#39;b&#39;]"></svg>`;
  const SOURCE_CLASSES = ["[[open]>summary>&]:rotate-180", "[&:has(<x)]:p-1", 'content-["a"]', "after:content-['b']"];

  test("hand the compiler every class as the source wrote it, not as the attribute escaped it", () => {
    expect({ rendered: renderedClasses(ESCAPED), slot: classesOf(ESCAPED, "icon") }).toEqual({ rendered: SOURCE_CLASSES, slot: SOURCE_CLASSES });
  });
});
