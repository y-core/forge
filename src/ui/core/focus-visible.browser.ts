import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { classesOf, escapeClass, mount } from "../client/browser-test-helper";
import { Button } from "./button";
import { createIcon } from "./icon";
import { Input } from "./input";
import { Select } from "./select";
import { Slider } from "./slider";
import { Textarea } from "./textarea";

// Probed as `outline-style`, not `outline-width`: an unfocused element already computes the
// marker's own width with `outline-style: none`, so a width probe cannot tell matched from unmatched.
const MARKER_OUTLINE_STYLE = "solid";
const UNSTYLED_OUTLINE_STYLE = "none";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 24 24" });

interface Control {
  /** How the failure line names it. */
  name: string;
  /** The `data-slot` token the control's own element carries. */
  slot: string;
  /** The rendered markup, as the component emits it. */
  html: () => Promise<string>;
  /** Whether a pointer press matches `:focus-visible` on Chromium — measured, not assumed. */
  focusVisibleOnPointer: boolean;
}

const CONTROLS: readonly Control[] = [
  { name: "Input", slot: "input", html: () => render(Input({ name: "q" })), focusVisibleOnPointer: true },
  { name: "Textarea", slot: "textarea", html: () => render(Textarea({ name: "q" })), focusVisibleOnPointer: true },
  {
    name: "Select",
    slot: "select",
    html: () => render(Select({ name: "q", icon, children: Select.Option({ value: "a", children: "A" }) })),
    focusVisibleOnPointer: true,
  },
  { name: "Slider", slot: "slider", html: () => render(Slider({ name: "q" })), focusVisibleOnPointer: false },
  // The negative control: without a case that legitimately reports absence, a selector that never
  // matched anything would pass every positive assertion here.
  { name: "Button", slot: "button", html: () => render(Button({ children: "Save" })), focusVisibleOnPointer: false },
];

/** A stylesheet that paints the marker through the control's own compiled `focus-visible:` classes. */
function focusVisibleRule(classes: readonly string[]): string {
  const selector = classes
    .filter((cls) => cls.startsWith("focus-visible:"))
    .map((cls) => `.${escapeClass(cls)}:focus-visible`)
    .join(",");
  return `${selector}{outline:3px ${MARKER_OUTLINE_STYLE} rgb(0,255,0)}`;
}

/** The computed outline style of the control — the marker, read back. */
function outlineStyle(page: Page, slot: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).outlineStyle : "no-element";
  }, `[data-slot~='${slot}']`);
}

for (const control of CONTROLS) {
  test.describe(`${control.name} — focus-visible`, () => {
    test("emits a focus-visible ring rather than a bare focus: one", async () => {
      const classes = classesOf(await control.html(), control.slot);

      expect(classes).toContain("focus-visible:ring-2");
      expect(classes.filter((cls) => /^focus:/.test(cls))).toEqual([]);
    });

    test("matches :focus-visible when reached by keyboard, so the ring is really delivered", async ({ page }) => {
      const html = await control.html();
      const css = focusVisibleRule(classesOf(html, control.slot));
      await mount(page, html);
      await page.addStyleTag({ content: css });

      await page.keyboard.press("Tab");

      expect(await page.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toContain(control.slot);
      expect(await outlineStyle(page, control.slot)).toBe(MARKER_OUTLINE_STYLE);
    });

    test(`${control.focusVisibleOnPointer ? "keeps" : "withholds"} the ring on a pointer press`, async ({ page }) => {
      const html = await control.html();
      const css = focusVisibleRule(classesOf(html, control.slot));
      await mount(page, html);
      await page.addStyleTag({ content: css });

      expect(await outlineStyle(page, control.slot)).toBe(UNSTYLED_OUTLINE_STYLE);

      await page.click(`[data-slot~='${control.slot}']`);

      expect(await outlineStyle(page, control.slot)).toBe(control.focusVisibleOnPointer ? MARKER_OUTLINE_STYLE : UNSTYLED_OUTLINE_STYLE);
    });
  });
}
