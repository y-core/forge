import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { mount } from "./browser.fixture";

declare global {
  interface Window {
    forgeDrawer: typeof import("./drawer");
  }
}

const FIXTURE = `<style>
  body { margin: 0 }
  #drawer::details-content { content-visibility: visible }
  summary { position: fixed; top: 0; right: 0 }
  #panel { position: fixed; inset: 0 auto 0 0; width: 200px; visibility: hidden; transition: visibility 200ms }
  #drawer[open] #panel { visibility: visible }
</style>
<details id="drawer">
  <summary>Menu</summary>
  <div id="panel"><a id="first" href="#first">First</a><a href="#second">Second</a></div>
</details>
<div id="page" style="height: 3000px">page content</div>`;

async function mountVisibilityPanel(page: Page): Promise<void> {
  await mount(page, FIXTURE, { expose: { forgeDrawer: "./ui/client/drawer" } });
  await page.evaluate(() => {
    window.scrollTo(0, 500);
    window.forgeDrawer.mountNavDrawer({ selector: "#drawer", query: "all" });
  });
}

const scrollY = (page: Page): Promise<number> => page.evaluate(() => Math.round(window.scrollY));

test.describe("mountNavDrawer — a panel that transitions `visibility` on open", () => {
  test.use({ reducedMotion: "no-preference" });

  test("focus lands on the panel's first item once it shows, and the page does not scroll", async ({ page }) => {
    await mountVisibilityPanel(page);

    await page.click("summary");

    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("first");
    expect(await scrollY(page)).toBe(500);
  });
});

const POPOVER_FIXTURE = `<details id="drawer" open>
  <summary>Menu</summary>
  <div id="panel"><button id="opener" popovertarget="menu">Open menu</button><div id="menu" popover><button id="item">Item</button></div></div>
</details>`;

test.describe("mountNavDrawer — a popover open inside the panel", () => {
  test("leaves the Escape that light-dismisses the popover to it, and closes on the next", async ({ page }) => {
    await mount(page, POPOVER_FIXTURE, { expose: { forgeDrawer: "./ui/client/drawer" } });
    await page.evaluate(() => window.forgeDrawer.mountNavDrawer({ selector: "#drawer", query: "all", panelSelector: "#panel" }));
    await page.click("#opener");
    await page.focus("#item");
    const state = () =>
      page.evaluate(() => [
        document.querySelector("#menu")?.matches(":popover-open"),
        (document.querySelector("#drawer") as HTMLDetailsElement).open,
      ]);
    expect(await state()).toEqual([true, true]);

    await page.keyboard.press("Escape");
    expect(await state()).toEqual([false, true]);

    await page.keyboard.press("Escape");
    expect(await state()).toEqual([false, false]);
  });
});

test.describe("mountNavDrawer — a surface Escape does not close, open inside the panel", () => {
  for (const [name, surface] of [
    ["a manual popover", `<div id="surface" popover="manual">Pinned</div>`],
    ["a manual popover spelled in another case", `<div id="surface" popover="Manual">Pinned</div>`],
    ["a popover whose invalid value falls back to manual", `<div id="surface" popover="pinned">Pinned</div>`],
    ["a non-modal dialog", `<dialog id="surface" open>Note</dialog>`],
  ] as const) {
    test(`closes on Escape past ${name}`, async ({ page }) => {
      await mount(
        page,
        `<details id="drawer" open><summary>Menu</summary><div id="panel"><button id="item">Item</button>${surface}</div></details>`,
        { expose: { forgeDrawer: "./ui/client/drawer" } },
      );
      await page.evaluate(() => {
        window.forgeDrawer.mountNavDrawer({ selector: "#drawer", query: "all", panelSelector: "#panel" });
        document.querySelector<HTMLElement>("#surface[popover]")?.showPopover();
      });
      await page.focus("#item");

      await page.keyboard.press("Escape");

      expect(await page.evaluate(() => (document.querySelector("#drawer") as HTMLDetailsElement).open)).toBe(false);
    });
  }
});
