import { elementById, ownerDocument, ownerWindow } from "./dom";
import { mountTransitionState } from "./transition";

/**
 * Tooltip show/hide behaviour.
 *
 * This controller does call `showPopover` / `hidePopover`, and that is the difference between it and
 * A5's transition controller: a `popover="manual"` has no built-in trigger, and hover-with-delay is
 * not a platform behaviour at all. What it still does not do is invent positioning or dismissal
 * semantics — placement is static CSS anchored to the invoker, as everywhere else in forge.
 *
 * The delays are asymmetric on purpose: a longer show delay stops tooltips flashing as the pointer
 * crosses a toolbar, while a short hide delay lets the pointer travel from trigger to tooltip
 * without it vanishing underneath.
 */

export interface TooltipOptions {
  /** @default 400 */
  showDelayMs?: number;
  /** @default 100 */
  hideDelayMs?: number;
}

export function mountTooltip(root: HTMLElement, options: TooltipOptions = {}): () => void {
  const trigger = root.querySelector<HTMLElement>("[data-slot~='tooltip-trigger']");
  const content = trigger ? elementById(trigger, trigger.getAttribute("aria-describedby") ?? "") : null;
  if (!trigger || !content) return () => {};

  const win = ownerWindow(root);
  const showDelay = options.showDelayMs ?? 400;
  const hideDelay = options.hideDelayMs ?? 100;
  const disposeTransition = mountTransitionState(content);
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

  // `focusin`, filtered to keyboard focus: a tooltip that appears on every mouse click of its own
  // trigger is noise, but one unreachable from the keyboard is a defect.
  const onFocus = () => {
    if (trigger.matches(":focus-visible")) show();
  };

  const onKeyDown = (event: Event) => {
    if ((event as KeyboardEvent).key !== "Escape") return;
    win.clearTimeout(timer);
    content.hidePopover?.();
  };

  trigger.addEventListener("pointerenter", show);
  trigger.addEventListener("pointerleave", hide);
  trigger.addEventListener("focusin", onFocus);
  trigger.addEventListener("focusout", hide);
  ownerDocument(root).addEventListener("keydown", onKeyDown);

  return () => {
    win.clearTimeout(timer);
    trigger.removeEventListener("pointerenter", show);
    trigger.removeEventListener("pointerleave", hide);
    trigger.removeEventListener("focusin", onFocus);
    trigger.removeEventListener("focusout", hide);
    ownerDocument(root).removeEventListener("keydown", onKeyDown);
    disposeTransition();
  };
}
