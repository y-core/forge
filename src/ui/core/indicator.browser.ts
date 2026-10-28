import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { createElement } from "../../render/jsx/element";
import { render } from "../../testing/render";
import { mount, withCompiledCss } from "../client/browser.fixture";
import { Indicator } from "./indicator";
import type { IndicatorPlacement } from "./types";

const PLACEMENTS: readonly IndicatorPlacement[] = ["top-start", "top-end", "bottom-start", "bottom-end"];

async function indicatorIn(dir: "ltr" | "rtl", placement: IndicatorPlacement): Promise<string> {
  const indicator = await render(
    createElement(Indicator, {
      children: [createElement("div", { style: "width:80px;height:40px" }), createElement(Indicator.Item, { placement, class: "size-5" })],
    }),
  );
  return `<div dir="${dir}" id="${dir}">${indicator}</div>`;
}

async function measureItemCentre(page: Page, dir: "ltr" | "rtl"): Promise<{ x: number; y: number; width: number }> {
  return page.evaluate((id) => {
    const root = document.querySelector(`#${id} [data-slot~='indicator']`);
    const item = document.querySelector(`#${id} [data-slot~='indicator-item']`);
    if (root === null || item === null) throw new Error("the indicator fixture is not on the page");
    const r = root.getBoundingClientRect();
    const i = item.getBoundingClientRect();
    return { x: i.left + i.width / 2 - r.left, y: i.top + i.height / 2 - r.top, width: r.width };
  }, dir);
}

test.describe("Indicator — an item in rtl sits at the mirror of its ltr corner", { tag: "@cross-engine" }, () => {
  for (const placement of PLACEMENTS) {
    test(`mirrors the ${placement} placement`, async ({ page }) => {
      await mount(page, await withCompiledCss((await indicatorIn("ltr", placement)) + (await indicatorIn("rtl", placement))));

      const ltr = await measureItemCentre(page, "ltr");
      const rtl = await measureItemCentre(page, "rtl");

      expect(Math.abs(rtl.x - (rtl.width - ltr.x))).toBeLessThanOrEqual(1);
      expect(Math.abs(rtl.y - ltr.y)).toBeLessThanOrEqual(1);
    });
  }
});
