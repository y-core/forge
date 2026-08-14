import { expect, type Page, test } from "@playwright/test";
import { jsx } from "../../jsx/jsx-runtime";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { ScrollArea } from "./scroll-area";

// The test page loads no Tailwind, so without a bound root nothing overflows and every case below passes
// vacuously. `max-h-[inherit]` on the viewport is stubbed alongside `h-full` because the two together are
// what bind the scrolling element under either kind of root.
const VIEWPORT_STYLE = "[data-slot~='scroll-area-viewport'] { height: 100%; max-height: inherit; overflow: auto; }";

// A root sized by `h-*`: the height is definite, so `h-full` alone already binds the viewport.
const DEFINITE_STYLES = `<style>
  [data-slot~='scroll-area'] { height: 96px; width: 192px; }
  ${VIEWPORT_STYLE}
</style>`;

// A root sized by `max-h-*` — how the log viewer uses it. The height is indefinite, so `h-full` collapses to
// `auto` and only the inherited max-height stops the viewport growing to its content and spilling out.
const BOUNDED_STYLES = `<style>
  [data-slot~='scroll-area'] { max-height: 96px; width: 192px; }
  ${VIEWPORT_STYLE}
</style>`;

async function markup(styles: string = DEFINITE_STYLES): Promise<string> {
  const rows = Array.from({ length: 40 }, (_, i) => jsx("p", { children: `row ${i}` }));
  const html = await render(ScrollArea({ id: "area", children: ScrollArea.Viewport({ id: "viewport", children: rows }) }));
  return `${styles}${html}`;
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

test("a root bounded by max-height scrolls instead of spilling its content past the root", async ({ page }) => {
  await mount(page, await markup(BOUNDED_STYLES));

  const boxes = await page.evaluate(() => {
    const root = document.querySelector("#area");
    const viewport = document.querySelector("#viewport");
    if (!root || !viewport) return null;
    return { rootHeight: root.getBoundingClientRect().height, viewportHeight: viewport.getBoundingClientRect().height };
  });

  // Both stay at the bound: a viewport grown to its 40 rows would report far more than 96 and paint outside the root.
  expect(boxes).toEqual({ rootHeight: 96, viewportHeight: 96 });
});
