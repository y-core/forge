import { expect, type Page, test } from "@playwright/test";
import { jsx } from "../../jsx/jsx-runtime";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { ScrollArea } from "./scroll-area";

/**
 * No module is exposed, because there is none to expose. These cases assert that the region scrolls
 * with nothing loaded at all — the property that separates this component from every custom
 * scrollbar that breaks when its script fails.
 */

/** The component's own classes are Tailwind, which the test page does not load — so the bounding
 * height comes from a stylesheet here. Without a bound height nothing overflows and there is nothing
 * to scroll, which would make every case below pass vacuously. */
const STYLES = `<style>
  [data-slot='scroll-area'] { height: 96px; width: 192px; }
  [data-slot='scroll-area-viewport'] { height: 100%; overflow: auto; }
</style>`;

async function markup(): Promise<string> {
  const rows = Array.from({ length: 40 }, (_, i) => jsx("p", { children: `row ${i}` }));
  const html = await render(ScrollArea({ id: "area", children: ScrollArea.Viewport({ id: "viewport", children: rows }) }));
  return `${STYLES}${html}`;
}

function scrollTop(page: Page): Promise<number | undefined> {
  return page.evaluate(() => document.querySelector("#viewport")?.scrollTop);
}

test("scrolls with the wheel and no JavaScript loaded", async ({ page }) => {
  await mount(page, await markup());

  await page.hover("#viewport");
  await page.mouse.wheel(0, 200);

  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
});

test("scrolls from the keyboard, which requires the viewport to be focusable", async ({ page }) => {
  await mount(page, await markup());

  await page.focus("#viewport");
  await page.keyboard.press("PageDown");

  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
});

test("the viewport overflows rather than clipping", async ({ page }) => {
  await mount(page, await markup());

  const overflow = await page.evaluate(() => {
    const el = document.querySelector("#viewport");
    if (!el) return null;
    return { css: getComputedStyle(el).overflowY, scrollable: el.scrollHeight > el.clientHeight };
  });

  expect(overflow).toEqual({ css: "auto", scrollable: true });
});
