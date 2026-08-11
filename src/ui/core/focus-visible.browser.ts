import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Button } from "./button";
import { createIcon } from "./icon";
import { Input } from "./input";
import { Select } from "./select";
import { Slider } from "./slider";
import { Textarea } from "./textarea";

/**
 * The focus affordances of the four controls the 0.0.83 WCAG remediation touched, driven in a real
 * browser.
 *
 * Two claims that release made are **platform** claims, not markup ones, and neither is checkable
 * from a rendered string:
 *
 * 1. **`Slider` now has a focus indicator at all** — WCAG 2.4.7, Level A. `<input type=range>` gets
 *    a UA focus ring; `appearance-none` removes it, and until 0.0.83 nothing put one back. The fix
 *    is a `focus-visible:` ring, which is only a fix if the engine actually treats a tabbed-to range
 *    input as focus-visible.
 * 2. **Moving `Input`/`Textarea`/`Select` from `focus:` to `focus-visible:` did not remove their
 *    ring.** That migration is safe only because `:focus-visible` matches a focused text field
 *    whatever focused it. If that were false, the change would have silently deleted the focus
 *    indicator for every keyboard user — a far worse defect than the one it fixed. Asserting it is
 *    the point of this file.
 *
 * **The fixture cannot agree with a class the component does not emit.** Every selector below is
 * compiled from the component's *own* rendered class list, the way `switch.browser.ts` does it, so
 * deleting `focus-visible:ring-2` from a component fails here rather than quietly passing.
 *
 * **No Tailwind runs** (see `browser-test-helper.ts`), so the utility's real declaration is
 * unavailable and its *colour* cannot be measured here — that is the contrast gate's job, and
 * `scripts/contrast-parse.ts` records the ratios. What is measured here is strictly whether the
 * variant **matches**: an unmistakable marker declaration is injected against the compiled selector,
 * and a computed style says whether the engine applied it.
 */

/**
 * The marker the injected rule paints, read as `outline-style`.
 *
 * **Not `outline-width`.** An unfocused `<button>` already computes `outline-width: 3px` with
 * `outline-style: none`, because CSS computes the two independently and only the *used* value
 * collapses to zero — so a width probe reports the marker's own value before the marker exists and
 * can never distinguish a matched rule from an unmatched one. `outline-style` has no such default:
 * `none` → `solid` is a transition only the injected rule can cause.
 */
const MARKER = "solid";
const NO_MARKER = "none";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 24 24" });

interface Control {
  /** How the failure line names it. */
  name: string;
  /** The `data-slot` token the control's own element carries. */
  slot: string;
  /** The rendered markup, as the component emits it. */
  html: () => Promise<string>;
  /**
   * Whether a **pointer** press matches `:focus-visible`. **Measured, not assumed** — an earlier
   * revision of this file guessed at these and got `Select` wrong.
   *
   * Measured on Chromium: `Input`, `Textarea` and `Select` match; `Slider` and `Button` do not. The
   * dividing line is not "keyboard versus mouse" but whether focus *lands somewhere the keyboard
   * then does the work*: a text field is about to be typed into, and a closed `<select>` is about to
   * be arrowed through. Pressing a button and dragging a range thumb are both interactions the
   * pointer completes by itself, so a ring afterwards would be noise.
   *
   * `Button` is on this list purely as the **negative control**. Without a case that legitimately
   * reports absence, a selector that never matched anything would pass every positive assertion —
   * and an earlier revision of this file did exactly that, silently, because it probed
   * `outline-width` (see `MARKER`).
   */
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
  // Withholds, unlike the three above: dragging a range thumb is a pointer interaction that
  // completes on its own, so Chromium treats it the way it treats a button press.
  { name: "Slider", slot: "slider", html: () => render(Slider({ name: "q" })), focusVisibleOnPointer: false },
  // Not part of the 0.0.83 change. Here purely as the negative control described above.
  { name: "Button", slot: "button", html: () => render(Button({ children: "Save" })), focusVisibleOnPointer: false },
];

/** The rendered class list of one slot, un-escaped back from HTML. `data-slot` is a token list, so
 *  the token is matched at its own boundaries — the same helper `switch.browser.ts` uses. */
function classesOf(html: string, slot: string): string[] {
  const match = new RegExp(`data-slot="(?:[^"]*\\s)?${slot}(?:\\s[^"]*)?"[^>]*?class="([^"]*)"`).exec(html);
  if (!match?.[1]) throw new Error(`no class attribute on [data-slot~='${slot}']`);
  return match[1].replaceAll("&amp;", "&").split(" ");
}

/** CSS.escape, which the page has and Node does not. */
function escapeClass(cls: string): string {
  return cls.replace(/[[\]:&~=.*>+,()#%'"^$|{}/\\?!@`\s]/g, (ch) => `\\${ch}`);
}

/**
 * Compile the control's own `focus-visible:` classes into the selector Tailwind would generate, and
 * return a stylesheet that paints the marker through it.
 *
 * Every `focus-visible:x` class becomes `.focus-visible\:x:focus-visible`. Joining them means the
 * marker appears if **any** of the control's focus-visible utilities match, which is the question —
 * whether the engine considers this element focus-visible — rather than a claim about which
 * particular utility carries the ring.
 */
function focusVisibleRule(classes: readonly string[]): string {
  const selector = classes
    .filter((cls) => cls.startsWith("focus-visible:"))
    .map((cls) => `.${escapeClass(cls)}:focus-visible`)
    .join(",");
  return `${selector}{outline:3px ${MARKER} rgb(0,255,0)}`;
}

/** The computed outline *style* of the control — the marker, read back. See `MARKER`. */
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

      // Both halves matter. The first is the regression guard for the Level A fix and for the
      // `focus:` migration; the second is what `forge-ui-interaction-focus-visible` forbids, and a
      // component carrying both variants would pass the first check while still flashing on click.
      expect(classes).toContain("focus-visible:ring-2");
      expect(classes.filter((cls) => /^focus:/.test(cls))).toEqual([]);
    });

    test("matches :focus-visible when reached by keyboard, so the ring is really delivered", async ({ page }) => {
      const html = await control.html();
      const css = focusVisibleRule(classesOf(html, control.slot));
      await mount(page, html);
      await page.addStyleTag({ content: css });

      // Tab from the document rather than calling `.focus()`: the engine's focus-visible heuristic
      // reads *how* focus arrived, so a scripted focus would not exercise the thing under test.
      await page.keyboard.press("Tab");

      expect(await page.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toContain(control.slot);
      expect(await outlineStyle(page, control.slot)).toBe(MARKER);
    });

    test(`${control.focusVisibleOnPointer ? "keeps" : "withholds"} the ring on a pointer press`, async ({ page }) => {
      const html = await control.html();
      const css = focusVisibleRule(classesOf(html, control.slot));
      await mount(page, html);
      await page.addStyleTag({ content: css });

      // Before anything is focused the marker must be absent. Without this line a selector that
      // matched nothing and a selector that matched always would both read as a pass on one of the
      // two branches below.
      expect(await outlineStyle(page, control.slot)).toBe(NO_MARKER);

      await page.click(`[data-slot~='${control.slot}']`);

      expect(await outlineStyle(page, control.slot)).toBe(control.focusVisibleOnPointer ? MARKER : NO_MARKER);
    });
  });
}
