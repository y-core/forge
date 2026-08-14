import { ANCHOR_X_PROPERTY, ANCHOR_Y_PROPERTY, POPOVER_COORDS_ATTR } from "../contracts/overlay-contract";
import { ownerDocument, ownerWindow } from "./dom";
import { triggersFor } from "./transition";

/** Options for {@link openPopoverAt}. */
export interface OpenPopoverAtOptions {
  /** Keep this many pixels between the popup and each viewport edge. @default 0 */
  margin?: number;
  /** Open away from the point on an axis where the popup would not fit, instead of clamping it back on screen. @default false */
  flip?: boolean;
  /** Hold the show back until the pointer button currently held down is released. @default false */
  afterPointerUp?: boolean;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function axis(point: number, size: number, extent: number, margin: number, flip: boolean): number {
  const preferred = flip && point + size + margin > extent && point - size >= margin ? point - size : point;
  // `Math.max(margin, …)`: a popup larger than the viewport would otherwise clamp to a negative
  // offset and hang off the opposite edge.
  return clamp(preferred, margin, Math.max(margin, extent - size - margin));
}

function place(el: HTMLElement, win: Window, x: number, y: number, margin: number, flip: boolean): void {
  const rect = el.getBoundingClientRect();
  el.style.setProperty(ANCHOR_X_PROPERTY, `${axis(x, rect.width, win.innerWidth, margin, flip)}px`);
  el.style.setProperty(ANCHOR_Y_PROPERTY, `${axis(y, rect.height, win.innerHeight, margin, flip)}px`);
}

/** Shows a native popover with its top-left corner at viewport coordinates `x`, `y`, clamped to keep the panel on screen. @public */
export function openPopoverAt(el: HTMLElement, x: number, y: number, options: OpenPopoverAtOptions = {}): void {
  const win = ownerWindow(el);
  const margin = options.margin ?? 0;
  const flip = options.flip ?? false;

  const show = () => {
    el.setAttribute(POPOVER_COORDS_ATTR, "");
    place(el, win, x, y, margin, flip);

    if (el.hasAttribute("popover") && !el.matches(":popover-open")) el.showPopover();

    // Placed a second time in the same task: before showing, the popup is `display: none` and
    // measures zero, so neither the flip nor the clamp had a box to reason about.
    place(el, win, x, y, margin, flip);
  };

  if (!options.afterPointerUp) {
    show();
    return;
  }

  // The platform's light-dismiss pass runs on the `pointerup` that ends the opening right-click and
  // would hide the menu one event after it appeared; a capture listener on the document shows it
  // after that pass, within the same event so no frame is missed.
  ownerDocument(el).addEventListener("pointerup", show, { once: true, capture: true });
}

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

/** The declared `anchor-name` list read from the cascade, since a composed trigger's name comes from
 * a stylesheet rule that `el.style` would not report. `none` is the initial value, not a name. */
function declaredAnchorNames(trigger: HTMLElement, win: Window): string[] {
  const declared = win.getComputedStyle(trigger).getPropertyValue("anchor-name").trim();
  if (!declared || declared === "none") return [];
  return declared
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/** Binds a native popup to the invoker that opens it, at the moment it opens, and returns a disposer. @public */
export function mountAnchorBinding(popup: HTMLElement): () => void {
  const win = ownerWindow(popup);
  let anchored: HTMLElement | null = null;

  const onBeforeToggle = (event: Event) => {
    // `beforetoggle` fires before the open state's layout pass, so the first painted frame is
    // already anchored; `toggle` is one frame late and the panel flashes from the viewport centre.
    // Bailing on close before the clear below is load-bearing: the panel stays painted through its
    // exit animation, and dropping `position-anchor` there would jump it mid-fade.
    if ((event as Event & { newState?: string }).newState !== "open") return;

    // Cleared at the top of the open path so every return below falls back to the stylesheet's
    // panel binding rather than to a stale name no live element answers to.
    popup.style.removeProperty("position-anchor");

    if (popup.hasAttribute(POPOVER_COORDS_ATTR)) return;
    const trigger = triggersFor(popup)[0];
    if (!trigger) return;

    if (anchored && anchored !== trigger) anchored.style.removeProperty("anchor-name");

    const name = anchorNameFor(trigger);
    const names = declaredAnchorNames(trigger, win);
    if (!names.includes(name)) names.push(name);
    trigger.style.setProperty("anchor-name", names.join(", "));
    popup.style.setProperty("position-anchor", name);
    anchored = trigger;
  };

  popup.addEventListener("beforetoggle", onBeforeToggle);

  return () => {
    popup.removeEventListener("beforetoggle", onBeforeToggle);
    popup.style.removeProperty("position-anchor");
    anchored?.style.removeProperty("anchor-name");
    anchored = null;
  };
}
