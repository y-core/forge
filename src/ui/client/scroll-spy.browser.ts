import { expect, type Page, test } from "@playwright/test";
import { mount } from "./browser-test-helper";

/**
 * `mountScrollSpy` against a real `IntersectionObserver` in real Chromium.
 *
 * The unit set proves the bookkeeping over a fake observer; only the browser can answer whether the
 * default `rootMargin` actually picks the section at the top of the viewport, and whether the
 * handoff happens at the moment the reader would expect it.
 */

declare global {
  interface Window {
    forgeScrollSpy: typeof import("./scroll-spy");
    forgeDispose: () => void;
  }
}

/**
 * The fixture ships its own sizes. `browser-test-helper` serves CSS raw with no Tailwind build, so
 * no utility class resolves — a spec that needs a section to be 800px tall has to say so in a rule
 * of its own or measure nothing at all.
 */
const FIXTURE = `
<style>
  body { margin: 0 }
  nav { position: fixed; top: 0; left: 0 }
  section { height: 800px }
</style>
<nav id="toc">
  <a href="#one">One</a>
  <a href="#two">Two</a>
  <a href="#three">Three</a>
</nav>
<section id="one">One</section>
<section id="two">Two</section>
<section id="three">Three</section>
`;

async function mountSpy(page: Page): Promise<void> {
  await mount(page, FIXTURE, { expose: { forgeScrollSpy: "./ui/client/scroll-spy" } });
  await page.evaluate(() => {
    const root = document.querySelector("#toc");
    if (root) window.forgeDispose = window.forgeScrollSpy.mountScrollSpy({ root });
  });
}

/** Every link currently carrying the marker, by href — so "exactly one, and which" is one assertion. */
function marked(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll("#toc a[aria-current='location']")].map((el) => el.getAttribute("href") ?? ""));
}

async function scrollTo(page: Page, y: number): Promise<void> {
  await page.evaluate((top) => window.scrollTo(0, top), y);
}

test.describe("mountScrollSpy", () => {
  test("marks the section at the top of the viewport, and hands the marker on as the reader scrolls", async ({ page }) => {
    await mountSpy(page);

    await expect.poll(() => marked(page)).toEqual(["#one"]);

    await scrollTo(page, 850);

    // Both directions of the handoff in one assertion: the previous link is gone from the list and
    // the new one is in it. A marker that moved without being removed would read as two entries.
    await expect.poll(() => marked(page)).toEqual(["#two"]);

    await scrollTo(page, 1650);

    await expect.poll(() => marked(page)).toEqual(["#three"]);
  });

  test("scrolling back restores the earlier section's marker", async ({ page }) => {
    await mountSpy(page);
    await scrollTo(page, 1650);
    await expect.poll(() => marked(page)).toEqual(["#three"]);

    await scrollTo(page, 0);

    await expect.poll(() => marked(page)).toEqual(["#one"]);
  });

  test("the disposer leaves no marked link behind", async ({ page }) => {
    await mountSpy(page);
    await scrollTo(page, 850);
    await expect.poll(() => marked(page)).toEqual(["#two"]);

    await page.evaluate(() => window.forgeDispose());

    await expect.poll(() => marked(page)).toEqual([]);

    // And it stays gone: a disconnected observer must not deliver one last record.
    await scrollTo(page, 1650);
    await expect.poll(() => marked(page)).toEqual([]);
  });
});
