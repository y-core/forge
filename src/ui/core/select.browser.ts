import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { mount, withCompiledCss } from "../client/browser.fixture";
import { createIcon } from "./icon";
import { Input } from "./input";
import { Select } from "./select";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16" });

/** The text colour of the element `selector` names, and the opacity every box up to the root multiplies onto it. */
function paintOf(page: Page, selector: string): Promise<{ color: string; opacity: number }> {
  return page.evaluate((sel) => {
    const target = document.querySelector(sel) as Element;
    let opacity = 1;
    for (let node: Element | null = target; node !== null; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return { color: getComputedStyle(target).color, opacity };
  }, selector);
}

test.describe("Select — disabled", { tag: "@cross-engine" }, () => {
  test("is dimmed once, to the same paint as a disabled Input", async ({ page }) => {
    const select = await render(Select({ id: "s", icon, disabled: true, children: Select.Option({ value: "a", children: "Option A" }) }));
    const input = await render(Input({ id: "i", disabled: true, value: "Option A" }));
    await mount(page, await withCompiledCss(`${select}${input}`));

    const selectPaint = await paintOf(page, "#s");

    expect(selectPaint).toEqual(await paintOf(page, "#i"));
    expect(selectPaint.opacity).toBe(0.5);
  });

  test("is dimmed and pointer-inert through aria-disabled alone, as a disabled Input is", async ({ page }) => {
    const select = await render(Select({ id: "s", icon, "aria-disabled": "true", children: Select.Option({ value: "a", children: "Option A" }) }));
    const input = await render(Input({ id: "i", disabled: true, value: "Option A" }));
    await mount(page, await withCompiledCss(`${select}${input}`));

    expect((await paintOf(page, "#s")).opacity).toBe((await paintOf(page, "#i")).opacity);
    expect((await paintOf(page, "#s")).opacity).toBe(0.5);
    expect(await page.locator("#s").evaluate((node) => getComputedStyle(node).pointerEvents)).toBe("none");
  });

  test("is dimmed once and pointer-inert when aria-disabled is set on the select after render", async ({ page }) => {
    const select = await render(Select({ id: "s", icon, children: Select.Option({ value: "a", children: "Option A" }) }));
    await mount(page, await withCompiledCss(select));
    await page.locator("#s").evaluate((node) => node.setAttribute("aria-disabled", "true"));

    expect((await paintOf(page, "#s")).opacity).toBe(0.5);
    expect(await page.locator("#s").evaluate((node) => getComputedStyle(node).pointerEvents)).toBe("none");
  });
});
