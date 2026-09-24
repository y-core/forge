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
