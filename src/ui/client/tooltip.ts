import { TOOLTIP_MOUNTED_ATTR } from "../contracts/toggle-contract";
import { ownerWindow } from "./dom";
import type { TooltipOptions } from "./types";

/** Mounts a tooltip's delayed show/hide behaviour and returns a disposer. */
export function mountTooltip(root: HTMLElement, options: TooltipOptions = {}): () => void {
  const trigger = root.querySelector<HTMLElement>("[data-slot~='tooltip-trigger']");
  const content = root.querySelector<HTMLElement>("[data-slot~='tooltip-content']");
  if (!trigger || !content) return () => {};

  const win = ownerWindow(root);
  const showDelay = options.showDelayMs ?? 400;
  const hideDelay = options.hideDelayMs ?? 100;
  let timer = 0;

  const schedule = (open: boolean, delay: number) => {
    win.clearTimeout(timer);
    timer = win.setTimeout(() => {
      if (open) content.showPopover?.();
      else content.hidePopover?.();
    }, delay);
  };

  const show = () => schedule(true, showDelay);
  const hide = () => schedule(false, hideDelay);

  // WCAG 2.1 SC 1.4.13 (Hoverable): the pointer must be able to travel onto the tooltip without
  // dismissing it, so entering the content cancels the hide armed by leaving the trigger.
  const onPointerEnter = () => show();

  // A tap fires `pointerleave` the moment the finger lifts, which would close the tooltip in the
  // same gesture that opened it. Touch dismissal is the platform's: `popover="hint"` light-dismisses.
  const onPointerLeave = (event: Event) => {
    if ((event as PointerEvent).pointerType === "touch") return;
    hide();
  };

  const onPointerDown = (event: Event) => {
    if ((event as PointerEvent).pointerType !== "touch") return;
    schedule(true, 0);
  };

  const onFocus = () => {
    if (trigger.matches(":focus-visible")) show();
  };

  const lifetime = new AbortController();
  const { signal } = lifetime;
  trigger.addEventListener("pointerenter", onPointerEnter, { signal });
  trigger.addEventListener("pointerleave", onPointerLeave, { signal });
  trigger.addEventListener("pointerdown", onPointerDown, { signal });
  trigger.addEventListener("focusin", onFocus, { signal });
  trigger.addEventListener("focusout", hide, { signal });
  content.addEventListener("pointerenter", onPointerEnter, { signal });
  content.addEventListener("pointerleave", onPointerLeave, { signal });

  root.setAttribute(TOOLTIP_MOUNTED_ATTR, "");

  return () => {
    lifetime.abort();
    win.clearTimeout(timer);
    root.removeAttribute(TOOLTIP_MOUNTED_ATTR);
  };
}
