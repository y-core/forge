import { STATE_ATTRS } from "../contracts/state-attrs";
import { TOOLTIP_MOUNTED_ATTR } from "../contracts/toggle-contract";
import { ownerWindow } from "./dom";
import type { TooltipOptions } from "./types";

/** How long after the last tooltip closes the next one still opens at once. */
const WARM_MS = 300;

interface Warmth {
  open: Set<HTMLElement>;
  cooling: number;
  holder: HTMLElement | null;
}

/** Per realm, because the warm window is the reader's sweep across one page, and a frame is another page. */
const warmth = new WeakMap<Window, Warmth>();

function warmthOf(win: Window): Warmth {
  let state = warmth.get(win);
  if (!state) {
    state = { open: new Set(), cooling: 0, holder: null };
    warmth.set(win, state);
  }
  return state;
}

// A popover removed while showing is hidden without a `toggle`, so `open` alone can hold a tip that is gone.
function openTips(state: Warmth): Set<HTMLElement> {
  for (const tip of state.open) if (!tip.isConnected || !tip.matches(":popover-open")) state.open.delete(tip);
  return state.open;
}

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
      if (open) {
        content.showPopover?.();
        return;
      }
      // Cleared first, so a tip that opened instantly still fades out.
      content.removeAttribute(STATE_ATTRS.instant);
      content.hidePopover?.();
    }, delay);
  };

  const show = () => {
    const state = warmth.get(win);
    const warm = state !== undefined && (state.cooling !== 0 || [...openTips(state)].some((tip) => tip !== content));
    if (!warm) {
      schedule(true, showDelay);
      return;
    }
    content.setAttribute(STATE_ATTRS.instant, "");
    schedule(true, 0);
  };

  const onToggle = (event: Event) => {
    const state = warmthOf(win);
    if ((event as ToggleEvent).newState === "open") {
      state.open.add(content);
      return;
    }
    content.removeAttribute(STATE_ATTRS.instant);
    state.open.delete(content);
    if (openTips(state).size > 0) return;
    win.clearTimeout(state.cooling);
    state.holder = content;
    state.cooling = win.setTimeout(() => {
      state.cooling = 0;
      state.holder = null;
    }, WARM_MS);
  };
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
  content.addEventListener("toggle", onToggle, { signal });

  root.setAttribute(TOOLTIP_MOUNTED_ATTR, "");

  return () => {
    lifetime.abort();
    win.clearTimeout(timer);
    root.removeAttribute(TOOLTIP_MOUNTED_ATTR);
    const state = warmth.get(win);
    state?.open.delete(content);
    if (state?.holder === content) {
      win.clearTimeout(state.cooling);
      warmth.delete(win);
    }
  };
}
