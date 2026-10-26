import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { classesOf, compiledCss, mount, pasteText, SECURE_ORIGIN } from "../client/browser.fixture";
import { OtpInput } from "./otp-input";

interface Editor {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  value: string;
  attrs: Record<string, string | null>;
}

function editor(page: Page): Promise<Editor> {
  return page.evaluate(() => {
    const el = document.getElementById("field-code") as HTMLInputElement;
    return {
      scrollLeft: el.scrollLeft,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      value: el.value,
      attrs: {
        inputmode: el.getAttribute("inputmode"),
        autocomplete: el.getAttribute("autocomplete"),
        pattern: el.getAttribute("pattern"),
        maxlength: el.getAttribute("maxlength"),
      },
    };
  });
}

const STRETCHING_CONTAINER = ["flex", "w-160", "flex-col", "[&>*]:w-full"];

async function mountOtp(page: Page, { container = [], secure = false }: { container?: readonly string[]; secure?: boolean } = {}): Promise<void> {
  const html = await render(OtpInput({ field: { name: "code" } }));
  const classes = ["bg-background", "p-4", ...container];
  const markup = `<form><div class="${classes.join(" ")}">${html}</div></form>`;
  if (secure) await mount(page, markup, { origin: SECURE_ORIGIN });
  else await mount(page, markup);
  // Both boxes: the frame owns `--otp-cell` and `--otp-length`, which the editor's geometry reads.
  await page.addStyleTag({ content: await compiledCss([...classesOf(html, "otp-input-wrapper"), ...classesOf(html, "otp-input"), ...classes]) });
}

function frameWidth(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector("[data-slot~='otp-input-wrapper']")?.getBoundingClientRect().width ?? 0);
}

test.describe("OtpInput", () => {
  test("carries the mobile-keyboard and autofill affordances on the one native field", async ({ page }) => {
    await mountOtp(page);
    expect((await editor(page)).attrs).toEqual({ inputmode: "numeric", autocomplete: "one-time-code", pattern: null, maxlength: null });
  });

  test("a full code fits its cells: the caret after the last glyph never scrolls the editor", async ({ page }) => {
    await mountOtp(page);
    await page.fill("#field-code", "123456");
    await page.focus("#field-code");
    await page.keyboard.press("End");

    const state = await editor(page);
    expect(state.value).toBe("123456");
    expect(state.scrollLeft).toBe(0);
    expect(state.scrollWidth).toBeLessThanOrEqual(state.clientWidth);
  });

  // Pins `overflow: clip` over `hidden` on the frame: `UI_SSR_COMPONENTS.md` §1i.
  test("typing a full code leaves every digit on its cell: the frame is clipped, not scrolled", async ({ page }) => {
    await mountOtp(page);
    await page.focus("#field-code");
    await page.keyboard.type("123456");

    expect(await page.evaluate(() => document.querySelector<HTMLElement>("[data-slot~='otp-input-wrapper']")?.scrollLeft)).toBe(0);
  });

  // The frame's width is a function of length and cell, never of its container: stretched, the slack
  // would land after the last rule and paint a wider final cell.
  test("a container that sizes its children cannot stretch the frame past its grid", async ({ page }) => {
    await mountOtp(page);
    const intrinsic = await frameWidth(page);

    await mountOtp(page, { container: STRETCHING_CONTAINER });
    expect(await frameWidth(page)).toBe(intrinsic);
  });

  test("with no script, a pasted `123 456` is kept whole and the form is valid, so the server receives it to reduce", async ({ page }) => {
    await mountOtp(page, { secure: true });
    await page.focus("#field-code");
    await pasteText(page, "123 456");

    const submitted = await page.evaluate(() => {
      const form = document.querySelector("form") as HTMLFormElement;
      return { valid: form.checkValidity(), code: new FormData(form).get("code") };
    });
    expect({ value: (await editor(page)).value, ...submitted }).toEqual({ value: "123 456", valid: true, code: "123 456" });
  });
});
