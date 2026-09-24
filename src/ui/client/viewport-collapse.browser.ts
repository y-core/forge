import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { mount } from "./browser.fixture";

declare global {
  interface Window {
    forgeViewportCollapse: typeof import("./viewport-collapse");
    forgeDispose: () => void;
    /** Every `toggle` the rail has actually dispatched. See {@link toggleCount}. */
    forgeToggles: number;
  }
}

const QUERY = "(max-width: 600px)";

const fixture = (open: boolean) => `
<details ${open ? "open" : ""} id="rail">
  <summary>Menu</summary>
  <a href="#one">One</a>
</details>
`;

// A transition long enough that no case outlives it, on a property the platform animates discretely.
const TRANSITION_STYLE = `<style>
  #rail::details-content { content-visibility: visible }
  #rail a { transition: visibility 1s }
  #rail:not([open]) a { visibility: hidden }
</style>`;

const NARROW = { width: 500, height: 700 };
const WIDE = { width: 900, height: 700 };

async function mountRail(page: Page, size: { width: number; height: number }, open = true, style = ""): Promise<void> {
  await page.setViewportSize(size);
  await mount(page, `${style}${fixture(open)}`, { expose: { forgeViewportCollapse: "./ui/client/viewport-collapse" } });
  await page.evaluate((query) => {
    window.forgeToggles = 0;
    // Registered before the controller's own listener, so a dispatched `toggle` is counted whether or
    // not the controller claims it as its own write.
    document.querySelector("#rail")?.addEventListener("toggle", () => {
      window.forgeToggles += 1;
    });
    window.forgeDispose = window.forgeViewportCollapse.mountViewportCollapse({ selector: "#rail", query });
  }, QUERY);
}

function isOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => document.querySelector<HTMLDetailsElement>("#rail")?.open ?? false);
}

/** Every CSS transition running under the rail, by the property it animates. */
function railTransitions(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (document.querySelector("#rail")?.getAnimations({ subtree: true }) ?? []).flatMap((animation) =>
      animation instanceof CSSTransition ? [animation.transitionProperty] : [],
    ),
  );
}

/** How many `toggle` events the rail dispatched; the spec coalesces a pending toggle task, so cases wait on this, not `open`. */
function toggleCount(page: Page): Promise<number> {
  return page.evaluate(() => window.forgeToggles);
}

test.describe("mountViewportCollapse", () => {
  test("closes the SSR-open rail below the breakpoint and reopens it above", async ({ page }) => {
    await mountRail(page, NARROW);

    await expect.poll(() => isOpen(page)).toBe(false);

    await page.setViewportSize(WIDE);

    await expect.poll(() => isOpen(page)).toBe(true);
  });

  test("never opens a rail the server rendered closed", async ({ page }) => {
    await mountRail(page, NARROW, false);
    expect(await isOpen(page)).toBe(false);

    await page.setViewportSize(WIDE);

    await expect.poll(() => isOpen(page)).toBe(false);
  });

  test("leaves the rail open when the page starts wide", async ({ page }) => {
    await mountRail(page, WIDE);

    expect(await isOpen(page)).toBe(true);
  });

  test("stops driving the rail once the user has opened it", async ({ page }) => {
    await mountRail(page, NARROW);
    await expect.poll(() => isOpen(page)).toBe(false);
    // Waits for the controller's close to be *delivered*: clicking before it lands lets the two
    // changes coalesce into one, which the controller would charge to itself. See `toggleCount`.
    await expect.poll(() => toggleCount(page)).toBe(1);

    await page.click("#rail summary");
    await expect.poll(() => toggleCount(page)).toBe(2);
    expect(await isOpen(page)).toBe(true);

    await page.setViewportSize(WIDE);
    await page.setViewportSize(NARROW);

    await expect.poll(() => isOpen(page)).toBe(true);
  });

  test("the disposer restores the state the server rendered", async ({ page }) => {
    await mountRail(page, NARROW);
    await expect.poll(() => isOpen(page)).toBe(false);

    await page.evaluate(() => window.forgeDispose());

    expect(await isOpen(page)).toBe(true);

    await page.setViewportSize(WIDE);
    await page.setViewportSize(NARROW);
    expect(await isOpen(page)).toBe(true);
  });

  test("lands the collapse it makes at mount rather than playing it", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await mount(page, `${TRANSITION_STYLE}${fixture(true)}`, { expose: { forgeViewportCollapse: "./ui/client/viewport-collapse" } });

    const settled = await page.evaluate((query) => {
      window.forgeViewportCollapse.mountViewportCollapse({ selector: "#rail", query });
      const rail = document.querySelector<HTMLDetailsElement>("#rail");
      const link = document.querySelector("#rail a");
      if (rail === null || link === null) throw new Error("the rail fixture is not on the page");
      return { open: rail.open, transitions: rail.getAnimations({ subtree: true }).length, visibility: getComputedStyle(link).visibility };
    }, QUERY);

    expect(settled).toEqual({ open: false, transitions: 0, visibility: "hidden" });
  });

  test("still animates a collapse across the breakpoint after mount", async ({ page }) => {
    await mountRail(page, WIDE, true, TRANSITION_STYLE);

    await page.setViewportSize(NARROW);
    await expect.poll(() => isOpen(page)).toBe(false);

    expect(await railTransitions(page)).toContain("visibility");
  });
});
