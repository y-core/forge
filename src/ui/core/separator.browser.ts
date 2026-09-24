import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { compiledCss, mount, renderedClasses } from "../client/browser.fixture";
import { Separator } from "./separator";

const SEPARATOR = "[data-slot~='separator']";

async function markup(html: string, rowStyle: string): Promise<string> {
  return `<style>${await compiledCss(renderedClasses(html))}</style>
    <div id="row" style="display: flex; align-items: center; gap: 8px; ${rowStyle}">
      <button id="control" type="button" style="height: 34px; border: 0">Rename</button>
      ${html}
      <button type="button" style="height: 34px; border: 0">Delete</button>
    </div>`;
}

interface Boxes {
  separator: { width: number; height: number };
  control: number;
  rowContent: number;
}

async function measure(page: Page): Promise<Boxes> {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector) as HTMLElement;
    const row = document.querySelector("#row") as HTMLElement;
    const control = document.querySelector("#control") as HTMLElement;
    const { width, height } = el.getBoundingClientRect();
    return { separator: { width, height }, control: control.getBoundingClientRect().height, rowContent: row.clientHeight };
  }, SEPARATOR);
}

test("a vertical separator in an auto-height flex row has a visible height", async ({ page }) => {
  const html = await render(Separator({ orientation: "vertical" }));
  await mount(page, await markup(html, ""));

  const boxes = await measure(page);

  expect(boxes.separator.height).toBeGreaterThan(0);
  expect(boxes.separator.width).toBeGreaterThan(0);
});

test("a vertical separator in a definite-height flex row still fills the line", async ({ page }) => {
  const html = await render(Separator({ orientation: "vertical" }));
  await mount(page, await markup(html, "height: 72px"));

  const boxes = await measure(page);

  expect(boxes.separator.height).toBeGreaterThan(boxes.control);
  expect(boxes.separator.height).toBeLessThanOrEqual(boxes.rowContent);
});

test("a caller's explicit height wins over the base, which emits both", async ({ page }) => {
  const html = await render(Separator({ orientation: "vertical", class: "h-5" }));
  await mount(page, await markup(html, "height: 72px"));

  const boxes = await measure(page);

  expect(boxes.separator.height).toBeGreaterThan(0);
  expect(boxes.separator.height).toBeLessThan(boxes.rowContent);
});
