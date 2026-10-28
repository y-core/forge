import { expect, test } from "@playwright/test";

import { createElement } from "../../render/jsx/element";
import { render } from "../../testing/render";
import { mount, withCompiledCss } from "../client/browser.fixture";
import { Button } from "./button";

async function squareIn(width: number): Promise<string> {
  const button = await render(createElement(Button, { shape: "square", "aria-label": "Add", children: "+" }));
  return `<div style="width:${width}px">${button}</div>`;
}

test.describe("Button — a square shape is as tall as its container is wide", { tag: "@cross-engine" }, () => {
  for (const width of [64, 120]) {
    test(`measures width equal to height in a ${width}px container`, async ({ page }) => {
      await mount(page, await withCompiledCss(await squareIn(width)));

      const box = await page.locator("button").boundingBox();
      expect(box?.width).toBeCloseTo(width, 0);
      expect(box?.height).toBeCloseTo(width, 0);
    });
  }
});
