import { expect, type Page, test } from "@playwright/test";
import { mount } from "./browser-test-helper";

/**
 * `mountViewportCollapse` against a real `<details>` and a real `matchMedia` in real Chromium.
 *
 * The controller tells its own writes from the user's by counting `toggle` events, which only holds
 * because the platform fires exactly one per change to `open`, in order — a claim about the browser
 * that a fake cannot make. The media query is a plain width query rather than a Tailwind breakpoint
 * class: the harness serves CSS raw with no Tailwind build, so nothing about viewport width is
 * observable through a `md:` utility here.
 */

declare global {
  interface Window {
    forgeViewportCollapse: typeof import("./viewport-collapse");
    forgeDispose: () => void;
    /** Every `toggle` the rail has actually **dispatched**, counted by a listener registered before
     *  the controller's. See {@link toggleCount} for why a case waits on this rather than on `open`. */
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

/**
 * How many `toggle` events the rail has **dispatched** — which is not how many times `open` changed.
 *
 * `open` moves synchronously; `toggle` is queued as a task, and the HTML spec **coalesces** it: a
 * second change while a toggle task is still pending updates that task rather than queueing another,
 * so two changes can produce one event. The controller tells its own writes from the user's by
 * counting events, so a case that drives a change while the previous event is still in flight has
 * the two collapse into one, the controller's counter absorb it, and the user's override silently
 * not register. Waiting on `open` does not close that window — `open` is already correct before the
 * event exists. Waiting on the count does.
 */
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

    // The collapsed default every existing consumer ships. A reopen here would show navigation the
    // app never asked to show, at the one width where nothing is wrong.
    await expect.poll(() => isOpen(page)).toBe(false);
  });

  test("leaves the rail open when the page starts wide", async ({ page }) => {
    await mountRail(page, WIDE);

    expect(await isOpen(page)).toBe(true);
  });

  test("stops driving the rail once the user has opened it", async ({ page }) => {
    await mountRail(page, NARROW);
    await expect.poll(() => isOpen(page)).toBe(false);
    // The controller's own close, *delivered* — not merely applied. Clicking before this event lands
    // lets the two changes coalesce into one, which the controller would charge to itself; see
    // `toggleCount`. The case would then fail at the last assertion, having proved nothing about the
    // override it exists to test.
    await expect.poll(() => toggleCount(page)).toBe(1);

    await page.click("#rail summary");
    await expect.poll(() => toggleCount(page)).toBe(2);
    expect(await isOpen(page)).toBe(true);

    // Across the breakpoint and back. Without the override rule the return to a narrow viewport
    // would shut the rail the user just opened — the "rotating the phone closes the menu" failure.
    await page.setViewportSize(WIDE);
    await page.setViewportSize(NARROW);

    await expect.poll(() => isOpen(page)).toBe(true);
  });

  test("the disposer restores the state the server rendered", async ({ page }) => {
    await mountRail(page, NARROW);
    await expect.poll(() => isOpen(page)).toBe(false);

    await page.evaluate(() => window.forgeDispose());

    expect(await isOpen(page)).toBe(true);

    // And nothing is left listening: a later crossing must not move it again.
    await page.setViewportSize(WIDE);
    await page.setViewportSize(NARROW);
    expect(await isOpen(page)).toBe(true);
  });
});
