import { ANCHOR_X_PROPERTY, ANCHOR_Y_PROPERTY, POPOVER_COORDS_ATTR } from "../contracts/overlay-contract";
import { ownerDocument, ownerWindow } from "./dom";
import { triggersFor } from "./transition";

/**
 * The two placement escape hatches CSS alone cannot express, and the module that owns the CSSOM
 * argument they share.
 *
 * forge positions every popup with CSS Anchor Positioning against an explicit `anchor-name` /
 * `position-anchor` pair declared in `forge-ui.css` — there is no implicit anchor to lean on, since
 * the one a UA supplies comes from `popovertarget` and forge invokes with `command`/`commandfor`.
 * That static binding covers every surface whose trigger is a *fixed* element of the compound.
 * {@link openPopoverAt} serves the popup with **no** trigger, and {@link mountAnchorBinding} the
 * popup whose trigger is only known at runtime.
 *
 * Both write **custom properties or anchor names through CSSOM**, never a generated `style`
 * attribute. Two independent reasons, and either alone would decide it: forge's CSP carries no
 * `style-src 'unsafe-inline'`, so an inline style would be blocked in exactly the app this exists
 * for, and the JSX renderer drops `style` outright, so there would be nothing to write it onto
 * server-side either. `el.style.setProperty` sets a property on the live CSSOM declaration, which is
 * not an inline-style *string* and is not what CSP gates.
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
  /**
   * Hold the show back until the pointer button currently held down is released.
   *
   * **This is what makes a context menu opened from `contextmenu` survive its own gesture.** The
   * event fires *between* `pointerdown` and `pointerup`, and the platform's light-dismiss pass runs
   * on that trailing `pointerup`: it compares the popover ancestor of the pointerdown target with the
   * ancestor of the pointerup target, and hides everything up to the match. Neither is inside a popup
   * — nothing was open when the button went down, and the pointer is over the surface, not over the
   * panel that has just appeared beside it — so the two agree on "no popover" and the menu is hidden
   * one event after it was shown. What the reader sees is a menu that flashes and vanishes.
   *
   * Deferring past the release leaves that pass nothing to dismiss, and the *next* click dismisses
   * the menu exactly as it always did — the guard is one-shot and belongs to the opening gesture
   * alone.
   *
   * Pass `event.buttons !== 0` rather than `true`: a `contextmenu` raised from the keyboard (the Menu
   * key, `Shift+F10`) reports no buttons and is followed by no `pointerup` at all, so an
   * unconditional guard would arm a listener that the *next* unrelated click fires — opening the menu
   * at a stale point, long after the keypress that asked for it.
   *
   * ```ts
   * surface.addEventListener("contextmenu", (event) => {
   *   event.preventDefault();
   *   openPopoverAt(menu, event.clientX, event.clientY, { afterPointerUp: event.buttons !== 0 });
   * });
   * ```
   * @default false
   */
  afterPointerUp?: boolean;
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
 *   openPopoverAt(menu, event.clientX, event.clientY, { afterPointerUp: event.buttons !== 0 });
 * });
 * ```
 *
 * {@link OpenPopoverAtOptions.afterPointerUp} is not decoration on that example: without it the
 * platform light-dismisses the menu on the very `pointerup` that ends the right-click which opened
 * it. See the option's own note for why the dismiss pass matches.
 *
 * The element must opt into coordinate placement in its markup (`Menu.Popup`'s `coords` prop, or
 * the `data-coords` attribute directly) so the coordinate rule wins over the anchored ones.
 * @public
 */
export function openPopoverAt(el: HTMLElement, x: number, y: number, options: OpenPopoverAtOptions = {}): void {
  const win = ownerWindow(el);
  const margin = options.margin ?? 0;
  const flip = options.flip ?? false;

  const show = () => {
    // Stamped rather than assumed: calling this on an element is the act that makes it
    // coordinate-placed, so a popup that opens both ways does not need two markup variants.
    el.setAttribute(POPOVER_COORDS_ATTR, "");
    place(el, win, x, y, margin, flip);

    if (el.hasAttribute("popover") && !el.matches(":popover-open")) el.showPopover();

    // Show, measure, re-place — all in one task, so the browser paints the corrected position rather
    // than the provisional one. **The second call is the one that does the real work**: before
    // showing, the popup is `display: none` and measures zero, so neither the flip nor the clamp has
    // a box to reason about.
    place(el, win, x, y, margin, flip);
  };

  if (!options.afterPointerUp) {
    show();
    return;
  }

  // Capture on the document, which is where the guard has to sit: the light-dismiss pass runs ahead
  // of the listeners for the same `pointerup`, so by the time this fires the dismissal it exists to
  // survive is already over — and showing here is still inside that one event, before any paint, so
  // there is no frame in which the menu is missing. `once`, because the guard belongs to the single
  // gesture that armed it; every later release is an ordinary dismissal and must stay one.
  ownerDocument(el).addEventListener("pointerup", show, { once: true, capture: true });
}

/**
 * Anchor names minted per trigger, so re-opening a popup reuses the name it already had rather than
 * minting a second and leaving the first on the element forever.
 *
 * A `WeakMap` because the key is the trigger element: a menu whose rows are rebuilt between openings
 * discards its old triggers, and holding them in a `Map` would keep every one of them alive.
 */
const anchorNames = new WeakMap<HTMLElement, string>();
let anchorSeq = 0;

function anchorNameFor(trigger: HTMLElement): string {
  const existing = anchorNames.get(trigger);
  if (existing) return existing;
  anchorSeq += 1;
  const minted = `--forge-anchor-${anchorSeq}`;
  anchorNames.set(trigger, minted);
  return minted;
}

/** The declared `anchor-name` list, from the cascade rather than from the inline declaration — the
 * name a composed trigger already carries comes from a stylesheet rule, and reading `el.style` would
 * report none of it. `none` is the initial value and means "no names", not a name called `none`. */
function declaredAnchorNames(trigger: HTMLElement, win: Window): string[] {
  const declared = win.getComputedStyle(trigger).getPropertyValue("anchor-name").trim();
  if (!declared || declared === "none") return [];
  return declared
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * Bind a native popup to the invoker that opens it, at the moment it opens, and return a disposer.
 *
 * The static rules in `forge-ui.css` bind every popup whose trigger is a *fixed* part of its
 * compound — one `Popover.Trigger` per `Popover`, one `Menu.Trigger` per `Menu`. A **submenu** is the
 * case they cannot express: `Menu.SubmenuTrigger` and its nested `Menu.Popup` are siblings among the
 * rows of the parent panel with no wrapper between them (a wrapper inside a `role="menu"` would break
 * the ARIA content model), and the SSR renderer drops `style`, so no per-instance `anchor-name` can
 * be emitted server-side. The stylesheet's answer there is to name the **parent panel**, which is
 * correct but coarse: the submenu pins to the panel's edge rather than to the row that opened it.
 *
 * This upgrades that to row-accurate. It resolves the invoker, mints a stable anchor name for it, and
 * writes `anchor-name` on the trigger and `position-anchor` on the popup through CSSOM. Inline CSSOM
 * beats any stylesheet rule, and the placement matrix is anchor-*agnostic* — every rule is written in
 * terms of `anchor()`, never of a particular name — so the box resolves against whatever
 * `position-anchor` currently says.
 *
 * ```ts
 * registerScope("menu", { setup: ({ root }) => mountAnchorBinding(root) });
 * ```
 *
 * Three details are the whole of the correctness:
 *
 * - **`beforetoggle`, not `toggle`.** It fires before the open state's style and layout pass, so the
 *   first painted frame is already anchored. `toggle` is one frame late and the popup visibly flashes
 *   from the viewport centre — the same reasoning `mountTransitionState` uses for its enter.
 * - **The trigger's `anchor-name` is read and appended to, never overwritten.** A composed trigger
 *   (`<Tooltip.Trigger asChild><Menu.Trigger/></Tooltip.Trigger>`) already carries `--forge-tooltip`
 *   from the stylesheet, and a bare inline write would clobber it and leave the tooltip centred:
 *   precisely the failure this whole mechanism exists to remove.
 * - **A coordinate-placed popup gets no anchor binding.** `openPopoverAt` owns placement outright
 *   there, and an anchor it does not consult would be dead weight at best — so none is written, and
 *   whatever an earlier anchored open left behind is dropped.
 *
 * With several invokers for one popup the **first in document order** is chosen. `anchor()` resolves
 * against a single element, so unlike `mountPopupTriggerState` — which stamps all of them — this can
 * only pick one, and a popup opened from two places anchors to the earlier button whichever was used.
 * @public
 */
export function mountAnchorBinding(popup: HTMLElement): () => void {
  const win = ownerWindow(popup);
  /** The one trigger currently carrying an inline `anchor-name` from this controller, unwound on the
   * next open. A menu whose rows are rebuilt between openings — the case the `WeakMap` above exists
   * for — resolves a different first invoker each time, so the previous one still has to lose the
   * name it was given; holding *every* past trigger instead would keep each discarded row alive for
   * as long as the popup lives, which is the retention that `WeakMap` was chosen to avoid. */
  let anchored: HTMLElement | null = null;

  const onBeforeToggle = (event: Event) => {
    // Above the clear below, and load-bearing in that order: `mountTransitionState` keeps the panel
    // painted through its exit animation, so dropping `position-anchor` on a close would re-expose
    // the stylesheet's panel binding on a still-visible panel and jump it from the row it opened
    // from to the parent panel's own edge, mid-fade.
    if ((event as Event & { newState?: string }).newState !== "open") return;

    // Cleared at the top of the open path so that every return below it falls back to the
    // stylesheet's panel binding — coarse but correct — rather than to a stale name from an earlier
    // open that no live element answers to, which resolves to nothing and centres the popup instead.
    popup.style.removeProperty("position-anchor");

    if (popup.hasAttribute(POPOVER_COORDS_ATTR)) return;
    const trigger = triggersFor(popup)[0];
    if (!trigger) return;

    // The outgoing trigger gives up its inline name before the incoming one gains one, so at most a
    // single element is retained. Guarded because re-opening from the same trigger is the common
    // case, and unwinding there would only strip the declaration this is about to rewrite.
    if (anchored && anchored !== trigger) anchored.style.removeProperty("anchor-name");

    const name = anchorNameFor(trigger);
    const names = declaredAnchorNames(trigger, win);
    // Membership rather than a blind append: the name is stable per trigger, so the second opening
    // reads back the list this wrote on the first and would otherwise grow it without bound.
    if (!names.includes(name)) names.push(name);
    trigger.style.setProperty("anchor-name", names.join(", "));
    popup.style.setProperty("position-anchor", name);
    anchored = trigger;
  };

  popup.addEventListener("beforetoggle", onBeforeToggle);

  return () => {
    popup.removeEventListener("beforetoggle", onBeforeToggle);
    // Removing the inline declarations restores whatever the stylesheet said, which is the coarse but
    // still-correct panel binding — a disposed controller leaves a working menu, not a centred one.
    popup.style.removeProperty("position-anchor");
    anchored?.style.removeProperty("anchor-name");
    anchored = null;
  };
}
