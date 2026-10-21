import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { mount } from "../client/browser.fixture";
import { Alert } from "./alert";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
    forgeDrawer: typeof import("../client/drawer");
  }
}

const EXPOSE = { css: ["./ui/assets/css/forge-ui.css"], expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

async function mountAlert(page: Page): Promise<void> {
  const html = await render(Alert({ id: "notice", dismissible: true, children: Alert.Title({ children: "Saved" }) }));
  await mount(page, `<main>${html}</main>`, EXPOSE);
  await page.evaluate(() => window.forgeResume.resume());
}

function dismiss(page: Page): Promise<{ present: boolean; dismissing: boolean | null; inert: boolean | null }> {
  return page.evaluate(() => {
    (document.querySelector("#notice [data-slot~='alert-dismiss']") as HTMLButtonElement).click();
    const alert = document.querySelector("#notice") as HTMLElement | null;
    return { present: alert !== null, dismissing: alert?.hasAttribute("data-dismissing") ?? null, inert: alert?.inert ?? null };
  });
}

test.describe("Alert — dismissal", () => {
  test("dismissing marks it dismissing and inert at once and removes it after the fade", async ({ page }) => {
    await mountAlert(page);

    expect(await dismiss(page)).toEqual({ present: true, dismissing: true, inert: true });
    await expect.poll(() => page.evaluate(() => document.querySelector("#notice") === null)).toBe(true);
  });

  test.describe("under reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("dismissing still fades it out before removing it", async ({ page }) => {
      await mountAlert(page);

      expect(await dismiss(page)).toEqual({ present: true, dismissing: true, inert: true });
      await expect.poll(() => page.evaluate(() => document.querySelector("#notice") === null)).toBe(true);
    });
  });
});

test.describe("Alert — beside an open nav drawer", () => {
  test("an Alert the drawer made inert stays in place at full opacity", async ({ page }) => {
    const html = await render(Alert({ id: "notice", dismissible: true, children: Alert.Title({ children: "Saved" }) }));
    const drawer = '<details id="drawer" open><summary>Menu</summary><nav><a href="#a">A</a></nav></details>';
    await mount(page, `${drawer}${html}`, { ...EXPOSE, expose: { ...EXPOSE.expose, forgeDrawer: "./ui/client/drawer" } });
    await page.evaluate(() => window.forgeDrawer.mountNavDrawer({ selector: "#drawer", query: "all" }));

    await page.waitForTimeout(300);
    const read = await page.evaluate(() => {
      const alert = document.querySelector("#notice") as HTMLElement | null;
      return { inert: alert?.inert ?? null, opacity: alert ? Number(getComputedStyle(alert).opacity) : null };
    });

    expect(read).toEqual({ inert: true, opacity: 1 });
  });
});
