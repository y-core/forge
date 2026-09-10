import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { compiledCss, mount } from "../client/browser-test-helper";

const STRIP = "flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain rounded-box [scrollbar-width:thin] motion-safe:scroll-smooth";

// The markup `Carousel` renders, written out so the spec reads the same classes the component emits
// and compiles exactly those; the dot row is reduced to the anchors that matter.
function carousel(snap: "start" | "center"): string {
  const items = [1, 2, 3]
    .map(
      (n) =>
        `<div id="c-${n}" data-slot="carousel-item" role="group" aria-roledescription="slide" aria-label="Slide ${n}" class="w-full shrink-0 snap-${snap}">${n}</div>`,
    )
    .join("");
  const dots = [1, 2, 3].map((n) => `<a href="#c-${n}" aria-label="Slide ${n}">${n}</a>`).join("");
  return (
    `<div style="width:300px">` +
    `<div data-slot="carousel" data-snap="${snap}" class="relative"><div data-slot="carousel-strip" role="group" aria-label="Slides" tabindex="0" class="${STRIP}">${items}</div></div>` +
    `<nav>${dots}</nav></div>`
  );
}

async function mountCarousel(page: Page, snap: "start" | "center"): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mount(page, carousel(snap));
  await page.addStyleTag({ content: await compiledCss([...STRIP.split(" "), "relative", "w-full", "shrink-0", `snap-${snap}`]) });
}

interface Geometry {
  scrollLeft: number;
  stripLeft: number;
  stripWidth: number;
  itemLeft: number;
  itemWidth: number;
}

function geometry(page: Page, id: string): Promise<Geometry> {
  return page.evaluate((targetId) => {
    const strip = document.querySelector("[data-slot='carousel-strip']") as HTMLElement;
    const item = document.getElementById(targetId) as HTMLElement;
    return {
      scrollLeft: strip.scrollLeft,
      stripLeft: strip.offsetLeft,
      stripWidth: strip.clientWidth,
      itemLeft: item.offsetLeft,
      itemWidth: item.offsetWidth,
    };
  }, id);
}

test("a dot anchor scrolls its slide to the strip's start with no script", async ({ page }) => {
  await mountCarousel(page, "start");
  expect((await geometry(page, "c-1")).scrollLeft).toBe(0);

  await page.click("a[href='#c-2']");
  const after = await geometry(page, "c-2");
  expect(after.itemWidth).toBe(after.stripWidth);
  expect(Math.abs(after.scrollLeft - (after.itemLeft - after.stripLeft))).toBeLessThanOrEqual(1);
});

test("a centre-snapping slide settles on the strip's centre", async ({ page }) => {
  await mountCarousel(page, "center");
  await page.click("a[href='#c-2']");
  const after = await geometry(page, "c-2");
  const itemCentre = after.itemLeft - after.stripLeft + after.itemWidth / 2 - after.scrollLeft;
  expect(Math.abs(itemCentre - after.stripWidth / 2)).toBeLessThanOrEqual(1);
});

// WCAG 2.1.1: the strip is the scrolling region, and without a tab stop a keyboard-only reader can
// reach every dot and still never scroll the content between them. Chromium focuses a scrollable
// element even without `tabindex`, so this proves the *behaviour* and not the attribute — that the
// strip carries `tabindex={0}` for the browsers that do not is `carousel.test.tsx`'s exact-HTML
// assertion.
test("the strip takes focus from the keyboard and scrolls with the arrow keys", async ({ page }) => {
  await mountCarousel(page, "start");

  await page.focus("[data-slot='carousel-strip']");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("carousel-strip");

  await page.keyboard.press("ArrowRight");

  await expect
    .poll(() => page.evaluate(() => (document.querySelector("[data-slot='carousel-strip']") as HTMLElement).scrollLeft))
    .toBeGreaterThan(0);
});
