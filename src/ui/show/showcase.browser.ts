import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { createIcon } from "../core/icon";
import { ShowcaseContent } from "./components";
import { showcasePaths } from "./route";

/**
 * The whole showcase page, driven.
 *
 * The epic's cut posture makes `ui/show` the living demo estate, and this is the one surface in
 * forge where a dozen primitives are composed together — so it is the honest place to assert the
 * property none of them can assert alone: **they coexist**. Every scope on this page resumes from
 * one `resume()` call, every controller mounts against markup it did not choose its neighbours for,
 * and driving one widget must not disturb another.
 *
 * Rendered by calling `ShowcaseContent` as a function with the same argument shape
 * `components.test.tsx` uses, so there is no bespoke fixture to drift from the real page.
 */

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = {
  expose: {
    forgeResume: "./ui/client/resume",
    forgeCoreClient: "./ui/core/client",
    forgeChromeClient: "./ui/chrome/client",
    forgeShowClient: "./ui/show/client",
  },
};

const icon = createIcon("/sprite.svg", {
  "icon-spinner": "0 0 24 24",
  "icon-chevron-down": "0 0 24 24",
  "icon-sun": "0 0 24 24",
  "icon-moon": "0 0 24 24",
  "icon-monitor": "0 0 24 24",
  "icon-hamburger": "0 0 24 24",
  "icon-close": "0 0 24 24",
});

async function mountShowcase(page: Page): Promise<void> {
  const html = await render(ShowcaseContent({ data: { paths: showcasePaths("/showcase") }, icon }));
  await mount(page, html, EXPOSE);
  await page.evaluate(() => window.forgeResume.resume());
}

function focusedSlot(page: Page): Promise<string | null | undefined> {
  return page.evaluate(() => document.activeElement?.getAttribute("data-slot"));
}

test.describe("the showcase page as a whole", () => {
  test("resumes every scope it stamps without a single unregistered-scope warning", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") warnings.push(message.text());
    });

    await mountShowcase(page);

    // A component whose markup names a scope has to guarantee the scope exists. This is the page
    // that would catch a primitive shipped with a `data-scope` nobody registers.
    expect(warnings.filter((text) => text.includes("[resume]"))).toEqual([]);
  });

  test("makes every toolbar on the page exactly one tab stop", async ({ page }) => {
    await mountShowcase(page);

    const stops = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[data-slot='toolbar']")].map(
        (rail) => [...rail.querySelectorAll<HTMLElement>("[data-toolbar-item]")].filter((item) => item.tabIndex === 0).length,
      ),
    );

    expect(stops.length).toBeGreaterThan(0);
    expect(stops.every((count) => count === 1)).toBe(true);
  });
});

test.describe("primitives coexisting on one page", () => {
  test("driving the tabs leaves the toolbar's tab stop where it was", async ({ page }) => {
    await mountShowcase(page);

    const before = await page.evaluate(() => document.querySelector<HTMLElement>("[data-toolbar-item]")?.tabIndex);
    await page.evaluate(() => document.querySelector<HTMLElement>("[data-slot='tab']")?.focus());
    await page.keyboard.press("ArrowRight");

    expect(await focusedSlot(page)).toBe("tab");
    // Two composites are mounted on one page; a controller that queried the document rather than its
    // own root would move the other one's tab stop too.
    expect(await page.evaluate(() => document.querySelector<HTMLElement>("[data-toolbar-item]")?.tabIndex)).toBe(before);
  });

  test("the tabs select as focus moves, and only one panel is visible", async ({ page }) => {
    await mountShowcase(page);

    await page.evaluate(() => document.querySelector<HTMLElement>("[data-slot='tab']")?.focus());
    await page.keyboard.press("ArrowRight");

    const state = await page.evaluate(() => ({
      selected: [...document.querySelectorAll("[data-slot='tab']")].filter((el) => el.getAttribute("aria-selected") === "true").length,
      visible: [...document.querySelectorAll<HTMLElement>("[data-slot='tabs-panel']")].filter((el) => !el.hidden).length,
    }));

    expect(state).toEqual({ selected: 1, visible: 1 });
  });

  test("opening the showcase menu focuses its first row and Escape gives the trigger back", async ({ page }) => {
    await mountShowcase(page);

    await page.click("[data-slot='menu-trigger']");
    await expect.poll(() => focusedSlot(page)).toBe("menu-item");

    await page.keyboard.press("Escape");

    await expect.poll(() => focusedSlot(page)).toBe("menu-trigger");
  });

  test("a menu open on the page does not steal the toolbar's keys", async ({ page }) => {
    await mountShowcase(page);
    await page.click("[data-slot='menu-trigger']");
    await expect.poll(() => focusedSlot(page)).toBe("menu-item");

    await page.keyboard.press("Escape");
    await page.evaluate(() => document.querySelector<HTMLElement>("[data-toolbar-item]")?.focus());
    await page.keyboard.press("ArrowRight");

    expect(await focusedSlot(page)).toBe("toolbar-button");
  });

  test("the native disclosures publish their open state through the shared protocol", async ({ page }) => {
    await mountShowcase(page);

    const before = await page.evaluate(() => document.querySelector("[data-slot='collapsible']")?.hasAttribute("data-open"));
    await page.click("[data-slot='collapsible-trigger']");

    // `<details>` owns open and closed; the transition controller only publishes them for CSS. This
    // is the assertion that the controller is actually mounted on the real page.
    await expect.poll(() => page.evaluate(() => document.querySelector("[data-slot='collapsible']")?.hasAttribute("data-open"))).toBe(!before);
  });

  test("the number field's steppers are live, which only an eager scope makes true", async ({ page }) => {
    await mountShowcase(page);

    const before = await page.evaluate(() => document.querySelector<HTMLInputElement>("[data-slot='number-field-input']")?.value);
    await page.click("[data-slot='number-field-increment']");

    // The steppers carry no `data-on-*` action, so a lazy scope would have nothing to resume it and
    // the buttons would sit inert on the page.
    const after = await page.evaluate(() => document.querySelector<HTMLInputElement>("[data-slot='number-field-input']")?.value);
    expect(after).not.toBe(before);
  });
});

test.describe("the showcase's own filter island", () => {
  /** The labels of the filter items still shown, and the count the island renders beside them. */
  function shown(page: Page): Promise<{ labels: string[]; count: string | null | undefined }> {
    return page.evaluate(() => ({
      labels: [...document.querySelectorAll<HTMLElement>("[data-filter-item]")]
        .filter((el) => !el.hidden)
        .map((el) => (el.textContent ?? "").trim()),
      count: document.querySelector("[data-ref='count']")?.textContent,
    }));
  }

  test("typing in the filter hides the items that do not match and updates the count", async ({ page }) => {
    await mountShowcase(page);
    const all = await shown(page);
    expect(all.labels.length).toBeGreaterThan(1);

    await page.fill("#filter-input", all.labels[0] ?? "");

    const after = await shown(page);
    expect(after.labels.length).toBeLessThan(all.labels.length);
    expect(after.count).toBe(String(after.labels.length));
  });

  test("clearing the filter restores every item", async ({ page }) => {
    await mountShowcase(page);
    const all = await shown(page);

    await page.fill("#filter-input", "zzz-matches-nothing");
    expect((await shown(page)).labels).toEqual([]);
    await page.fill("#filter-input", "");

    // A scope like any other, mounted alongside a dozen controllers — its own state has to survive
    // being one island among many.
    expect(await shown(page)).toEqual(all);
  });
});
