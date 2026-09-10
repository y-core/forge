import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { CheckboxGroup } from "./checkbox-group";
import { Filter } from "./filter";
import { RadioGroup } from "./radio-group";
import { Slider } from "./slider";
import { Switch } from "./switch";
import { Toggle } from "./toggle";
import { ToggleGroup } from "./toggle-group";

const CSS = [
  "./ui/assets/css/theme-neutral.css",
  "./ui/assets/css/theme-colors.css",
  "./ui/assets/css/theme-base.css",
  "./ui/assets/css/forge-ui.css",
];

async function forced(page: Page, html: string): Promise<void> {
  await page.emulateMedia({ forcedColors: "active" });
  await mount(page, html, { css: CSS });
}

// Chromium's forced `Highlight` carries an alpha, so the comparison is between computed colour
// strings rather than painted hexes — a translucent value composites to something else on canvas.
function systemColor(page: Page, keyword: string): Promise<string> {
  return page.evaluate((c) => {
    const probe = document.createElement("div");
    probe.style.color = c;
    document.body.append(probe);
    return getComputedStyle(probe).color;
  }, keyword);
}

function bg(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => getComputedStyle(document.querySelector(sel) as Element).backgroundColor, selector);
}

test.describe("forced colors — author-painted controls keep a visible on/off state", () => {
  test("a checked switch track paints Highlight and an unchecked one paints Canvas", async ({ page }) => {
    await forced(page, `${await render(Switch({ id: "off" }))}${await render(Switch({ id: "on", checked: true }))}`);

    expect(await bg(page, "#on ~ [data-slot~='switch-track']")).toBe(await systemColor(page, "Highlight"));
    expect(await bg(page, "#off ~ [data-slot~='switch-track']")).toBe(await systemColor(page, "Canvas"));
  });

  test("a pressed toggle and a pressed toggle-group item both paint Highlight", async ({ page }) => {
    const html =
      `${await render(Toggle({ id: "t-off", children: "B" }))}` +
      `${await render(Toggle({ id: "t-on", pressed: true, children: "B" }))}` +
      `${await render(ToggleGroup({ children: [ToggleGroup.Item({ id: "g-on", name: "g", value: "a", pressed: true, children: "A" })] }))}`;
    await forced(page, html);

    const highlight = await systemColor(page, "Highlight");
    expect(await bg(page, "label:has(#t-on)")).toBe(highlight);
    expect(await bg(page, "label:has(#g-on)")).toBe(highlight);
    expect(await bg(page, "label:has(#t-off)")).toBe(await systemColor(page, "Canvas"));
  });

  test("a checked CheckboxGroup and RadioGroup box paint Highlight against a Canvas empty one", async ({ page }) => {
    const html =
      `${await render(CheckboxGroup({ name: "c", children: [CheckboxGroup.Item({ name: "c", value: "off", children: "Off" }), CheckboxGroup.Item({ name: "c", value: "on", checked: true, children: "On" })] }))}` +
      `${await render(RadioGroup({ name: "r", children: [RadioGroup.Item({ name: "r", value: "off", children: "Off" }), RadioGroup.Item({ name: "r", value: "on", checked: true, children: "On" })] }))}`;
    await forced(page, html);

    const highlight = await systemColor(page, "Highlight");
    const canvas = await systemColor(page, "Canvas");
    expect(await bg(page, "#field-c-on")).toBe(highlight);
    expect(await bg(page, "#field-c-off")).toBe(canvas);
    expect(await bg(page, "#field-r-on")).toBe(highlight);
    expect(await bg(page, "#field-r-off")).toBe(canvas);
  });

  // A `Filter` hides every unchosen chip, so the chosen fill is never compared against a neighbour:
  // what forced colors takes away here is the chip's `focus-ring`, a `box-shadow`, which does not
  // paint at all — the restored outline is the whole point of the entry.
  test("a chosen Filter chip paints Highlight and a focused one gets an outline back", async ({ page }) => {
    const html = await render(
      Filter({
        children: [Filter.Item({ name: "f", value: "a", children: "A" }), Filter.Item({ name: "f", value: "b", checked: true, children: "B" })],
      }),
    );
    await forced(page, html);

    expect(await bg(page, "label:has([value='b'])")).toBe(await systemColor(page, "Highlight"));

    await page.locator("[value='b']").focus();
    expect(
      await page.evaluate(() => {
        const style = getComputedStyle(document.querySelector("label:has([value='b'])") as Element);
        return { width: style.outlineWidth, style: style.outlineStyle };
      }),
    ).toEqual({ width: "2px", style: "solid" });
  });

  // `getComputedStyle` cannot read a range input's vendor pseudo-elements, so the slider is checked
  // at the CSSOM: the forced-colors block must carry a Highlight thumb and a Canvas track, and the
  // media must be active.
  test("a slider thumb is declared Highlight against a Canvas track under the active media", async ({ page }) => {
    await forced(page, await render(Slider({ id: "s", value: 5 })));

    expect(
      await page.evaluate(() => {
        const declared: Record<string, string> = {};
        const walk = (rules: CSSRuleList, forcedScope: boolean): void => {
          for (const rule of rules) {
            if (rule instanceof CSSMediaRule) walk(rule.cssRules, forcedScope || rule.media.mediaText.includes("forced-colors: active"));
            else if (rule instanceof CSSLayerBlockRule) walk(rule.cssRules, forcedScope);
            else if (forcedScope && rule instanceof CSSStyleRule && rule.selectorText.startsWith('[data-slot~="slider"]::-webkit-slider-')) {
              declared[rule.selectorText] = rule.style.backgroundColor;
            }
          }
        };
        for (const sheet of document.styleSheets) walk(sheet.cssRules, false);
        return { active: matchMedia("(forced-colors: active)").matches, declared };
      }),
    ).toEqual({
      active: true,
      declared: { '[data-slot~="slider"]::-webkit-slider-runnable-track': "canvas", '[data-slot~="slider"]::-webkit-slider-thumb': "highlight" },
    });
  });
});
