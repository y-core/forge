import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount, paintedHex } from "../client/browser-test-helper";
import { Slider } from "./slider";

const SLIDER = "[data-slot~='slider']";

const CSS = { css: ["./ui/assets/css/theme-neutral.css", "./ui/assets/css/theme-base.css", "./ui/assets/css/forge-ui.css"] };

const UTILITY_CSS: Record<string, string> = {
  "h-8": "height: 2rem",
  "h-22": "height: 5.5rem",
  "w-8": "width: 2rem",
  "w-full": "width: 100%",
  "cursor-pointer": "cursor: pointer",
  "appearance-none": "appearance: none",
  "rounded-full": "border-radius: 3.40282e38px",
  "bg-transparent": "background-color: transparent",
  "[writing-mode:vertical-lr]": "writing-mode: vertical-lr",
  "[direction:rtl]": "direction: rtl",
  "disabled:opacity-50": "",
  "focus-visible:outline-none": "",
  "focus-visible:ring-2": "",
  "focus-visible:ring-ring": "",
};

function compileRenderedClasses(html: string): string {
  const match = /class="([^"]*)"/.exec(html);
  if (!match?.[1]) throw new Error("no class attribute on the rendered slider");
  const declarations = match[1].split(" ").map((utility) => {
    const css = UTILITY_CSS[utility];
    if (css === undefined) throw new Error(`no compiled CSS for "${utility}" — add it to UTILITY_CSS`);
    return css;
  });
  return `<style>${SLIDER} { ${declarations.filter((d) => d.length > 0).join("; ")} }</style>`;
}

function markup(html: string): string {
  return `<style>body { margin: 0; background: rgb(255, 255, 255) }</style>${compileRenderedClasses(html)}
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
  await mount(page, markup(await render(Slider({ min: 0, max: 10, value: 0 }))), CSS);
  const horizontal = await measureTrack(page, "vertical");

  await mount(page, markup(await render(Slider({ min: 0, max: 10, value: 0, orientation: "vertical" }))), CSS);
  const vertical = await measureTrack(page, "horizontal");

  expect(horizontal).toBe(8);
  expect(vertical).toBe(8);
  expect(vertical).toBe(horizontal);
});
