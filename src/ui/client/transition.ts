import { applyStateAttrs, STATE_ATTRS } from "../contracts/state-attrs";
import { ownerDocument, ownerWindow } from "./dom";

/**
 * Transition-state protocol for forge's native popover and dialog.
 *
 * forge's `<Popover>` and `<Dialog>` are deliberately JavaScript-free: open/close, top-layer
 * stacking, light-dismiss, Esc and exclusive-open are all the platform's. What the platform does not
 * give is a *styling hook* for those states, so a consumer cannot write an enter or exit animation
 * at all.
 *
 * This controller **observes** the native state machine and publishes what it sees as the four
 * transition attributes from `ui/state-attrs.ts`. It is emphatically not a reimplementation:
 *
 * - it listens to `beforetoggle` / `toggle` (the Popover API's own state events) and `close` /
 *   `cancel` (the dialog's), and
 * - it **never** calls `showPopover`, `hidePopover` or `close()`. Forcing a state would fight the
 *   platform for ownership of dismissal, and the platform would win in ways that only show up with
 *   nested popovers and Esc.
 *
 * One controller, never per-component animation code: `core/popover.tsx` and `core/dialog.tsx` emit
 * their *initial* state attribute in SSR markup and contain no animation branch at all. A third
 * native-state component gets the whole behaviour by calling this.
 *
 * `mountPopupTriggerState` below is the same observation pointed the other way — same element, same
 * four events, but it writes `data-popup-open` on the *invokers* rather than on the popup. It lives
 * here because it is the identical protocol read from the other end, not because a trigger is a
 * transition.
 */

/** Options for {@link mountTransitionState}. */
export interface TransitionStateOptions {
  /**
   * Override the exit window in milliseconds. Omit it — the default reads the element's **own**
   * computed transition and animation timing, which is the only number that stays correct when a
   * consumer restyles the component, and every consumer restyles the component.
   */
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

/**
 * How long the element says its own exit takes. Read **after** `data-ending-style` is applied, so a
 * rule keyed on that attribute is included in the answer — which is the usual way an exit animation
 * is written, and would otherwise be measured as zero.
 */
function exitDuration(el: HTMLElement, win: Window): number {
  const style = win.getComputedStyle(el);
  return Math.max(longestPair(style.transitionDuration, style.transitionDelay), longestPair(style.animationDuration, style.animationDelay));
}

function isOpen(el: HTMLElement): boolean {
  if (el.hasAttribute("popover")) return el.matches(":popover-open");
  return (el as HTMLDialogElement).open === true;
}

/**
 * Publish `data-open` / `data-closed` and `data-starting-style` / `data-ending-style` for a native
 * popover or `<dialog>`, and return a disposer.
 *
 * ```ts
 * registerScope("panel", { setup: ({ root }) => mountTransitionState(root) });
 * ```
 *
 * `data-open` and `data-closed` are a mutually exclusive pair at every instant — they are written
 * through `applyStateAttrs`, which reconciles both names in one call, so there is no window in which
 * a selector could match neither or both.
 * @public
 */
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
    // Two frames: the first lets the browser recalculate style with `data-starting-style` present —
    // which is what gives a transition a "from" value to animate away from — and the second removes
    // it. Clearing it in one frame can land in the same style recalculation and animate nothing.
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

  /**
   * Backstop for the elements that announce a state change without a `beforetoggle` — `<details>`
   * fires only `toggle`. Acting only on disagreement keeps this a reconciliation rather than a
   * second driver, so a popover that already published from `beforetoggle` is left alone.
   */
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

/**
 * The commands that *open* a popup. A popup's `commandfor` is not by itself evidence of a trigger:
 * `Menu.Item` and `Dialog.Close` both name the popup they live in, and stamping "your popup is open"
 * on every row of an open menu would be worse than not stamping it at all.
 */
const OPENING_COMMANDS = new Set(["toggle-popover", "show-popover", "show-modal"]);

/** The invokers that open `popup`, resolved live. Document-scoped, exactly as `commandfor` is: a
 * trigger is very often **outside** the popup's subtree, and a subtree query would silently find
 * none of them. Re-read on every state change, so a trigger added or removed while the popup lives
 * is neither missed nor left stamped on a detached node.
 *
 * Exported for `popover-anchor.ts`, which needs the same "who opens this?" answer to anchor against.
 * Deliberately carries no public tag and stays out of the barrel: it is one query shared by two
 * controllers in this namespace, not a capability the package offers.
 *
 * Not a candidate for the shadow-safe id lookup the other controllers use: this is a *query* over a
 * selector, not a lookup of one id, so root-scoping it would need a `queryAllIn(node, selector)`
 * that does not exist. And *which* root to query is itself a design question rather than a detail —
 * a trigger and its popup can legitimately live in different ones. */
export function triggersFor(popup: HTMLElement): HTMLElement[] {
  const id = popup.id;
  if (!id) return [];
  const found = ownerDocument(popup).querySelectorAll<HTMLElement>(`[commandfor="${CSS.escape(id)}"]`);
  return [...found].filter((el) => OPENING_COMMANDS.has(el.getAttribute("command") ?? ""));
}

/**
 * Publish `data-popup-open` on the triggers of a native popup, and return a disposer.
 *
 * This is the *trigger's* state, which is why no amount of styling the popup can substitute for it:
 * "the button that opens this menu, while the menu is open" is a different element from the menu,
 * and CSS has no selector that walks from one to the other. A toolbar button that must stay lit
 * while its flyout is up is the case, and it is the one every app hits.
 *
 * Pairs with {@link mountTransitionState}: same element, same four events, opposite direction — that
 * one describes the popup, this one describes what points at it.
 *
 * ```ts
 * registerScope("popover", { eager: true, setup: ({ root }) => mountPopupTriggerState(root) });
 * ```
 * @public
 */
export function mountPopupTriggerState(popup: HTMLElement): () => void {
  const publish = (open: boolean) => {
    for (const trigger of triggersFor(popup)) applyStateAttrs(trigger, { popupOpen: open });
  };

  const onBeforeToggle = (event: Event) => {
    const newState = (event as Event & { newState?: string }).newState;
    if (newState === "open" || newState === "closed") publish(newState === "open");
  };

  // Backstop for the elements that change state without a `beforetoggle`, and for `<dialog>`, whose
  // close arrives as `close` / `cancel`. Reading the element rather than the event keeps all four
  // paths agreeing on one answer.
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
