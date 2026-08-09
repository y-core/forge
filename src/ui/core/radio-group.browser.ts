import { expect, type Page, test } from "@playwright/test";
import { jsx } from "../../jsx/jsx-runtime";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { RadioGroup } from "./radio-group";

/**
 * No module is exposed here either, and for RadioGroup that is the substantive claim: the keyboard
 * behaviour these cases assert is entirely the platform's. If a composite controller were ever
 * mounted on this component, the arrow-key cases would start skipping items — which is precisely
 * what makes them worth writing.
 */

async function formMarkup(): Promise<string> {
  return render(
    jsx("form", {
      id: "form",
      children: [
        RadioGroup({
          name: "plan",
          children: [
            RadioGroup.Label({ children: "Plan" }),
            RadioGroup.Item({ name: "plan", value: "free", checked: true, children: "Free" }),
            RadioGroup.Item({ name: "plan", value: "pro", children: "Pro" }),
            RadioGroup.Item({ name: "plan", value: "team", children: "Team" }),
          ],
        }),
        jsx("button", { id: "after", type: "button", children: "After" }),
      ],
    }),
  );
}

function submitted(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>("#form");
    const value = form ? new FormData(form).get("plan") : null;
    return value === null ? null : String(value);
  });
}

function focusedId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.id ?? null);
}

test("groups natively — a fieldset with a legend — and submits a single value", async ({ page }) => {
  await mount(page, await formMarkup());

  const shape = await page.evaluate(() => {
    const el = document.querySelector("[data-slot~='radio-group']");
    return { tag: el?.tagName, role: el?.getAttribute("role"), legend: el?.querySelector("legend")?.textContent };
  });

  expect(shape).toEqual({ tag: "FIELDSET", role: null, legend: "Plan" });
  expect(await submitted(page)).toBe("free");
});

test("choosing one deselects the rest, as the platform's grouping requires", async ({ page }) => {
  await mount(page, await formMarkup());

  await page.click("#field-plan-team");

  expect(await submitted(page)).toBe("team");
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>("input")].filter((el) => el.checked).length)).toBe(1);
});

test("the arrow keys move and select without any forge JavaScript", async ({ page }) => {
  await mount(page, await formMarkup());

  await page.focus("#field-plan-free");
  await page.keyboard.press("ArrowDown");

  expect(await focusedId(page)).toBe("field-plan-pro");
  expect(await submitted(page)).toBe("pro");
});

test("the arrows wrap at both ends", async ({ page }) => {
  await mount(page, await formMarkup());

  await page.focus("#field-plan-free");
  await page.keyboard.press("ArrowUp");

  expect(await focusedId(page)).toBe("field-plan-team");
});

test("the group is already a single Tab stop", async ({ page }) => {
  await mount(page, await formMarkup());

  await page.focus("#field-plan-pro");
  await page.keyboard.press("Tab");

  // Tab leaves the group from the middle item — the roving-tabindex contract, supplied natively.
  expect(await focusedId(page)).toBe("after");
});

test("a native form reset restores the server-rendered choice", async ({ page }) => {
  await mount(page, await formMarkup());

  await page.click("#field-plan-pro");
  expect(await submitted(page)).toBe("pro");

  await page.evaluate(() => document.querySelector<HTMLFormElement>("#form")?.reset());

  expect(await submitted(page)).toBe("free");
});
