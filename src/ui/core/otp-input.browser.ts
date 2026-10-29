import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { classesOf, compiledCss, mount, paintedHex, pasteText, SECURE_ORIGIN } from "../client/browser.fixture";
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

async function ruleRuns(page: Page): Promise<{ runs: number[]; expected: number[] }> {
  const hex = await paintedHex(page, "var(--color-input)");
  const rgb = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)).join(",");
  const png = Array.from(await page.screenshot({ type: "png" }));
  return page.evaluate(
    async ({ shot, rule }) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(shot)], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const scale = bitmap.width / document.documentElement.clientWidth;
      const wrapper = document.querySelector("[data-slot~='otp-input-wrapper']") as HTMLElement;
      const frame = wrapper.getBoundingClientRect();
      const border = parseFloat(getComputedStyle(wrapper).borderLeftWidth);
      const length = Number(getComputedStyle(wrapper).getPropertyValue("--otp-length") || 6);
      const cell = (frame.width - 2 * border) / length;
      const y = Math.round((frame.top + frame.height / 2) * scale);
      const runs: number[] = [];
      let inside = false;
      for (let x = Math.floor(frame.left * scale) - 2; x < Math.ceil(frame.right * scale) + 2; x++) {
        const i = (y * bitmap.width + x) * 4;
        const on = `${data[i]},${data[i + 1]},${data[i + 2]}` === rule;
        if (on && !inside) runs.push(Math.round(x / scale - frame.left));
        inside = on;
      }
      const interior = Array.from({ length: length - 1 }, (_, k) => Math.round(border + (k + 1) * cell));
      return { runs, expected: [0, ...interior, Math.round(frame.width - border)] };
    },
    { shot: png, rule: rgb },
  );
}

test.describe("OtpInput", { tag: "@cross-engine" }, () => {
  test("carries the mobile-keyboard and autofill affordances on the one native field", async ({ page }) => {
    await mountOtp(page);
    expect((await editor(page)).attrs).toEqual({ inputmode: "numeric", autocomplete: "one-time-code", pattern: null, maxlength: null });
  });

  test("a full code fits its cells: the caret after the last glyph never scrolls the editor", async ({ page }) => {
    await mountOtp(page);
    await page.focus("#field-code");
    await page.keyboard.type("123456");

    const state = await editor(page);
    expect(state.value).toBe("123456");
    expect(state.scrollLeft).toBeLessThanOrEqual(1);
  });

  // Pins `overflow-x: clip` over `hidden` on the frame: `UI_SSR_COMPONENTS.md` §1i.
  test("typing a full code leaves every digit on its cell: the frame is clipped, not scrolled", async ({ page }) => {
    await mountOtp(page);
    await page.focus("#field-code");
    await page.keyboard.type("123456");

    expect(await page.evaluate(() => document.querySelector<HTMLElement>("[data-slot~='otp-input-wrapper']")?.scrollLeft)).toBe(0);
  });

  test("a press on the frame's top border lands on the editor, so the measured box is the clickable one", async ({ page }) => {
    await mountOtp(page);
    const hit = await page.evaluate(() => {
      const frame = document.querySelector("[data-slot~='otp-input-wrapper']")?.getBoundingClientRect();
      if (!frame) return null;
      return document.elementFromPoint(frame.left + frame.width / 2, frame.top)?.getAttribute("data-slot");
    });
    expect(hit).toBe("otp-input");
  });

  // The frame's width is a function of length and cell, never of its container: stretched, the slack
  // would land after the last rule and paint a wider final cell.
  test("a container that sizes its children cannot stretch the frame past its grid", async ({ page }) => {
    await mountOtp(page);
    const intrinsic = await frameWidth(page);

    await mountOtp(page, { container: STRETCHING_CONTAINER });
    expect(await frameWidth(page)).toBe(intrinsic);
  });

  test("rules each interior cell boundary in the field's border colour, and neither outer edge", async ({ page }) => {
    await mountOtp(page);
    const { runs, expected } = await ruleRuns(page);
    expect(runs).toEqual(expected);
    expect(expected).toHaveLength(7);
  });

  test("with no script, a pasted `123 456` is kept whole and the form is valid, so the server receives it to reduce", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName === "firefox", "no clipboard-read/clipboard-write permission grant in Playwright");
    test.skip(browserName === "webkit", "no clipboard-read/clipboard-write permission grant in Playwright");
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
