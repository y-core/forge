import { ANCHOR_X_PROPERTY, ANCHOR_Y_PROPERTY, POPOVER_COORDS_ATTR } from "../contracts/overlay-contract";
import { ownerDocument, ownerWindow } from "./dom";
import type { OpenPopoverAtOptions } from "./types";

/** Confines `value` to `low..high`, where an inverted range resolves to `high`. @internal */
export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** The on-screen offset for one axis, flipping away from the point or clamping back on screen. @internal */
export function axis(point: number, size: number, extent: number, margin: number, flip: boolean): number {
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

/** The pending deferred show per element, so a second call cancels the first. */
const pendingArms = new WeakMap<HTMLElement, () => void>();

/** The latest call per element, so a superseded call's disposer leaves the newer placement's close-time clear armed. */
const latestCalls = new WeakMap<HTMLElement, object>();

// htmx 4's settle copies a leftover `style` attribute onto the swapped-in element through
// `setAttribute`, which the CSP's `style-src-attr` blocks.
function clearPlacementOnClose(event: Event): void {
  if ((event as Event & { newState?: string }).newState !== "closed") return;
  const el = event.currentTarget as HTMLElement;
  el.style.removeProperty(ANCHOR_X_PROPERTY);
  el.style.removeProperty(ANCHOR_Y_PROPERTY);
  // Chrome writes a pending CSSOM change back as `style=""` after removal unless the attribute is read first.
  if (el.getAttribute("style") === "") el.removeAttribute("style");
  el.removeEventListener("toggle", clearPlacementOnClose);
}

/** Shows a native popover with its top-left corner at viewport coordinates `x`, `y`, clamped to keep the panel on screen, and returns a disposer. @public */
export function openPopoverAt(el: HTMLElement, x: number, y: number, options: OpenPopoverAtOptions = {}): () => void {
  const win = ownerWindow(el);
  const margin = options.margin ?? 0;
  const flip = options.flip ?? false;

  // A second call supersedes the first: leaving the earlier listener armed would show the panel at
  // the stale coordinates on the next pointer release.
  pendingArms.get(el)?.();

  const call = {};
  latestCalls.set(el, call);
  const releaseClear = () => {
    if (latestCalls.get(el) === call) el.removeEventListener("toggle", clearPlacementOnClose);
  };

  const show = () => {
    pendingArms.delete(el);
    // An htmx swap between the arm and the release detaches the panel, and `showPopover()` on a
    // detached element throws.
    if (!el.isConnected) return;

    el.setAttribute(POPOVER_COORDS_ATTR, "");
    place(el, win, x, y, margin, flip);

    if (el.hasAttribute("popover") && !el.matches(":popover-open")) el.showPopover();

    // Placed a second time in the same task: before showing, the popup is `display: none` and
    // measures zero, so neither the flip nor the clamp had a box to reason about.
    place(el, win, x, y, margin, flip);
    el.addEventListener("toggle", clearPlacementOnClose);
  };

  if (!options.afterPointerUp) {
    show();
    return releaseClear;
  }

  // The platform's light-dismiss pass runs on the `pointerup` that ends the opening right-click, so
  // a capture listener on the document shows the panel after that pass, within the same event.
  const doc = ownerDocument(el);
  doc.addEventListener("pointerup", show, { once: true, capture: true });

  const cancel = () => {
    doc.removeEventListener("pointerup", show, { capture: true });
    if (pendingArms.get(el) === cancel) pendingArms.delete(el);
  };
  pendingArms.set(el, cancel);
  return () => {
    cancel();
    releaseClear();
  };
}
