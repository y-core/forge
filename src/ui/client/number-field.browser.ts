import { expect, test } from "@playwright/test";

import { mount } from "./browser.fixture";

declare global {
  interface Window {
    forgeNumberField: typeof import("./number-field");
    disposeNumberField?: () => void;
    numberFieldEvents?: string[];
  }
}

const EXPOSE = { expose: { forgeNumberField: "./ui/client/number-field" } };

const FIELD = `<div id="root" data-slot="number-field">
  <button id="dec" type="button" data-slot="number-field-decrement">-</button>
  <input id="n" type="number" value="1" data-slot="number-field-input" />
  <button id="inc" type="button" data-slot="number-field-increment">+</button>
</div>`;

const ANY_FIELD = `<div id="root" data-slot="number-field">
  <button id="dec" type="button" data-slot="number-field-decrement">-</button>
  <input id="n" type="number" step="any" value="1.5" min="0" max="3" data-slot="number-field-input" />
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

test.describe('step="any"', () => {
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await mount(page, ANY_FIELD, EXPOSE);
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("#root");
      const input = document.querySelector<HTMLInputElement>("#n");
      const events: string[] = [];
      window.numberFieldEvents = events;
      for (const type of ["input", "change"]) input?.addEventListener(type, (event) => events.push(event.type));
      if (root) window.forgeNumberField.mountNumberField(root);
    });
  });

  test("increments 1.5 to 2.5, firing input then change, with no page error", async ({ page }) => {
    await page.locator("#inc").click();

    await expect(page.locator("#n")).toHaveValue("2.5");
    expect({ events: await page.evaluate(() => window.numberFieldEvents), pageErrors }).toEqual({ events: ["input", "change"], pageErrors: [] });
  });

  test("decrements 1.5 to 0.5", async ({ page }) => {
    await page.locator("#dec").click();

    await expect(page.locator("#n")).toHaveValue("0.5");
  });

  test("clamps a second increment to max", async ({ page }) => {
    await page.locator("#inc").click();
    await page.locator("#inc").click();

    await expect(page.locator("#n")).toHaveValue("3");
  });

  test("hands focus back to the field after an any step", async ({ page }) => {
    await page.locator("#inc").click();

    await expect(page.locator("#n")).toBeFocused();
  });
});
