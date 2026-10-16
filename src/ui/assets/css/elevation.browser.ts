import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { compiledCss, mount } from "../../client/browser.fixture";

const SIZES = ["shadow-2xs", "shadow-xs", "shadow-sm", "shadow-md", "shadow-lg", "shadow-xl", "shadow-2xl"] as const;

const FLAT = "<style>:root { --elevation: 0; }</style>";

async function mountShadows(page: Page, shape: string): Promise<void> {
  const markup = SIZES.map((size) => `<div class="${size}" data-size="${size}">x</div>`).join("");
  const ring = `<button type="button" class="focus-ring shadow-lg">Ring</button>`;
  await mount(page, `<style>${await compiledCss([...SIZES, "focus-ring"])}</style>${shape}${markup}${ring}`);
}

/** Each layer of an element's computed `box-shadow`, as its lengths in px and whether it is inset. */
function layersOf(page: Page, selector: string): Promise<{ inset: boolean; lengths: number[] }[]> {
  return page.evaluate((target) => {
    const shadow = getComputedStyle(document.querySelector(target) as HTMLElement).boxShadow;
    if (shadow === "none") return [];
    return shadow
      .split(/,(?![^(]*\))/)
      .map((layer) => ({
        inset: /\binset\b/.test(layer),
        lengths: [...layer.replace(/\([^)]*\)/g, "").matchAll(/-?[\d.]+px/g)].map((match) => Math.abs(Number.parseFloat(match[0]))),
      }));
  }, selector);
}

test.describe("--elevation scales the whole shadow scale", () => {
  for (const size of SIZES) {
    test(`${size} paints no length at --elevation: 0`, async ({ page }) => {
      await mountShadows(page, FLAT);
      const layers = await layersOf(page, `[data-size="${size}"]`);

      expect(layers.flatMap((layer) => layer.lengths).filter((length) => length !== 0)).toEqual([]);
    });

    test(`${size} keeps a non-zero length at the default`, async ({ page }) => {
      await mountShadows(page, "");
      const layers = await layersOf(page, `[data-size="${size}"]`);

      expect(layers.flatMap((layer) => layer.lengths).some((length) => length > 0)).toBe(true);
    });
  }

  test("a focused focus-ring keeps its 2px inset ring at --elevation: 0", async ({ page }) => {
    await mountShadows(page, FLAT);
    await page.keyboard.press("Tab");
    const layers = await layersOf(page, "button");

    expect(layers.filter((layer) => layer.inset).map((layer) => layer.lengths)).toContainEqual([0, 0, 0, 2]);
  });
});
