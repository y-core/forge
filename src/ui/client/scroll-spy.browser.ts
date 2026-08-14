import { expect, type Page, test } from "@playwright/test";
import { mount } from "./browser-test-helper";

declare global {
  interface Window {
    forgeScrollSpy: typeof import("./scroll-spy");
    forgeDispose: () => void;
  }
}

/** The fixture ships its own sizes: CSS is served raw with no Tailwind build, so no utility class
 * resolves. */
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

/** Every link currently carrying the marker, by href. */
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

    await scrollTo(page, 1650);
    await expect.poll(() => marked(page)).toEqual([]);
  });
});
