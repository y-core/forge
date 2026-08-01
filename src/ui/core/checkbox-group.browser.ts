import { expect, type Page, test } from "@playwright/test";
import { jsx } from "../../jsx/jsx-runtime";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { CheckboxGroup } from "./checkbox-group";

/**
 * The claim these cases exist to check is that the group is native all the way down: it submits with
 * a form and resets with a form **without any client code at all**, so no module is exposed here.
 */

async function formMarkup(): Promise<string> {
  return render(
    jsx("form", {
      id: "form",
      children: [
        CheckboxGroup({
          name: "toppings",
          children: [
            CheckboxGroup.Label({ children: "Toppings" }),
            CheckboxGroup.Item({ name: "toppings", value: "cheese", checked: true, children: "Cheese" }),
            CheckboxGroup.Item({ name: "toppings", value: "basil", children: "Basil" }),
            CheckboxGroup.Item({ name: "toppings", value: "chilli", disabled: true, children: "Chilli" }),
          ],
        }),
        jsx("button", { id: "submit", type: "submit", children: "Send" }),
      ],
    }),
  );
}

/** What a real `FormData` would carry — the only honest way to ask what the form submits. */
function submitted(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>("#form");
    return form ? [...new FormData(form).getAll("toppings")].map(String) : [];
  });
}

test("shares one name across every item so the form collects them together", async ({ page }) => {
  await mount(page, await formMarkup());

  expect(await submitted(page)).toEqual(["cheese"]);
});

test("a click adds the item's value to the form's data with no client code", async ({ page }) => {
  await mount(page, await formMarkup());

  await page.click("#field-toppings-basil");

  expect(await submitted(page)).toEqual(["cheese", "basil"]);
});

test("a native form reset restores the server-rendered checked state", async ({ page }) => {
  await mount(page, await formMarkup());

  await page.click("#field-toppings-basil");
  await page.click("#field-toppings-cheese");
  expect(await submitted(page)).toEqual(["basil"]);

  await page.evaluate(() => document.querySelector<HTMLFormElement>("#form")?.reset());

  expect(await submitted(page)).toEqual(["cheese"]);
});

test("a disabled item is excluded from the form data even when checked", async ({ page }) => {
  await mount(page, await formMarkup());

  await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>("#field-toppings-chilli");
    if (el) el.checked = true;
  });

  expect(await submitted(page)).toEqual(["cheese"]);
});

test("each item gets its own id, derived from the shared name and its value", async ({ page }) => {
  await mount(page, await formMarkup());

  const ids = await page.evaluate(() => [...document.querySelectorAll("[data-slot='checkbox-group-input']")].map((el) => el.id));

  expect(ids).toEqual(["field-toppings-cheese", "field-toppings-basil", "field-toppings-chilli"]);
});

test("the label is associated so clicking the text toggles the box", async ({ page }) => {
  await mount(page, await formMarkup());

  await page.getByText("Basil").click();

  expect(await submitted(page)).toEqual(["cheese", "basil"]);
});
