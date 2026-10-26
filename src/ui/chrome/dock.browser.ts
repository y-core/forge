import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { mount, withCompiledCss } from "../client/browser.fixture";
import type { Size } from "../contracts/types";
import { createIcon } from "../core/icon";
import { Dock } from "./dock";
import type { DockHideAbove, DockItem } from "./types";

const icon = createIcon("/sprite.svg", { "icon-home": "0 0 24 24", "icon-search": "0 0 24 24", "icon-user": "0 0 24 24" });

const ITEMS: DockItem<"home" | "search" | "user">[] = [
  { label: "Home", href: "home", icon: "home", current: true },
  { label: "Search", href: "search", icon: "search" },
  { label: "Profile", href: "profile", icon: "user" },
];

const BUTTONS = 40;

const MAIN = `<main>${Array.from({ length: BUTTONS }, (_, i) => `<button id="b${i + 1}" class="block h-10 w-full">b${i + 1}</button>`).join("")}</main>`;

function dock(props: { size?: Size; hideAbove?: DockHideAbove } = {}): Promise<string> {
  return render(Dock({ items: ITEMS, resolveHref: (k) => `#${k}`, icon, ...props }));
}

function focusedAndHit(page: Page): Promise<{ focused: string | undefined; hit: string | undefined }> {
  return page.evaluate(() => {
    const focused = document.activeElement;
    const rect = (focused as Element).getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { focused: focused?.id, hit: hit?.closest("button")?.id };
  });
}

function clearance(page: Page): Promise<{ nav: number; scroll: number; body: number }> {
  return page.evaluate(() => ({
    nav: (document.querySelector("[data-slot~='dock']") as Element).getBoundingClientRect().height,
    scroll: parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom),
    body: parseFloat(getComputedStyle(document.body).paddingBottom),
  }));
}

test.describe("Dock — a focused control is never hidden beneath the bar", { tag: "@cross-engine" }, () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("every button reached by Tab is the element at its own centre, the last one included", async ({ page }) => {
    const html = `${MAIN}${await dock()}`;
    await mount(page, await withCompiledCss(html));
    await page.locator("#b1").focus();

    const seen = [await focusedAndHit(page)];
    for (let n = 2; n <= BUTTONS; n++) {
      await page.keyboard.press("Tab");
      seen.push(await focusedAndHit(page));
    }

    expect(seen).toEqual(Array.from({ length: BUTTONS }, (_, i) => ({ focused: `b${i + 1}`, hit: `b${i + 1}` })));
  });

  for (const size of ["sm", "md", "lg"] as const) {
    test(`a ${size} dock reserves its own height as the page's scroll padding and body padding`, async ({ page }) => {
      const html = await dock({ size });
      await mount(page, await withCompiledCss(html));

      const { nav, scroll, body } = await clearance(page);
      expect({ scroll, body }).toEqual({ scroll: nav, body: nav });
      expect(nav).toBeGreaterThan(0);
    });
  }
});

test.describe("Dock — gives the clearance back above its breakpoint", { tag: "@cross-engine" }, () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("a dock hidden above md leaves the page no scroll padding and no body padding", async ({ page }) => {
    const html = `${MAIN}${await dock()}`;
    await mount(page, await withCompiledCss(html));

    expect(
      await page.evaluate(() => ({
        scroll: getComputedStyle(document.documentElement).scrollPaddingBottom,
        body: getComputedStyle(document.body).paddingBottom,
      })),
    ).toEqual({ scroll: "0px", body: "0px" });
  });

  test("a dock that never hides keeps reserving its height at desktop width", async ({ page }) => {
    const html = `${MAIN}${await dock({ hideAbove: "never" })}`;
    await mount(page, await withCompiledCss(html));

    const { nav, scroll, body } = await clearance(page);
    expect({ scroll, body }).toEqual({ scroll: nav, body: nav });
    expect(nav).toBeGreaterThan(0);
  });
});
