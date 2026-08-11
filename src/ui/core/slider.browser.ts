import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Slider } from "./slider";

/**
 * The track is painted by `::-webkit-slider-runnable-track` in `forge-ui.css`, and that is
 * the one thing no unit case can see: the rendered markup is byte-identical whether the rule sizes
 * the track or resolves to nothing, and `getComputedStyle(el, "::-webkit-slider-runnable-track")`
 * does not resolve the UA pseudo-element at all — Chromium answers with the *host* element's style,
 * so a spec built on it would report the input's own box and pass whatever the track did.
 *
 * So the track is measured where it exists: in the painted pixels. The page is screenshotted, the
 * PNG is decoded back inside the page with `createImageBitmap`, and the track's thickness is the run
 * of track-coloured pixels across the control. That is a real measurement of the shipped rule rather
 * than a restatement of it.
 *
 * The harness runs no Tailwind build, so the component's own utilities are compiled here. What the
 * sheet has to supply is the whole two-hop mapping the paint runs through, which is three files
 * rather than one: the pseudo-element rules live in `forge-ui.css`, they name `--track` and
 * `--primary`, `theme-base.css` maps those onto scale steps, and `theme-neutral.css` is where the
 * steps are literals. Dropping any one of the three leaves `--track` unresolved and the track
 * unpainted.
 */

const SLIDER = "[data-slot~='slider']";

/** The token layer, then the mapping, then the component rules — `forge.css`'s import order, minus
 * the sheets nothing here reads. */
const CSS = { css: ["./ui/assets/css/theme-neutral.css", "./ui/assets/css/theme-base.css", "./ui/assets/css/forge-ui.css"] };

/**
 * The colour forge actually paints the track: `theme-base.css` maps `--track: var(--gray-10)` and
 * `theme-neutral.css` declares that step `#838383` in light mode.
 *
 * This used to be a fixture colour — an injected `--palette-500` the semantic layer resolved
 * through, chosen alongside two other stops so that a mis-scan landed on a nameable colour rather
 * than on an accidental match. The ramp is gone and the scale is literal, so a fixture is no longer
 * an option so much as an illusion: `mount` adds the stylesheet *after* the markup's own `<style>`,
 * and two `:root` blocks of equal weight are decided by source order — an injected `--gray-10` would
 * lose to the shipped one and paint nothing it claimed to.
 *
 * The mis-scan property survives the move anyway. The three colours in play are the track's
 * `#838383`, the thumb's `--primary` (`#202020`) and the near-white surround (`--background`
 * `#f9f9f9` over a white page), and an antialiased blend of the track with either neighbour lands
 * strictly lighter or strictly darker than the track itself — so no edge pixel can match by
 * accident. The assertion now also measures the value forge ships rather than one this file chose.
 */
const TRACK_PIXEL = "131,131,131";

/**
 * The declaration this fixture paints for each utility the component emits. Geometry matches
 * Tailwind's; the state variants compile to nothing, because the resting control is what is
 * measured and neither `:disabled` nor `:focus-visible` holds during the scan.
 */
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

/** The class list the component actually rendered, compiled into one rule for `[data-slot~=…]`.
 *
 * Reading the classes off the markup rather than naming them here means the fixture cannot style a
 * utility the component does not emit — nor miss one it does. */
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

/** The slider alone in a box that gives `w-full` something to resolve against, with the page margin
 * zeroed so the scan's coordinates are the element's own. */
function markup(html: string): string {
  return `<style>body { margin: 0; background: rgb(255, 255, 255) }</style>${compileRenderedClasses(html)}
    <div style="padding: 20px; width: 320px">${html}</div>`;
}

/** The axis the track's *thickness* runs along: across the control, which is the block axis in
 * either writing mode — vertical on a horizontal slider, horizontal on a vertical one. */
type Thickness = "vertical" | "horizontal";

/**
 * The longest unbroken run of track-coloured pixels across the control, in CSS pixels.
 *
 * Every line along the control's length is scanned and the widest run wins, rather than one sampled
 * position: the thumb covers part of the track, and which part depends on the orientation —
 * `direction: rtl` puts a vertical slider's `min` at the *bottom* while a horizontal one's sits at
 * the left. Taking the maximum makes the measurement independent of that, and reading a contiguous
 * run rather than a total keeps a track broken into pieces from summing to the right answer.
 */
async function measureTrack(page: Page, thickness: Thickness): Promise<number> {
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

      // The screenshot is in device pixels; every rect below is in CSS pixels. Deriving the scale
      // from the image itself keeps the result independent of the project's deviceScaleFactor.
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
    { png, thickness, selector: SLIDER, trackPixel: TRACK_PIXEL },
  );
}

test("the track is the same thickness horizontal and vertical", async ({ page }) => {
  await mount(page, markup(await render(Slider({ min: 0, max: 10, value: 0 }))), CSS);
  const horizontal = await measureTrack(page, "vertical");

  await mount(page, markup(await render(Slider({ min: 0, max: 10, value: 0, orientation: "vertical" }))), CSS);
  const vertical = await measureTrack(page, "horizontal");

  // Absolute first, then equality. Two orientations that both painted *nothing* would be equal, and
  // that is exactly the state a dropped or misspelled pseudo-element rule leaves the page in — so
  // the equality assertion alone would pass on the failure it exists to catch.
  expect(horizontal).toBe(8);
  expect(vertical).toBe(8);
  expect(vertical).toBe(horizontal);
});
