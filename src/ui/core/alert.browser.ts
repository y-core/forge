import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { compiledCss, mount, paintedHex, renderedClasses } from "../client/browser.fixture";
import { contrastRatio } from "../contracts/theme/color";
import { CRITERION } from "../contracts/theme/contrast-pairs";
import { Alert } from "./alert";
import { TONES } from "./utils/tone";

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

for (const dark of [false, true]) {
  test(`every soft tone's dismiss glyph paints at full opacity and clears the 1.4.3 floor in ${dark ? "dark" : "light"}`, async ({ page }) => {
    const html = (
      await Promise.all(TONES.map((tone) => render(Alert({ id: tone, tone, appearance: "soft", dismissible: true, children: "Saved" }))))
    ).join("");
    await mount(page, `<style>${await compiledCss([...renderedClasses(html), "bg-background"])}</style><main class="bg-background">${html}</main>`);
    if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));

    const failing: string[] = [];
    for (const tone of TONES) {
      const read = await page.evaluate((id) => {
        const panel = document.getElementById(id) as HTMLElement;
        const button = panel.querySelector("[data-slot~='alert-dismiss']") as HTMLElement;
        const glyph = button.querySelector("span") as HTMLElement;
        return { opacity: getComputedStyle(button).opacity, fg: getComputedStyle(glyph).color, bg: getComputedStyle(panel).backgroundColor };
      }, tone);
      const fg = await paintedHex(page, read.fg);
      const bg = await paintedHex(page, read.bg);
      const ratio = Number(contrastRatio(fg, bg).toFixed(2));
      if (read.opacity !== "1" || ratio < CRITERION["1.4.3"].floor) failing.push(`${tone} opacity=${read.opacity} ${fg} on ${bg} = ${ratio}`);
    }

    expect(failing).toEqual([]);
  });
}

test.describe("Alert — the dismiss target", { tag: "@cross-engine" }, () => {
  test("the dismiss button is at least 32px each way, and the padding keeps the content clear of it", async ({ page }) => {
    const html = await render(Alert({ id: "notice", dismissible: true, children: Alert.Title({ children: "Saved" }) }));
    await mount(page, `<style>${await compiledCss(renderedClasses(html))}</style><main>${html}</main>`);

    const button = page.locator("#notice [data-slot~='alert-dismiss']");
    const box = await button.boundingBox();
    expect({ wide: (box?.width ?? 0) >= 32, tall: (box?.height ?? 0) >= 32 }).toEqual({ wide: true, tall: true });

    const edges = await page.evaluate(() => {
      const panel = document.querySelector("#notice") as HTMLElement;
      const style = getComputedStyle(panel);
      const contentEnd =
        panel.getBoundingClientRect().right - Number.parseFloat(style.borderInlineEndWidth) - Number.parseFloat(style.paddingInlineEnd);
      return { contentEnd, buttonStart: (panel.querySelector("[data-slot~='alert-dismiss']") as HTMLElement).getBoundingClientRect().left };
    });
    expect(edges.contentEnd).toBeLessThanOrEqual(edges.buttonStart);
  });
});
