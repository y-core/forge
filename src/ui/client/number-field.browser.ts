import { expect, test } from "@playwright/test";

import { mount } from "./browser.fixture";

declare global {
  interface Window {
    forgeNumberField: typeof import("./number-field");
    disposeNumberField?: () => void;
  }
}

const EXPOSE = { expose: { forgeNumberField: "./ui/client/number-field" } };

const FIELD = `<div id="root" data-slot="number-field">
  <button id="dec" type="button" data-slot="number-field-decrement">-</button>
  <input id="n" type="number" value="1" data-slot="number-field-input" />
  <button id="inc" type="button" data-slot="number-field-increment">+</button>
</div>`;

// `FakeWindow` supplies no `MutationObserver`, so under `bun test` the observer is always `null` and
// both the reflection it drives and its disconnect are no-ops. Only a real realm exercises them.
test.describe("the disabled reflection", () => {
  test.beforeEach(async ({ page }) => {
    await mount(page, FIELD, EXPOSE);
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("#root");
      if (root) window.disposeNumberField = window.forgeNumberField.mountNumberField(root);
    });
  });

  test("leaves the steppers live for an ordinary input", async ({ page }) => {
    expect(await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("button")].map((b) => b.disabled))).toEqual([false, false]);
  });

  test("retires both steppers when the app disables the input after mount", async ({ page }) => {
    await page.evaluate(() => document.querySelector<HTMLInputElement>("#n")?.setAttribute("disabled", ""));

    await expect(page.locator("#inc")).toBeDisabled();
    await expect(page.locator("#dec")).toBeDisabled();
  });

  test("retires them for `readonly` too, which has no attribute of its own on a button", async ({ page }) => {
    await page.evaluate(() => document.querySelector<HTMLInputElement>("#n")?.setAttribute("readonly", ""));

    await expect(page.locator("#inc")).toBeDisabled();
  });

  test("brings them back when the attribute is removed again", async ({ page }) => {
    await page.evaluate(() => document.querySelector<HTMLInputElement>("#n")?.setAttribute("disabled", ""));
    await expect(page.locator("#inc")).toBeDisabled();

    await page.evaluate(() => document.querySelector<HTMLInputElement>("#n")?.removeAttribute("disabled"));

    await expect(page.locator("#inc")).toBeEnabled();
  });

  // The disposer's `observer?.disconnect()`: without it the callback outlives the mount and keeps
  // writing `disabled` onto buttons no controller is behind any more.
  test("stops reflecting once disposed, so the observer is disconnected rather than merely idle", async ({ page }) => {
    await page.evaluate(() => window.disposeNumberField?.());
    await page.evaluate(() => document.querySelector<HTMLInputElement>("#n")?.setAttribute("disabled", ""));

    await expect(page.locator("#inc")).toBeEnabled();
  });
});
