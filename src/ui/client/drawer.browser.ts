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

test.describe("mountNavDrawer — a panel that transitions `visibility` on open", { tag: "@cross-engine" }, () => {
  test.use({ reducedMotion: "no-preference" });

  test("focus lands on the panel's first item once it shows, and the page does not scroll", async ({ page }) => {
    await mountVisibilityPanel(page);

    await page.click("summary");

    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("first");
    expect(await scrollY(page)).toBe(500);
  });
});

const COLLAPSIBLE_FIXTURE = `<details id="drawer" data-slot="collapsible">
  <summary>Menu</summary>
  <div data-slot="collapsible-content"><a id="first" href="#first">First</a><a href="#second">Second</a></div>
</details>`;

test.describe("mountNavDrawer — a forge `Collapsible` transitioning `::details-content` on open", { tag: "@cross-engine" }, () => {
  test.use({ reducedMotion: "no-preference" });

  test("focus lands on the panel's first item once the disclosure has opened", async ({ page }) => {
    await mount(page, COLLAPSIBLE_FIXTURE, { css: ["./ui/assets/css/forge-ui.css"], expose: { forgeDrawer: "./ui/client/drawer" } });
    await page.evaluate(() =>
      window.forgeDrawer.mountNavDrawer({ selector: "#drawer", query: "all", panelSelector: ":scope > [data-slot~='collapsible-content']" }),
    );

    await page.click("summary");

    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("first");
  });

  test("transitions the disclosure's ::details-content rather than its panel", async ({ page }) => {
    await mount(page, COLLAPSIBLE_FIXTURE, { css: ["./ui/assets/css/forge-ui.css"] });

    const duration = await page.evaluate(
      () => getComputedStyle(document.querySelector("#drawer") as Element, "::details-content").transitionDuration,
    );

    expect(duration).toBe("0.1s, 0.1s");
  });
});

const UNMARKED_BACKDROP_FIXTURE = `<details id="drawer">
  <summary>Menu</summary>
  <div class="backdrop"></div>
  <div id="panel"><a id="first" href="#first">First</a><a href="#second">Second</a></div>
</details>`;

test.describe("mountNavDrawer — an unmarked backdrop before the panel", { tag: "@cross-engine" }, () => {
  test("Tab from the summary reaches the panel's first link rather than cycling on the summary", async ({ page }) => {
    await mount(page, UNMARKED_BACKDROP_FIXTURE, { expose: { forgeDrawer: "./ui/client/drawer" } });
    await page.evaluate(() => window.forgeDrawer.mountNavDrawer({ selector: "#drawer", query: "all" }));
    const opening = await page.evaluateHandle(() => ({
      toggled: new Promise((resolve) => document.querySelector("#drawer")?.addEventListener("toggle", resolve, { once: true })),
    }));

    await page.click("summary");
    await opening.evaluate(({ toggled }) => toggled.then(() => undefined));
    await page.focus("summary");
    await page.keyboard.press("Tab");

    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("first");
  });
});

const POPOVER_FIXTURE = `<details id="drawer" open>
  <summary>Menu</summary>
  <div id="panel"><button id="opener" popovertarget="menu">Open menu</button><div id="menu" popover><button id="item">Item</button></div></div>
</details>`;

test.describe("mountNavDrawer — a popover open inside the panel", { tag: "@cross-engine" }, () => {
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

test.describe("mountNavDrawer — a surface Escape does not close, open inside the panel", { tag: "@cross-engine" }, () => {
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
