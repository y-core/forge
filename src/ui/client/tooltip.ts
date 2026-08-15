import { TOOLTIP_MOUNTED_ATTR } from "../contracts/toggle-contract";
import { elementById, ownerWindow } from "./dom";

export interface TooltipOptions {
  /** @default 400 */
  showDelayMs?: number;
  /** @default 100 */
  hideDelayMs?: number;
}

/** Mounts a tooltip's delayed show/hide behaviour and returns a disposer. */
export function mountTooltip(root: HTMLElement, options: TooltipOptions = {}): () => void {
  const trigger = root.querySelector<HTMLElement>("[data-slot~='tooltip-trigger']");
  const content = trigger ? elementById(trigger, trigger.getAttribute("aria-describedby") ?? "") : null;
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
  // dismissing it, or long and selectable content is unreachable. `schedule` clears the pending
  // timer, so the hide armed by leaving the trigger is cancelled by entering the content.
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

  // Filtered to `:focus-visible` so a mouse click on the trigger does not raise the tooltip, while
  // keyboard focus still does.
  const onFocus = () => {
    if (trigger.matches(":focus-visible")) show();
  };

  trigger.addEventListener("pointerenter", onPointerEnter);
  trigger.addEventListener("pointerleave", onPointerLeave);
  trigger.addEventListener("pointerdown", onPointerDown);
  trigger.addEventListener("focusin", onFocus);
  trigger.addEventListener("focusout", hide);
  content.addEventListener("pointerenter", onPointerEnter);
  content.addEventListener("pointerleave", onPointerLeave);

  // Retires the CSS-only fallback, which exists for the no-script case and would otherwise show the
  // tooltip instantly on hover, defeating the deliberate show delay.
  root.setAttribute(TOOLTIP_MOUNTED_ATTR, "");

  return () => {
    win.clearTimeout(timer);
    root.removeAttribute(TOOLTIP_MOUNTED_ATTR);
    trigger.removeEventListener("pointerenter", onPointerEnter);
    trigger.removeEventListener("pointerleave", onPointerLeave);
    trigger.removeEventListener("pointerdown", onPointerDown);
    trigger.removeEventListener("focusin", onFocus);
    trigger.removeEventListener("focusout", hide);
    content.removeEventListener("pointerenter", onPointerEnter);
    content.removeEventListener("pointerleave", onPointerLeave);
  };
}
