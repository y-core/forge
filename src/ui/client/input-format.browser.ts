import { expect, test } from "@playwright/test";

import { render } from "../../testing/render";
import { Input } from "../core/input";
import { mount } from "./browser-test-helper";

declare global {
  interface Window {
    forgeInputFormat: typeof import("./input-format");
    formatWarnings: string[];
  }
}

const EXPOSE = { expose: { forgeInputFormat: "./ui/client/input-format" } };

const CARD = "#### #### #### ####";

/** The real `Input` in a form, with a second control to tab away to. */
async function cardForm(props: Record<string, unknown> = {}): Promise<string> {
  const field = await render(Input({ id: "card", type: "text", name: "card", format: CARD, ...props }));
  return `<form id="form" action="/pay">${field}<input id="next" name="next" type="text"></form>`;
}

/** Mounts the controller on `#card` and captures every warning it emits. */
const install = `
  window.formatWarnings = [];
  const warn = console.warn;
  console.warn = (...args) => { window.formatWarnings.push(String(args[0])); warn(...args); };
  window.forgeInputFormat.mountInputFormat(document.querySelector("#card"));
`;

test("a real tab away from the field regroups its value", async ({ page }) => {
  await mount(page, await cardForm(), EXPOSE);
  await page.evaluate(install);

  await page.click("#card");
  await page.keyboard.type("4111111111111111");
  await page.keyboard.press("Tab");

  await expect(page.locator("#card")).toHaveValue("4111 1111 1111 1111");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("next");
});

test("a type=number control refuses the formatted value, so the controller retires after one warning", async ({ page }) => {
  await mount(page, await cardForm({ type: "number", value: undefined }), EXPOSE);
  await page.evaluate(install);

  const outcome = await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>("#card");
    if (!el) return null;
    const seen: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      el.value = "4111111111111111";
      el.focus();
      el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      seen.push(el.value);
    }
    return { seen, warnings: window.formatWarnings };
  });

  expect(outcome?.warnings).toEqual(["[input-format] this control's type refuses a formatted value; formatting is disabled for it"]);
  expect(outcome?.seen).toEqual(["", "4111111111111111", "4111111111111111"]);
});

test("the form serialises the formatted string, which is what the server schema receives", async ({ page }) => {
  await mount(page, await cardForm(), EXPOSE);
  await page.evaluate(install);

  const posted = await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>("#form");
    const el = document.querySelector<HTMLInputElement>("#card");
    if (!form || !el) return null;
    el.value = "4111111111111111";
    el.focus();
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    form.addEventListener("submit", (event) => event.preventDefault());
    return String(new FormData(form).get("card"));
  });

  expect(posted).toBe("4111 1111 1111 1111");
});

test("a maxlength sized for the formatted value leaves it valid and untruncated", async ({ page }) => {
  await mount(page, await cardForm({ maxlength: 19 }), EXPOSE);
  await page.evaluate(install);

  const state = await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>("#card");
    if (!el) return null;
    el.value = "4111111111111111";
    el.focus();
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    return { value: el.value, length: el.value.length, valid: el.validity.valid, userInvalid: el.matches(":user-invalid") };
  });

  expect(state).toEqual({ value: "4111 1111 1111 1111", length: 19, valid: true, userInvalid: false });
});
