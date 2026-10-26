import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { OtpInput } from "../core/otp-input";
import { mount, pasteText, SECURE_ORIGIN } from "./browser.fixture";

declare global {
  interface Window {
    forgeOtpInput: typeof import("./otp-input");
  }
}

async function mountCode(page: Page, value = ""): Promise<void> {
  const html = await render(OtpInput({ field: { name: "code" } }));
  await mount(page, `<form>${html}</form>`, { expose: { forgeOtpInput: "./ui/client/otp-input" }, origin: SECURE_ORIGIN });
  await page.evaluate((initial) => {
    const frame = document.querySelector<HTMLElement>("[data-slot~='otp-input-wrapper']");
    if (frame) window.forgeOtpInput.mountOtpInput(frame);
    const editor = document.getElementById("field-code") as HTMLInputElement;
    editor.value = initial;
    editor.focus();
  }, value);
}

function placeCaret(page: Page, at: number): Promise<void> {
  return page.evaluate((caret) => (document.getElementById("field-code") as HTMLInputElement).setSelectionRange(caret, caret), at);
}

function field(page: Page): Promise<{ value: string; caret: number | null; valid: boolean }> {
  return page.evaluate(() => {
    const el = document.getElementById("field-code") as HTMLInputElement;
    return { value: el.value, caret: el.selectionStart, valid: (el.form as HTMLFormElement).checkValidity() };
  });
}

test.describe("mountOtpInput", () => {
  for (const pasted of ["123 456", "123-456"]) {
    test(`a pasted ${JSON.stringify(pasted)} becomes the six digits, the caret after them, and the form valid`, async ({ page }) => {
      await mountCode(page);

      await pasteText(page, pasted);

      expect(await field(page)).toEqual({ value: "123456", caret: 6, valid: true });
    });
  }

  test("a digit typed past the length is dropped", async ({ page }) => {
    await mountCode(page);

    await page.keyboard.type("12345678");

    expect(await field(page)).toEqual({ value: "123456", caret: 6, valid: true });
  });

  test("a letter typed mid-code is dropped and the caret stays where it was", async ({ page }) => {
    await mountCode(page, "1234");
    await placeCaret(page, 2);

    await page.keyboard.type("x");

    expect(await field(page)).toEqual({ value: "1234", caret: 2, valid: true });
  });

  test("a separator pasted around a digit mid-code keeps the digit and leaves the caret after it", async ({ page }) => {
    await mountCode(page, "1234");
    await placeCaret(page, 2);

    await pasteText(page, " 9-");

    expect(await field(page)).toEqual({ value: "12934", caret: 3, valid: true });
  });
});
