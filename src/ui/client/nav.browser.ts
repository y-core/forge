import { expect, type Page, test } from "@playwright/test";
import { mount } from "./browser-test-helper";

/**
 * `mountNav` against a real document.
 *
 * The harness this replaces built its own `document`, its own elements and its own listener
 * registry, so every case asserted what the mock recorded rather than what a browser did — an
 * outside click was a hand-invoked callback, not a click. Here the clicks are clicks.
 */

declare global {
  interface Window {
    forgeNav: typeof import("./nav");
    cleanupNav?: () => void;
  }
}

const EXPOSE = { expose: { forgeNav: "./ui/client/nav" } };

const MARKUP =
  '<button data-ref="nav-toggle">Menu</button>' +
  '<div data-ref="nav-menu" class="hidden"><a id="link" data-ref="nav-link" href="#x">Link</a></div>' +
  '<button id="outside">outside</button>';

async function install(page: Page, html: string = MARKUP): Promise<void> {
  await mount(page, html, EXPOSE);
  await page.evaluate(() => {
    window.cleanupNav = window.forgeNav.mountNav();
  });
}

/** The two things the controller writes: the menu's `hidden` class and the toggle's `aria-expanded`. */
function state(page: Page): Promise<{ hidden: boolean; expanded: string | null }> {
  return page.evaluate(() => ({
    hidden: document.querySelector("[data-ref='nav-menu']")?.classList.contains("hidden") ?? true,
    expanded: document.querySelector("[data-ref='nav-toggle']")?.getAttribute("aria-expanded") ?? null,
  }));
}

test.describe("mountNav — opening and closing", () => {
  test("starts closed with aria-expanded=false", async ({ page }) => {
    await install(page);

    expect(await state(page)).toEqual({ hidden: true, expanded: "false" });
  });

  test("the toggle opens the menu and announces it", async ({ page }) => {
    await install(page);

    await page.click("[data-ref='nav-toggle']");

    expect(await state(page)).toEqual({ hidden: false, expanded: "true" });
  });

  test("the toggle closes it again", async ({ page }) => {
    await install(page);

    await page.click("[data-ref='nav-toggle']");
    await page.click("[data-ref='nav-toggle']");

    expect(await state(page)).toEqual({ hidden: true, expanded: "false" });
  });

  test("Escape closes it", async ({ page }) => {
    await install(page);
    await page.click("[data-ref='nav-toggle']");

    await page.keyboard.press("Escape");

    expect((await state(page)).hidden).toBe(true);
  });

  test("a real click outside closes it", async ({ page }) => {
    await install(page);
    await page.click("[data-ref='nav-toggle']");

    await page.click("#outside");

    expect((await state(page)).hidden).toBe(true);
  });

  test("a click inside the menu leaves it open", async ({ page }) => {
    await install(page);
    await page.click("[data-ref='nav-toggle']");

    await page.click("[data-ref='nav-menu']");

    // The outside-click handler asks whether the menu contains the target. Only a real event has a
    // target to ask about.
    expect((await state(page)).hidden).toBe(false);
  });

  test("following a nav link closes it", async ({ page }) => {
    await install(page);
    await page.click("[data-ref='nav-toggle']");

    await page.click("#link");

    expect((await state(page)).hidden).toBe(true);
  });
});

test.describe("mountNav — mounting contract", () => {
  test("mounting twice on the same toggle returns the same cleanup and adds no second listener", async ({ page }) => {
    await install(page);

    const same = await page.evaluate(() => window.forgeNav.mountNav() === window.cleanupNav);
    await page.click("[data-ref='nav-toggle']");

    // A second listener would toggle twice per click and the menu would never open.
    expect(same).toBe(true);
    expect((await state(page)).hidden).toBe(false);
  });

  test("cleanup removes every listener it installed", async ({ page }) => {
    await install(page);
    await page.evaluate(() => window.cleanupNav?.());

    await page.click("[data-ref='nav-toggle']");

    expect((await state(page)).hidden).toBe(true);
  });

  test("a no-op cleanup is returned when the elements are missing", async ({ page }) => {
    await mount(page, "<div>nothing to mount</div>", EXPOSE);

    const threw = await page.evaluate(() => {
      try {
        window.forgeNav.mountNav()();
        return null;
      } catch (error) {
        return String(error);
      }
    });

    expect(threw).toBeNull();
  });
});
