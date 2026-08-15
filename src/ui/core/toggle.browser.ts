import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Toggle } from "./toggle";

function state(page: Page) {
  return page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("#bold");
    const label = input?.closest("label");
    return { tag: input?.tagName, type: input?.getAttribute("type"), checked: input?.checked, slot: label?.getAttribute("data-slot") };
  });
}

test.describe("Toggle", () => {
  test("is a native checkbox inside its label, not a button carrying an ARIA state", async ({ page }) => {
    await mount(page, await render(Toggle({ id: "bold", name: "bold", children: "Bold" })));

    expect(await state(page)).toEqual({ tag: "INPUT", type: "checkbox", checked: false, slot: "toggle" });
  });

  // No `resume()` anywhere in this file: that is the assertion. The platform toggles the checkbox,
  // and `:has(:checked)` paints the label — there is nothing left for a controller to do.
  test("flips on a click on the label, with no client runtime loaded", async ({ page }) => {
    await mount(page, await render(Toggle({ id: "bold", children: "Bold" })));

    await page.click('[data-slot~="toggle"]');
    expect((await state(page)).checked).toBe(true);

    await page.click('[data-slot~="toggle"]');
    expect((await state(page)).checked).toBe(false);
  });

  test("toggles from the keyboard, since the input is focusable rather than hidden", async ({ page }) => {
    await mount(page, await render(Toggle({ id: "bold", children: "Bold" })));

    await page.locator("#bold").focus();
    await page.keyboard.press("Space");

    expect((await state(page)).checked).toBe(true);
  });

  test("a server-rendered pressed toggle un-presses on the first click", async ({ page }) => {
    await mount(page, await render(Toggle({ id: "bold", pressed: true, children: "Bold" })));

    await page.click('[data-slot~="toggle"]');

    expect((await state(page)).checked).toBe(false);
  });

  test("names no scope and no action, because it has no state a controller could own", async ({ page }) => {
    await mount(page, await render(Toggle({ id: "bold", children: "Bold" })));

    expect(
      await page.evaluate(() => {
        const label = document.querySelector('[data-slot~="toggle"]');
        return { scope: label?.getAttribute("data-scope"), action: label?.getAttribute("data-on-click") };
      }),
    ).toEqual({ scope: null, action: null });
  });
});
