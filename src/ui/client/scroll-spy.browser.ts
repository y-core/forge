import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { mount } from "./browser.fixture";

declare global {
  interface Window {
    forgeScrollSpy: typeof import("./scroll-spy");
    forgeDispose: () => void;
  }
}

/** The fixture ships its own sizes: CSS is served raw with no Tailwind build, so no utility class resolves. */
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

/** Adjacent sections under a sticky header, each declaring the offset a fragment jump lands at. */
const STICKY_FIXTURE = `
<style>
  body { margin: 0 }
  header { position: sticky; top: 0; height: 80px; background: white }
  nav { position: fixed; top: 0; left: 0; z-index: 1 }
  section { height: 800px; scroll-margin-top: 96px }
</style>
<nav id="toc">
  <a href="#one">One</a>
  <a href="#two">Two</a>
  <a href="#three">Three</a>
</nav>
<header>Header</header>
<section id="one">One</section>
<section id="two">Two</section>
<section id="three">Three</section>
`;

async function mountSpy(page: Page, fixture = FIXTURE): Promise<void> {
  await mount(page, fixture, { expose: { forgeScrollSpy: "./ui/client/scroll-spy" } });
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

async function jumpTo(page: Page, id: string): Promise<void> {
  await page.evaluate((target) => document.getElementById(target)?.scrollIntoView({ behavior: "instant" }), id);
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

  test("a section whose top sits exactly at the viewport's top edge is the one marked, not the one ending there", async ({ page }) => {
    await mountSpy(page);

    await scrollTo(page, 800);

    await expect.poll(() => marked(page)).toEqual(["#two"]);
  });
});

test.describe("mountScrollSpy under a sticky header", () => {
  test("marks the section a fragment jump lands, not the tail of the one above hidden behind the header", async ({ page }) => {
    await mountSpy(page, STICKY_FIXTURE);

    await jumpTo(page, "two");
    await expect.poll(() => marked(page)).toEqual(["#two"]);

    await jumpTo(page, "three");
    await expect.poll(() => marked(page)).toEqual(["#three"]);
  });

  test("keeps the previous section marked while its tail is still visible below the offset", async ({ page }) => {
    await mountSpy(page, STICKY_FIXTURE);
    const top = await page.evaluate(() => document.getElementById("two")?.offsetTop ?? 0);

    await scrollTo(page, top - 150);

    await expect.poll(() => marked(page)).toEqual(["#one"]);
  });

  test("reads the offset from the root element's scroll-padding-top", async ({ page }) => {
    await mountSpy(page, `${STICKY_FIXTURE}<style>html { scroll-padding-top: 96px } section { scroll-margin-top: 0 }</style>`);

    await jumpTo(page, "two");

    await expect.poll(() => marked(page)).toEqual(["#two"]);
  });

  test("resolves a percentage scroll-padding-top against the viewport", async ({ page }) => {
    await mountSpy(page, `${STICKY_FIXTURE}<style>html { scroll-padding-top: 15% } section { scroll-margin-top: 0 }</style>`);

    await jumpTo(page, "two");

    await expect.poll(() => marked(page)).toEqual(["#two"]);
  });
});
