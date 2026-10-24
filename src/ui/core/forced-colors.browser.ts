import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { mount, withCompiledCss } from "../client/browser.fixture";
import { Button } from "./button";
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

async function forced(page: Page, html: string): Promise<void> {
  await page.emulateMedia({ forcedColors: "active" });
  await mount(page, await withCompiledCss(html));
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

test.describe("forced colors — author-painted controls keep a visible on/off state", { tag: "@cross-engine" }, () => {
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

/** The computed outline width and style of the element `selector` names. */
function outline(page: Page, selector: string): Promise<{ width: string; style: string }> {
  return page.evaluate((sel) => {
    const style = getComputedStyle(document.querySelector(sel) as Element);
    return { width: style.outlineWidth, style: style.outlineStyle };
  }, selector);
}

// Reached by key from `#before` rather than by `focus()`: the cue is `:focus-visible`, which a pointer
// or a programmatic call does not reliably satisfy on a button.
async function focusByKey(page: Page, id: string): Promise<void> {
  await page.locator("#before").focus();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(id);
}

/** The PNG of the pixels within 4px of the element `selector` names, as plain bytes the page can decode. */
async function surround(page: Page, selector: string): Promise<number[]> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} has no box`);
  return Array.from(await page.screenshot({ clip: { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 } }));
}

/** The largest change any colour channel of any pixel makes between two same-sized PNGs. */
function strongestChange(page: Page, before: number[], after: number[]): Promise<number> {
  return page.evaluate(
    async (pngs) => {
      const [a, b] = await Promise.all(
        pngs.map(async (png) => {
          const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: "image/png" }));
          const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d") as OffscreenCanvasRenderingContext2D;
          context.drawImage(bitmap, 0, 0);
          return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        }),
      );
      if (a === undefined || b === undefined || a.length !== b.length) throw new Error("the two screenshots differ in size");
      return a.reduce((max, channel, i) => (i % 4 === 3 ? max : Math.max(max, Math.abs(channel - (b[i] ?? 0)))), 0);
    },
    [before, after],
  );
}

const HALF_CHANNEL_RANGE = 128;

const NO_FORCED_PALETTE = "WebKit matches (forced-colors: active) but paints no forced palette";

const BEFORE = `<button id="before" style="margin:16px">before</button>`;

const pad = (html: string): string => `${BEFORE}<div style="padding:16px">${html}</div>`;

async function composites(): Promise<Record<"button" | "toolbar" | "tab", string>> {
  return {
    button: pad(await render(Button({ id: "b", children: "Save" }))),
    toolbar: pad(await render(Toolbar({ label: "Formatting", children: Toolbar.Button({ id: "tb", children: "Bold" }) }))),
    tab: pad(
      await render(
        Tabs({
          children: [
            Tabs.List({ label: "Views", children: Tabs.Tab({ for: "p-a", selected: true, children: "Alpha" }) }),
            Tabs.Content({ id: "p-a", selected: true, children: "A" }),
          ],
        }),
      ),
    ),
  };
}

async function menuRow(page: Page): Promise<void> {
  await forced(
    page,
    `<style>#m { inset: 120px auto auto 120px; }</style>${pad(await render(Menu.Popup({ label: "Row actions", id: "m", children: Menu.Item({ id: "row", for: false, children: "Row" }) })))}`,
  );
  await page.evaluate(() => document.querySelector<HTMLElement & { showPopover(): void }>("#m")?.showPopover());
}

test.describe("composite items keep a focus indicator under forced colors", { tag: "@cross-engine" }, () => {
  test.use({ reducedMotion: "reduce" });

  test("a button, a toolbar button and a tab keep forge's own ring rather than losing it to outline-none", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", NO_FORCED_PALETTE);
    const html = await composites();
    const cases = [
      { markup: html.button, id: "b" },
      { markup: html.toolbar, id: "tb" },
      { markup: html.tab, id: "p-a-tab" },
    ];
    const rings: Record<string, { width: string; style: string }> = {};
    for (const { markup, id } of cases) {
      await forced(page, markup);
      await focusByKey(page, id);
      rings[id] = await outline(page, `#${id}`);
    }

    const ring = { width: "2px", style: "solid" };
    expect(rings).toEqual({ b: ring, tb: ring, "p-a-tab": ring });
  });

  test("a menu row gets an outline restated for it, having neither shadow nor background left", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", NO_FORCED_PALETTE);
    await menuRow(page);
    await focusByKey(page, "row");

    expect(await outline(page, "#row")).toEqual({ width: "2px", style: "solid" });
  });

  for (const [key, name, id] of [
    ["button", "button", "b"],
    ["toolbar", "toolbar button", "tb"],
    ["tab", "tab", "p-a-tab"],
  ] as const) {
    test(`a focused ${name} paints a full-contrast change around itself`, async ({ page, browserName }) => {
      test.skip(browserName === "webkit", NO_FORCED_PALETTE);
      await forced(page, (await composites())[key]);
      await page.locator("#before").focus();
      const unfocused = await surround(page, `#${id}`);
      await focusByKey(page, id);

      expect(await strongestChange(page, unfocused, await surround(page, `#${id}`))).toBeGreaterThan(HALF_CHANNEL_RANGE);
    });
  }

  test("a focused menu row paints a full-contrast change around itself", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", NO_FORCED_PALETTE);
    await menuRow(page);
    await page.locator("#before").focus();
    const unfocused = await surround(page, "#row");
    await focusByKey(page, "row");

    expect(await strongestChange(page, unfocused, await surround(page, "#row"))).toBeGreaterThan(HALF_CHANNEL_RANGE);
  });
});
