import { ANCHOR_X_PROPERTY, ANCHOR_Y_PROPERTY, POPOVER_COORDS_ATTR } from "../contracts/overlay-contract";
import { ownerWindow } from "./dom";

/**
 * Open a native popup at a **pointer coordinate**, for the one case anchor positioning cannot serve.
 *
 * forge positions every other popup with CSS Anchor Positioning against the invoker — a popover's
 * implicit anchor is the button its `commandfor` names, and the whole placement set in
 * `theme-base.css` is keyed off `anchor()`. A **context menu has no invoker**: it opens at the point
 * a right-click landed on a canvas, and the element under the pointer is not a trigger. Every
 * anchored rule then resolves to nothing and the UA's `[popover]` default centres the panel.
 *
 * The coordinates travel as **custom properties written through CSSOM**, never as a generated
 * `style` attribute. Two independent reasons, and either alone would decide it: forge's CSP carries
 * no `style-src 'unsafe-inline'`, so an inline style would be blocked in exactly the app this
 * exists for, and the JSX renderer drops `style` outright, so there would be nothing to write it
 * onto server-side either. `el.style.setProperty` sets a property on the live CSSOM declaration,
 * which is not an inline-style *string* and is not what CSP gates.
 */

/** Options for {@link openPopoverAt}. */
export interface OpenPopoverAtOptions {
  /** Keep this many pixels between the popup and each viewport edge. @default 0 */
  margin?: number;
  /**
   * Open *away* from the point on an axis where the popup would not fit, instead of sliding it back
   * onto the screen.
   *
   * **Both behaviours keep the popup on screen; they differ in where the pointer ends up.** Clamping
   * slides the box back, which leaves the point **inside** it — for a context menu that means the row
   * under the cursor is pre-hovered and the next click lands on a command the user never aimed at.
   * Flipping mirrors the box to the other side of the point, which is the convention every desktop
   * context menu follows: near the bottom edge the menu opens upward, with the cursor still at its
   * corner.
   *
   * Per axis, not per popup: a menu near the bottom-right flips on both, near the bottom only on one.
   * A flip that would not fit either falls back to clamping, so the guarantee that the whole panel
   * stays on screen is unconditional.
   * @default false
   */
  flip?: boolean;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Resolve one axis: flip past the point if asked and it helps, then clamp regardless.
 *
 * The clamp is applied **after** the flip rather than instead of it, so "the whole panel is on
 * screen" holds however the flip turned out — a popup taller than the viewport cannot be made to fit
 * by mirroring it, and silently leaving it off-screen would be worse than ignoring the preference.
 */
function axis(point: number, size: number, extent: number, margin: number, flip: boolean): number {
  const preferred = flip && point + size + margin > extent && point - size >= margin ? point - size : point;
  // `Math.max(margin, …)` rather than a bare subtraction: a popup larger than the viewport would
  // otherwise be clamped to a negative offset and hang off the *other* edge instead.
  return clamp(preferred, margin, Math.max(margin, extent - size - margin));
}

/**
 * Write the resolved coordinates. Called twice by design: once before the popup is shown, when it is
 * still `display: none` and measures zero, and once after, when its real box is known. Both the flip
 * and the clamp need the size — "does this fit" is a question about the box, not the point.
 */
function place(el: HTMLElement, win: Window, x: number, y: number, margin: number, flip: boolean): void {
  const rect = el.getBoundingClientRect();
  el.style.setProperty(ANCHOR_X_PROPERTY, `${axis(x, rect.width, win.innerWidth, margin, flip)}px`);
  el.style.setProperty(ANCHOR_Y_PROPERTY, `${axis(y, rect.height, win.innerHeight, margin, flip)}px`);
}

/**
 * Show `el` — a native popover — with its top-left corner at viewport coordinates `x`, `y`, clamped
 * so the whole panel stays on screen. Already open is fine: it is repositioned, which is what a
 * second right-click somewhere else should do.
 *
 * ```ts
 * canvas.addEventListener("contextmenu", (event) => {
 *   event.preventDefault();
 *   openPopoverAt(menu, event.clientX, event.clientY);
 * });
 * ```
 *
 * The element must opt into coordinate placement in its markup (`Menu.Popup`'s `coords` prop, or
 * the `data-coords` attribute directly) so the coordinate rule wins over the anchored ones.
 * @public
 */
export function openPopoverAt(el: HTMLElement, x: number, y: number, options: OpenPopoverAtOptions = {}): void {
  const win = ownerWindow(el);
  const margin = options.margin ?? 0;
  const flip = options.flip ?? false;

  // Stamped rather than assumed: calling this on an element is the act that makes it
  // coordinate-placed, so a popup that opens both ways does not need two markup variants.
  el.setAttribute(POPOVER_COORDS_ATTR, "");
  place(el, win, x, y, margin, flip);

  if (el.hasAttribute("popover") && !el.matches(":popover-open")) el.showPopover();

  // Show, measure, re-place — all in one task, so the browser paints the corrected position rather
  // than the provisional one. **The second call is the one that does the real work**: before showing,
  // the popup is `display: none` and measures zero, so neither the flip nor the clamp has a box to
  // reason about.
  place(el, win, x, y, margin, flip);
}
