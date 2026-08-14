import { expect, type Page, test } from "@playwright/test";
import { mount } from "./browser-test-helper";

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

const NARROW = { width: 500, height: 700 };
const WIDE = { width: 900, height: 700 };

async function mountRail(page: Page, size: { width: number; height: number }, open = true): Promise<void> {
  await page.setViewportSize(size);
  await mount(page, fixture(open), { expose: { forgeViewportCollapse: "./ui/client/viewport-collapse" } });
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

/** How many `toggle` events the rail has dispatched, which is not how many times `open` changed:
 * the HTML spec coalesces a toggle task still pending, so a case must wait on the count and never
 * on `open`, which is already correct before the event exists. */
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
});
