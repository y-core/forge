import { expect, type Page, test } from "@playwright/test";

import { compiledCss, mount, paintedHex } from "../../client/browser-test-helper";
import { contrastRatio } from "../../contracts/theme/color";
import { CRITERION } from "../../contracts/theme/contrast-pairs";
import { APPEARANCES, type Appearance, TONES, type Tone, toneVariants } from "./tone";

interface Cell {
  tone: Tone;
  appearance: Appearance;
  fg: string;
  bg: string;
  page: string;
}

async function paintCells(page: Page, dark: boolean): Promise<Cell[]> {
  const cells = TONES.flatMap((tone) => APPEARANCES.map((appearance) => ({ tone, appearance, cls: toneVariants({ tone, appearance }) })));
  const html = cells.map(({ tone, appearance, cls }) => `<span id="${tone}-${appearance}" class="inline-block border ${cls}">Aa</span>`).join("");
  await mount(page, `<div class="bg-background p-4">${html}</div>`);
  await page.addStyleTag({
    content: await compiledCss([...new Set(cells.flatMap((c) => c.cls.split(" "))), "bg-background", "p-4", "border", "inline-block"]),
  });
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));

  const out: Cell[] = [];
  for (const { tone, appearance } of cells) {
    const [fg, bg, pageBg] = await page.evaluate((id) => {
      const el = document.getElementById(id) as HTMLElement;
      const cs = getComputedStyle(el);
      return [cs.color, cs.backgroundColor, getComputedStyle(el.parentElement as HTMLElement).backgroundColor];
    }, `${tone}-${appearance}`);
    out.push({
      tone,
      appearance,
      fg: await paintedHex(page, fg),
      bg: bg.startsWith("rgba(0, 0, 0, 0)") ? await paintedHex(page, pageBg) : await paintedHex(page, bg),
      page: await paintedHex(page, pageBg),
    });
  }
  return out;
}

for (const dark of [false, true]) {
  test(`every tone × appearance cell clears the 1.4.3 floor in ${dark ? "dark" : "light"}`, async ({ page }) => {
    const floor = CRITERION["1.4.3"].floor;
    const failing = (await paintCells(page, dark))
      .map((cell) => ({ ...cell, ratio: Number(contrastRatio(cell.fg, cell.bg).toFixed(2)) }))
      .filter((cell) => cell.ratio < floor)
      .map((cell) => `${cell.tone}/${cell.appearance} ${cell.fg} on ${cell.bg} = ${cell.ratio}`);
    expect(failing).toEqual([]);
  });
}
