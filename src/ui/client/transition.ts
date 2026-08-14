import { applyStateAttrs, STATE_ATTRS } from "../contracts/state-attrs";
import { ownerDocument, ownerWindow } from "./dom";

/** Options for {@link mountTransitionState}. */
export interface TransitionStateOptions {
  /** Override the exit window in milliseconds; the default reads the element's own computed timing. */
  exitDurationMs?: number;
}

function timeToMs(value: string): number {
  const trimmed = value.trim();
  const numeric = Number.parseFloat(trimmed) || 0;
  return trimmed.endsWith("ms") ? numeric : numeric * 1000;
}

/** A shorthand timing list can be shorter than the property list it applies to, so a missing delay
 * falls back to the first. */
function longestPair(durations: string, delays: string): number {
  const durationList = durations.split(",");
  const delayList = delays.split(",");
  let longest = 0;
  for (let i = 0; i < durationList.length; i += 1) {
    const duration = timeToMs(durationList[i] ?? "0s");
    const delay = timeToMs(delayList[i] ?? delayList[0] ?? "0s");
    longest = Math.max(longest, duration + delay);
  }
  return longest;
}

/** How long the element says its own exit takes; read after `data-ending-style` is applied so rules
 * keyed on that attribute are included rather than measured as zero. */
function exitDuration(el: HTMLElement, win: Window): number {
  const style = win.getComputedStyle(el);
  return Math.max(longestPair(style.transitionDuration, style.transitionDelay), longestPair(style.animationDuration, style.animationDelay));
}

function isOpen(el: HTMLElement): boolean {
  if (el.hasAttribute("popover")) return el.matches(":popover-open");
  return (el as HTMLDialogElement).open === true;
}

/** Publishes `data-open`/`data-closed` and `data-starting-style`/`data-ending-style` for a native popover or `<dialog>`, returning a disposer. @public */
export function mountTransitionState(el: HTMLElement, options: TransitionStateOptions = {}): () => void {
  const win = ownerWindow(el);
  let enterFrame = 0;
  let exitTimer = 0;

  const clearPending = () => {
    win.cancelAnimationFrame(enterFrame);
    win.clearTimeout(exitTimer);
  };

  const enter = () => {
    clearPending();
    applyStateAttrs(el, { open: true, transition: "starting" });
    // Two frames: the first lets style recalculate with `data-starting-style` present, giving the
    // transition a "from" value. Clearing it in one frame can land in the same recalculation and
    // animate nothing.
    enterFrame = win.requestAnimationFrame(() => {
      enterFrame = win.requestAnimationFrame(() => {
        applyStateAttrs(el, { transition: null });
      });
    });
  };

  const exit = () => {
    clearPending();
    applyStateAttrs(el, { open: false, transition: "ending" });
    const duration = options.exitDurationMs ?? exitDuration(el, win);
    if (duration <= 0) {
      applyStateAttrs(el, { transition: null });
      return;
    }
    exitTimer = win.setTimeout(() => {
      applyStateAttrs(el, { transition: null });
    }, duration);
  };

  const onBeforeToggle = (event: Event) => {
    const newState = (event as Event & { newState?: string }).newState;
    if (newState === "open") enter();
    else if (newState === "closed") exit();
  };

  /** Backstop for elements that announce a state change without a `beforetoggle` — `<details>` fires
   * only `toggle`. Acting only on disagreement keeps this a reconciliation, not a second driver. */
  const onToggle = () => {
    const open = isOpen(el);
    if (el.hasAttribute(STATE_ATTRS.open) === open) return;
    if (open) enter();
    else exit();
  };

  /** `cancel` precedes `close`, and `exit` is idempotent, so being told twice costs a redundant
   * reconcile rather than a wrong state. */
  const onClose = () => exit();

  el.addEventListener("beforetoggle", onBeforeToggle);
  el.addEventListener("toggle", onToggle);
  el.addEventListener("close", onClose);
  el.addEventListener("cancel", onClose);

  // Sync to whatever the element already is: SSR can render `<dialog open>`, and a scope may resume
  // long after the first interaction opened it.
  applyStateAttrs(el, { open: isOpen(el) });

  return () => {
    clearPending();
    el.removeEventListener("beforetoggle", onBeforeToggle);
    el.removeEventListener("toggle", onToggle);
    el.removeEventListener("close", onClose);
    el.removeEventListener("cancel", onClose);
  };
}

/** The commands that *open* a popup — `Menu.Item` and `Dialog.Close` also name their popup in
 * `commandfor`, so `commandfor` alone is not evidence of a trigger. */
const OPENING_COMMANDS = new Set(["toggle-popover", "show-popover", "show-modal"]);

/** The invokers that open `popup`, resolved live and document-scoped exactly as `commandfor` is. */
export function triggersFor(popup: HTMLElement): HTMLElement[] {
  const id = popup.id;
  if (!id) return [];
  const found = ownerDocument(popup).querySelectorAll<HTMLElement>(`[commandfor="${CSS.escape(id)}"]`);
  return [...found].filter((el) => OPENING_COMMANDS.has(el.getAttribute("command") ?? ""));
}

/** Publishes `data-popup-open` on the triggers of a native popup, and returns a disposer. @public */
export function mountPopupTriggerState(popup: HTMLElement): () => void {
  const publish = (open: boolean) => {
    for (const trigger of triggersFor(popup)) applyStateAttrs(trigger, { popupOpen: open });
  };

  const onBeforeToggle = (event: Event) => {
    const newState = (event as Event & { newState?: string }).newState;
    if (newState === "open" || newState === "closed") publish(newState === "open");
  };

  // Backstop for elements that change state without a `beforetoggle`, and for `<dialog>`, whose
  // close arrives as `close` / `cancel`.
  const onStateChange = () => publish(isOpen(popup));

  popup.addEventListener("beforetoggle", onBeforeToggle);
  popup.addEventListener("toggle", onStateChange);
  popup.addEventListener("close", onStateChange);
  popup.addEventListener("cancel", onStateChange);

  publish(isOpen(popup));

  return () => {
    publish(false);
    popup.removeEventListener("beforetoggle", onBeforeToggle);
    popup.removeEventListener("toggle", onStateChange);
    popup.removeEventListener("close", onStateChange);
    popup.removeEventListener("cancel", onStateChange);
  };
}
