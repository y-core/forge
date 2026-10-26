import { expect } from "@playwright/test";

import { classesOf, mount, pasteText, renderedClasses, SECURE_ORIGIN, test, withCompiledCss } from "./browser.fixture";

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

test.describe("withCompiledCss with script disabled", () => {
  test.use({ javaScriptEnabled: false });

  test("inlines the utilities the markup names and preflight's [hidden] rule", async ({ page }) => {
    await mount(page, await withCompiledCss(`<div id="q" class="p-4">q</div><div id="p" hidden>p</div>`));

    expect(await page.locator("#q").evaluate((el) => getComputedStyle(el).paddingTop)).toBe("16px");
    expect(await page.locator("#p").evaluate((el) => getComputedStyle(el).display)).toBe("none");
  });
});

test.describe("the class readers", () => {
  const ESCAPED = `<svg data-slot="icon" class="[[open]&gt;summary&gt;&amp;]:rotate-180 [&amp;:has(&lt;x)]:p-1 content-[&quot;a&quot;] after:content-[&#39;b&#39;]"></svg>`;
  const SOURCE_CLASSES = ["[[open]>summary>&]:rotate-180", "[&:has(<x)]:p-1", 'content-["a"]', "after:content-['b']"];

  test("hand the compiler every class as the source wrote it, not as the attribute escaped it", () => {
    expect({ rendered: renderedClasses(ESCAPED), slot: classesOf(ESCAPED, "icon") }).toEqual({ rendered: SOURCE_CLASSES, slot: SOURCE_CLASSES });
  });
});

test.describe("pasteText", () => {
  test("delivers a trusted paste the field takes as typed input, as a person's paste would", async ({ page }) => {
    await mount(page, `<input id="target" type="text">`, { origin: SECURE_ORIGIN });
    await page.evaluate(() => {
      const target = document.getElementById("target") as HTMLInputElement;
      const heard: string[] = [];
      target.addEventListener("paste", (event) => heard.push(`paste:${event.isTrusted}`));
      target.addEventListener("input", (event) => heard.push(`input:${(event as InputEvent).inputType}`));
      Object.assign(window, { heard });
      target.focus();
    });

    await pasteText(page, "12 3-4");

    expect(
      await page.evaluate(() => ({
        heard: (window as unknown as { heard: string[] }).heard,
        value: (document.getElementById("target") as HTMLInputElement).value,
      })),
    ).toEqual({ heard: ["paste:true", "input:insertFromPaste"], value: "12 3-4" });
  });
});
