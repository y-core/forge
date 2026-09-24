import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { mount } from "../client/browser.fixture";
import { CheckboxGroup } from "./checkbox-group";
import { Filter } from "./filter";
import { Menu } from "./menu";
import { RadioGroup } from "./radio-group";
import { Slider } from "./slider";
import { Switch } from "./switch";
import { Tabs } from "./tabs";
import { Toggle } from "./toggle";
import { ToggleGroup } from "./toggle-group";
import { Toolbar } from "./toolbar";

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
      `${await render(ToggleGroup({ label: "Alignment", children: [ToggleGroup.Item({ id: "g-on", name: "g", value: "a", pressed: true, children: "A" })] }))}`;
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

  // What forced colors takes away here is the chip's `focus-ring`, a `box-shadow`, which does not
  // paint at all under it — so the restored outline is what this measures.
  test("a chosen Filter chip paints Highlight and a focused one gets an outline back", async ({ page }) => {
    const html = await render(
      Filter({
        children: Filter.Group({
          label: "Category",
          children: [Filter.Item({ name: "f", value: "a", children: "A" }), Filter.Item({ name: "f", value: "b", checked: true, children: "B" })],
        }),
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
  // at the CSSOM instead.
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

/** The outline a focused control paints, which is the only focus cue forced colors leaves standing. */
function outline(page: Page, selector: string): Promise<{ width: string; style: string }> {
  return page.evaluate((sel) => {
    const style = getComputedStyle(document.querySelector(sel) as Element);
    return { width: style.outlineWidth, style: style.outlineStyle };
  }, selector);
}

// A `focus-ring` is a `box-shadow` and a menu row's cue is a background colour, and forced colors
// renders neither — so every composite item is measured here rather than assumed.
test.describe("composite items keep a focus indicator under forced colors", () => {
  test("a toolbar button and a tab take the UA ring back, which their own outline-none does not beat", async ({ page }) => {
    const html = await render([
      Toolbar({ label: "Formatting", children: Toolbar.Button({ id: "tb", children: "Bold" }) }),
      Tabs({
        children: [
          Tabs.List({ label: "Views", children: Tabs.Tab({ for: "p-a", selected: true, children: "Alpha" }) }),
          Tabs.Content({ id: "p-a", selected: true, children: "A" }),
        ],
      }),
    ]);
    await forced(page, html);

    await page.locator("#tb").focus();
    expect(await outline(page, "#tb")).toEqual({ width: "1px", style: "auto" });
    await page.locator("[role='tab']").focus();
    expect(await outline(page, "[role='tab']")).toEqual({ width: "1px", style: "auto" });
  });

  test("a menu row gets an outline restated for it, having neither shadow nor background left", async ({ page }) => {
    const html = await render(Menu.Popup({ label: "Row actions", id: "m", children: Menu.Item({ id: "row", for: false, children: "Row" }) }));
    await forced(page, html);
    await page.evaluate(() => document.querySelector<HTMLElement & { showPopover(): void }>("#m")?.showPopover());

    // Reached by key rather than by `focus()`: the cue is `:focus-visible`, which a pointer or a
    // programmatic call does not satisfy on a button, and a mouse user needs no focus ring.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("row");

    expect(await outline(page, "#row")).toEqual({ width: "2px", style: "solid" });
  });
});
