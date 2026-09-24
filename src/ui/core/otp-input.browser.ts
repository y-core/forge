import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { classesOf, compiledCss, mount } from "../client/browser.fixture";
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

// `Field`'s own vertical arrangement, which sizes every direct child and outranks the frame's width.
const STRETCHING_CONTAINER = ["flex", "w-160", "flex-col", "[&>*]:w-full"];

async function mountOtp(page: Page, length: 4 | 6, container: readonly string[] = []): Promise<void> {
  const html = await render(OtpInput({ field: { name: "code" }, length }));
  const classes = ["bg-background", "p-4", ...container];
  await mount(page, `<div class="${classes.join(" ")}">${html}</div>`);
  // Both boxes: the frame owns `--otp-cell` and `--otp-length`, which the editor's geometry reads.
  await page.addStyleTag({ content: await compiledCss([...classesOf(html, "otp-input-wrapper"), ...classesOf(html, "otp-input"), ...classes]) });
}

function frameWidth(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector("[data-slot~='otp-input-wrapper']")?.getBoundingClientRect().width ?? 0);
}

test.describe("OtpInput", () => {
  test("carries the mobile-keyboard and autofill affordances on the one native field", async ({ page }) => {
    await mountOtp(page, 6);
    expect((await editor(page)).attrs).toEqual({ inputmode: "numeric", autocomplete: "one-time-code", pattern: "[0-9]*", maxlength: "6" });
  });

  test("a full code fits its cells: the caret after the last glyph never scrolls the editor", async ({ page }) => {
    await mountOtp(page, 6);
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
    await mountOtp(page, 6);
    await page.focus("#field-code");
    await page.keyboard.type("123456");

    expect(await page.evaluate(() => document.querySelector<HTMLElement>("[data-slot~='otp-input-wrapper']")?.scrollLeft)).toBe(0);
  });

  // The frame's width is a function of length and cell, never of its container: stretched, the slack
  // would land after the last rule and paint a wider final cell.
  test("a container that sizes its children cannot stretch the frame past its grid", async ({ page }) => {
    await mountOtp(page, 6);
    const intrinsic = await frameWidth(page);

    await mountOtp(page, 6, STRETCHING_CONTAINER);
    expect(await frameWidth(page)).toBe(intrinsic);
  });

  test("a seventh digit is refused by the native maxlength", async ({ page }) => {
    await mountOtp(page, 4);
    await page.focus("#field-code");
    await page.keyboard.type("12345");
    expect((await editor(page)).value).toBe("1234");
  });
});
