import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { classesOf, compiledCss, mount, paintedHex, renderedClasses } from "../client/browser.fixture";
import { Switch } from "./switch";

const TRACK = "[data-slot~='switch-track']";
const THUMB = "[data-slot~='switch-thumb']";
const INPUT = "[data-slot~='switch-input']";

const markup = (): Promise<string> => render(Switch({ children: "Snap to grid" }));

async function mountCompiled(page: Page): Promise<void> {
  const html = await markup();
  // Reduced motion reads the settled value: `motion-safe:transition-*` would otherwise leave it mid-interpolation.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mount(page, html);
  await page.addStyleTag({ content: await compiledCss(renderedClasses(html)) });
}

async function acrossToggle(page: Page, selector: string, property: string): Promise<{ before: string; after: string }> {
  return page.evaluate(
    ([target, prop, input]) => {
      const el = document.querySelector(target) as HTMLElement;
      const before = getComputedStyle(el).getPropertyValue(prop);
      document.querySelector<HTMLInputElement>(input)?.click();
      return { before, after: getComputedStyle(el).getPropertyValue(prop) };
    },
    [selector, property, INPUT] as const,
  );
}

test.describe("Switch — the checked paint reaches both halves of the control", () => {
  test("the thumb slides once the checkbox is checked", async ({ page }) => {
    await mountCompiled(page);

    expect(await acrossToggle(page, THUMB, "translate")).toEqual({ before: "none", after: "16px" });
  });

  test("the thumb is a descendant of the track, which is why a sibling-only selector misses it", async ({ page }) => {
    await mount(page, await markup());

    const reach = () =>
      page.evaluate(
        ([thumb, track, input]) => ({
          asSibling: document.querySelector(`${input}:checked ~ ${thumb}`) !== null,
          asDescendant: document.querySelector(`${input}:checked ~ ${track} ${thumb}`) !== null,
        }),
        [THUMB, TRACK, INPUT] as const,
      );

    expect(await reach()).toEqual({ asSibling: false, asDescendant: false });
    await page.evaluate((input) => document.querySelector<HTMLInputElement>(input)?.click(), INPUT);
    expect(await reach()).toEqual({ asSibling: false, asDescendant: true });
  });

  test("the track's peer-checked paint was never broken — it really is a sibling", async ({ page }) => {
    await mountCompiled(page);
    const primary = await paintedHex(page, "var(--primary)");

    const colours = await acrossToggle(page, TRACK, "background-color");
    expect(await paintedHex(page, colours.before)).not.toBe(primary);
    expect(await paintedHex(page, colours.after)).toBe(primary);
  });
});

// The thumb rests at the inline start and travels to the inline end; written physically, that
// geometry mirrors under `dir="rtl"` and reads as a switch that is on when it is off.
test.describe("Switch — the thumb follows the reader's direction", () => {
  async function thumbTravel(page: Page, dir: "ltr" | "rtl"): Promise<{ restsAtStart: boolean; travelsTowardEnd: boolean }> {
    const html = await markup();
    // Reduced motion makes this a geometry assertion: `motion-safe:transition-transform` would
    // otherwise leave the rect mid-interpolation on the frame after the click.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mount(page, `<div dir="${dir}" style="width:200px">${html}</div>`);
    await page.addStyleTag({ content: await compiledCss([...classesOf(html, "switch-thumb"), ...classesOf(html, "switch-track")]) });

    return page.evaluate(
      ([track, thumb, input, direction]) => {
        const box = () => {
          const trackEl = document.querySelector(track);
          const thumbEl = document.querySelector(thumb);
          if (trackEl === null || thumbEl === null) throw new Error("the switch fixture is not on the page");
          const t = trackEl.getBoundingClientRect();
          const h = thumbEl.getBoundingClientRect();
          return direction === "rtl" ? { gap: t.right - h.right, offset: -h.left } : { gap: h.left - t.left, offset: h.left };
        };

        const before = box();
        document.querySelector<HTMLInputElement>(input)?.click();
        const after = box();
        return { restsAtStart: Math.abs(before.gap) <= 3, travelsTowardEnd: after.offset - before.offset > 4 };
      },
      [TRACK, THUMB, INPUT, dir] as const,
    );
  }

  test("rests at the inline start and travels to the inline end in ltr", async ({ page }) => {
    expect(await thumbTravel(page, "ltr")).toEqual({ restsAtStart: true, travelsTowardEnd: true });
  });

  test("rests at the inline start and travels to the inline end in rtl too", async ({ page }) => {
    expect(await thumbTravel(page, "rtl")).toEqual({ restsAtStart: true, travelsTowardEnd: true });
  });
});
