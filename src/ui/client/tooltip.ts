import { elementById, ownerDocument, ownerWindow } from "./dom";
import { mountTransitionState } from "./transition";

export interface TooltipOptions {
  /** @default 400 */
  showDelayMs?: number;
  /** @default 100 */
  hideDelayMs?: number;
}

/** Mounts a tooltip's delayed show/hide behaviour and returns a disposer. @public */
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

  // Filtered to `:focus-visible` so a mouse click on the trigger does not raise the tooltip, while
  // keyboard focus still does.
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
