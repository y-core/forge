import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { compiledCss, mount, paintedHex, renderedClasses } from "../client/browser.fixture";
import { Slider } from "./slider";

const SLIDER = "[data-slot~='slider']";

async function markup(html: string): Promise<string> {
  return `<style>body { background: rgb(255, 255, 255) }</style><style>${await compiledCss(renderedClasses(html))}</style>
    <div style="padding: 20px; width: 320px">${html}</div>`;
}

type Thickness = "vertical" | "horizontal";

/** The loaded theme's `--track` colour, as the `r,g,b` triple a screenshot pixel carries. */
async function resolveTrackPixel(page: Page): Promise<string> {
  const hex = await paintedHex(page, "var(--track)");
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)).join(",");
}

async function measureTrack(page: Page, thickness: Thickness): Promise<number> {
  const trackPixel = await resolveTrackPixel(page);
  // A plain number array, because forge's tsconfig carries no Node types: `page.screenshot` answers
  // a `Buffer` and there is no `toString("base64")` on the `Uint8Array` it resolves to here.
  const png = Array.from(await page.screenshot({ type: "png" }));
  return page.evaluate(
    // oxlint-disable-next-line eslint/no-shadow -- the callback runs in the browser realm and cannot close over the Node-side binding; the matching name is what documents the marshalled argument
    async ({ png, thickness, selector, trackPixel }) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;

      // The screenshot is in device pixels; every rect below is in CSS pixels.
      const scale = bitmap.width / document.documentElement.clientWidth;
      const isTrack = (x: number, y: number) => {
        const i = (Math.round(y * scale) * bitmap.width + Math.round(x * scale)) * 4;
        return `${data[i]},${data[i + 1]},${data[i + 2]}` === trackPixel;
      };

      const rect = (document.querySelector(selector) as HTMLElement).getBoundingClientRect();
      const acrossVertically = thickness === "vertical";
      const [lengthFrom, lengthTo] = acrossVertically ? [rect.left, rect.right] : [rect.top, rect.bottom];
      const [thickFrom, thickTo] = acrossVertically ? [rect.top, rect.bottom] : [rect.left, rect.right];

      let longest = 0;
      for (let along = lengthFrom; along < lengthTo; along++) {
        let run = 0;
        for (let across = thickFrom; across < thickTo; across++) {
          const hit = acrossVertically ? isTrack(along, across) : isTrack(across, along);
          run = hit ? run + 1 : 0;
          if (run > longest) longest = run;
        }
      }
      return longest;
    },
    { png, thickness, selector: SLIDER, trackPixel },
  );
}

test("the track is the same thickness horizontal and vertical", async ({ page }) => {
  await mount(page, await markup(await render(Slider({ min: 0, max: 10, value: 0 }))));
  const horizontal = await measureTrack(page, "vertical");

  await mount(page, await markup(await render(Slider({ min: 0, max: 10, value: 0, orientation: "vertical" }))));
  const vertical = await measureTrack(page, "horizontal");

  expect(horizontal).toBe(8);
  expect(vertical).toBe(8);
  expect(vertical).toBe(horizontal);
});
