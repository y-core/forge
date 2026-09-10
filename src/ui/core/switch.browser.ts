import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { classesOf, compiledCss, escapeClass, mount } from "../client/browser-test-helper";
import { Switch } from "./switch";

const TRACK = "[data-slot~='switch-track']";
const THUMB = "[data-slot~='switch-thumb']";
const INPUT = "[data-slot~='switch-input']";

const markup = (): Promise<string> => render(Switch({ children: "Snap to grid" }));

function compileArbitraryVariant(cls: string): string {
  const variant = cls.slice(1, cls.lastIndexOf("]:"));
  return variant.replaceAll("_", " ").replace("&", `.${escapeClass(cls)}`);
}

async function acrossToggle(page: Page, css: string, selector: string, property: string): Promise<{ before: string; after: string }> {
  return page.evaluate(
    ([rule, target, prop, input]) => {
      const style = document.createElement("style");
      style.textContent = rule;
      document.head.append(style);

      const el = document.querySelector(target) as HTMLElement;
      const before = getComputedStyle(el).getPropertyValue(prop);
      document.querySelector<HTMLInputElement>(input)?.click();
      return { before, after: getComputedStyle(el).getPropertyValue(prop) };
    },
    [css, selector, property, INPUT] as const,
  );
}

test.describe("Switch — the checked paint reaches both halves of the control", () => {
  test("the thumb slides once the checkbox is checked", async ({ page }) => {
    const html = await markup();
    await mount(page, html);

    const cls = classesOf(html, "switch-thumb").find((name) => name.endsWith(":translate-x-4")) as string;
    const css = `${compileArbitraryVariant(cls)} { transform: translateX(1rem) }`;

    expect(await acrossToggle(page, css, THUMB, "transform")).toEqual({ before: "none", after: "matrix(1, 0, 0, 1, 16, 0)" });
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
    const html = await markup();
    await mount(page, html);

    const cls = classesOf(html, "switch-track").find((name) => name === "peer-checked:bg-primary") as string;
    const css = `.${escapeClass(cls)}:is(:where(.peer):checked ~ *) { background-color: rgb(0, 0, 255) }`;

    const colours = await acrossToggle(page, css, TRACK, "background-color");
    expect(colours.before).not.toBe("rgb(0, 0, 255)");
    expect(colours.after).toBe("rgb(0, 0, 255)");
  });
});

// The thumb rests at the inline *start* and travels to the inline *end*. Written physically —
// `left-0.5` plus `translate-x-*` — that geometry mirrors under `dir="rtl"`: the thumb sat at the
// end and travelled back to the start, which reads as a switch that is on when it is off.
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
