import { ACTIVE_COMPOSITE_ITEM } from "../contracts/composite-contract";
import { activeElement, contains, eventTarget, isRtl, ownerWindow } from "./dom";

/**
 * Roving-focus controller — the shared keyboard behaviour every composite widget needs.
 *
 * A composite is a widget made of many focusable items that behaves as **one tab stop**: exactly one
 * item is reachable with Tab, and the arrow keys move focus among the rest. Without it a 52-button
 * toolbar is 52 tab stops, which is the difference between a usable keyboard interface and an
 * unusable one.
 *
 * Ported from Base UI's `internals/composite/`, but as **one function over a DOM subtree** rather
 * than a component tree: no contexts, no hooks, no ref merging, no list registry. Items are resolved
 * *live* from the DOM on every interaction, so a composite whose items are added, removed or
 * reordered needs no re-registration — which is exactly what an SSR-first library wants, because the
 * server already rendered the items and nothing on the client should have to re-declare them.
 */

const ARROW_UP = "ArrowUp";
const ARROW_DOWN = "ArrowDown";
const ARROW_LEFT = "ArrowLeft";
const ARROW_RIGHT = "ArrowRight";
const HOME = "Home";
const END = "End";

/** The keys a composite claims. Anything outside this set is left to the platform. */
const COMPOSITE_KEYS = new Set<string>([ARROW_UP, ARROW_DOWN, ARROW_LEFT, ARROW_RIGHT, HOME, END]);

// Declared in `contracts/`, because the components that *stamp* it render on the Worker and cannot
// import this module. Re-exported so `ui/client` still publishes it beside the controller that reads it.
export { ACTIVE_COMPOSITE_ITEM };

/** Options for {@link mountRovingFocus}. */
export interface RovingFocusOptions {
  /** Selector for the composite's items, resolved **live** against `root` on every interaction. */
  items: string;
  /** Which arrows navigate. `both` claims all four. @default "horizontal" */
  orientation?: "horizontal" | "vertical" | "both";
  /** Wrap from the last item to the first and back. @default true */
  loop?: boolean;
  /** Jump to an item by typing the start of its text. @default false */
  typeahead?: boolean;
  /** Idle time before the typeahead buffer resets. @default 500 */
  typeaheadTimeout?: number;
}

/** Both forms are checked: `disabled` removes an element from the tab order, while `aria-disabled`
 * keeps it focusable but inert — the right shape for a toolbar button that must stay discoverable. */
function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
}

/**
 * Whether a target is a real text field. The reason this exists, and the single most commonly missed
 * case in a composite: arrow keys inside a text field belong to the **caret**, not to the widget.
 *
 * `selectionStart` is the discriminator — it is a number for `text`/`search`/`url`/`tel`/`password`
 * and `null` for `checkbox`, `radio`, `range` and the rest, so a checkbox inside a toolbar still
 * navigates while a search box still moves its caret.
 */
function isNativeInput(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
  const node = el as HTMLElement | null;
  if (node?.nodeType !== 1) return false;
  if (node.tagName === "TEXTAREA") return true;
  return node.tagName === "INPUT" && (node as HTMLInputElement).selectionStart != null;
}

/**
 * Bring an item into view only when it is not already there.
 *
 * Base UI hand-rolls this out of `scrollLeft`/`clientWidth`/scroll-margin arithmetic because it also
 * honours scroll padding. The platform now expresses exactly this intent natively, and forge's
 * growth rules forbid duplicating a capability that already exists — so this is the native call with
 * the arguments that mean "nearest edge, no scrolling if already visible".
 */
function scrollIntoViewIfNeeded(item: HTMLElement): void {
  item.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

/**
 * Install roving focus on `root` and return a disposer.
 *
 * The disposer is a **contract, not a convenience**: `resume()` already returns a teardown that
 * removes every listener it installed, and a controller that cannot be disposed leaks a `keydown`
 * listener on every re-resume. Return this from a scope's `setup` and it is torn down with the rest.
 *
 * ```ts
 * registerScope("toolbar", {
 *   setup: ({ root }) => mountRovingFocus(root, { items: "[data-slot~='toolbar-item']" }),
 * });
 * ```
 * @public
 */
export function mountRovingFocus(root: HTMLElement, options: RovingFocusOptions): () => void {
  const { items: selector, orientation = "horizontal", loop = true, typeahead = false, typeaheadTimeout = 500 } = options;
  const win = ownerWindow(root) as Window & typeof globalThis;

  let buffer = "";
  let bufferTimer = 0;
  let lastFocusedIndex = -1;

  /**
   * The item ring, resolved live and **filtered to what is actually rendered**.
   *
   * The filter is what makes a composite nestable. A closed submenu's popup is still a descendant of
   * its parent popup, so an unfiltered query splices the child's items into the parent's ring —
   * arrow navigation then walks into a `display: none` subtree and focus goes nowhere. The same
   * predicate covers a `[data-filter]` item the navbar has hidden, which is the other way an item
   * can be in the DOM and not on screen.
   *
   * `checkVisibility()` is the platform's own answer to "would this render", covering `display`,
   * `visibility`, `content-visibility` and the `hidden` attribute together; `!== false` keeps the
   * ring intact on a node that has no such method.
   */
  const listItems = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => el.checkVisibility?.() !== false);

  function setTabStop(items: HTMLElement[], index: number): void {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item) item.tabIndex = i === index ? 0 : -1;
    }
  }

  function tabStopIndex(items: HTMLElement[]): number {
    return items.findIndex((item) => item.tabIndex === 0);
  }

  /** Shadow-safe, so a click on a `<span>` inside a button still identifies the item. */
  function indexOf(items: HTMLElement[], node: Node | null): number {
    return items.findIndex((item) => contains(item, node));
  }

  /** `-1` when every item in that direction is disabled — the guard that stops an all-disabled
   * group from spinning the wrap-and-skip loop forever. */
  function nextEnabled(items: HTMLElement[], from: number, step: number): number {
    for (let i = from; i >= 0 && i < items.length; i += step) {
      const item = items[i];
      if (item && !isDisabled(item)) return i;
    }
    return -1;
  }

  function firstEnabled(items: HTMLElement[]): number {
    return nextEnabled(items, 0, 1);
  }

  function lastEnabled(items: HTMLElement[]): number {
    return nextEnabled(items, items.length - 1, -1);
  }

  /** Returns `current` when there is nowhere to go, so the caller can tell "did not move" apart
   * from "moved". */
  function step(items: HTMLElement[], current: number, direction: 1 | -1): number {
    const candidate = nextEnabled(items, current + direction, direction);
    if (candidate !== -1) return candidate;
    if (!loop) return current;
    const wrapped = direction === 1 ? firstEnabled(items) : lastEnabled(items);
    return wrapped === -1 ? current : wrapped;
  }

  function focusItem(items: HTMLElement[], index: number): void {
    const item = items[index];
    if (!item) return;
    setTabStop(items, index);
    item.focus();
    scrollIntoViewIfNeeded(item);
  }

  /**
   * Should this key be handed back to a text field instead of navigating?
   *
   * The rule Base UI arrived at, and it is the right one: a caret that can still move inside the
   * field keeps the key. Only at the very edge of the text — and only with no selection and no Shift
   * — does the composite take over, so arrow-ing out of a filled search box feels like leaving it
   * rather than like the widget stealing the keystroke.
   */
  function belongsToTextField(target: EventTarget | null, key: string, shiftKey: boolean, forwardKey: string, backwardKey: string): boolean {
    if (!isNativeInput(target)) return false;
    if (isDisabled(target)) return false;
    const { selectionStart, selectionEnd, value } = target;
    if (selectionStart == null || shiftKey || selectionStart !== selectionEnd) return true;
    if (key !== backwardKey && selectionStart < value.length) return true;
    if (key !== forwardKey && selectionStart > 0) return true;
    return false;
  }

  function runTypeahead(items: HTMLElement[], key: string): boolean {
    win.clearTimeout(bufferTimer);
    buffer += key.toLowerCase();
    bufferTimer = win.setTimeout(() => {
      buffer = "";
    }, typeaheadTimeout);

    const current = tabStopIndex(items);
    // Search forward from the item after the current one and wrap, so repeatedly typing the same
    // first letter cycles through the items that share it rather than sticking on the first.
    for (let offset = 1; offset <= items.length; offset += 1) {
      const index = (Math.max(current, 0) + offset) % items.length;
      const item = items[index];
      if (!item || isDisabled(item)) continue;
      if ((item.textContent ?? "").trim().toLowerCase().startsWith(buffer)) {
        focusItem(items, index);
        return true;
      }
    }
    return false;
  }

  const onKeyDown = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    // A nested composite handled it first. `keydown` bubbles from an open submenu to the popup that
    // contains it, so without this both controllers move focus and both call `preventDefault` — the
    // inner one's move is immediately overwritten by the outer one's.
    if (keyEvent.defaultPrevented) return;
    const { key } = keyEvent;
    const items = listItems();
    if (items.length === 0) return;

    if (typeahead && key.length === 1 && key !== " " && !keyEvent.ctrlKey && !keyEvent.metaKey && !keyEvent.altKey) {
      if (isNativeInput(eventTarget(keyEvent))) return; // the field is being typed into
      if (runTypeahead(items, key)) keyEvent.preventDefault();
      return;
    }

    if (!COMPOSITE_KEYS.has(key)) return;
    if (keyEvent.ctrlKey || keyEvent.metaKey || keyEvent.altKey) return;

    // Direction can only change the meaning of a *horizontal* arrow in a composite that navigates
    // horizontally — every other key resolves to the same answer either way, so the `&&` chain keeps
    // `getComputedStyle`'s forced style recalculation off Up, Down, Home, End and every typeahead
    // character. Read per press rather than cached at mount, so a runtime `dir` flip takes effect.
    const rtl = orientation !== "vertical" && (key === ARROW_LEFT || key === ARROW_RIGHT) && isRtl(root);
    const horizontalForward = rtl ? ARROW_LEFT : ARROW_RIGHT;
    const horizontalBackward = rtl ? ARROW_RIGHT : ARROW_LEFT;
    const forwardKey = orientation === "vertical" ? ARROW_DOWN : horizontalForward;
    const backwardKey = orientation === "vertical" ? ARROW_UP : horizontalBackward;

    if (belongsToTextField(eventTarget(keyEvent), key, keyEvent.shiftKey, forwardKey, backwardKey)) return;

    const current = tabStopIndex(items);
    const isForward = (orientation !== "vertical" && key === horizontalForward) || (orientation !== "horizontal" && key === ARROW_DOWN);
    const isBackward = (orientation !== "vertical" && key === horizontalBackward) || (orientation !== "horizontal" && key === ARROW_UP);

    let next = current;
    if (key === HOME) next = firstEnabled(items);
    else if (key === END) next = lastEnabled(items);
    else if (isForward) next = step(items, Math.max(current, 0), 1);
    else if (isBackward) next = step(items, current === -1 ? items.length : current, -1);
    else return; // a composite key this orientation does not claim — e.g. ArrowUp on a horizontal group

    if (next === -1 || next === current) {
      // Still consume the key when it was ours to consume: a horizontal toolbar at its last item
      // with `loop: false` must not scroll the page instead.
      keyEvent.preventDefault();
      return;
    }
    keyEvent.preventDefault();
    focusItem(items, next);
  };

  function initialIndex(items: HTMLElement[]): number {
    const marked = items.findIndex((item) => item.hasAttribute(ACTIVE_COMPOSITE_ITEM));
    const markedItem = items[marked];
    if (markedItem && !isDisabled(markedItem)) return marked;
    const enabled = firstEnabled(items);
    return enabled === -1 ? 0 : enabled;
  }

  /** Clicking or tabbing to an item makes it the tab stop, so returning to the widget later returns
   * the user to where they left off — not to the first item. */
  const onFocusIn = (event: Event) => {
    const items = listItems();
    const index = indexOf(items, eventTarget(event) as Node | null);
    if (index === -1) return;
    setTabStop(items, index);
    lastFocusedIndex = index;
  };

  /**
   * Focus restoration. Removing the focused item drops focus on `<body>`, which strands a keyboard
   * user at the top of the page with no way back into the widget. Put focus on whichever item took
   * the removed one's place, falling back to the first enabled one.
   */
  const observer = new win.MutationObserver(() => {
    const items = listItems();
    if (items.length === 0) return;
    if (tabStopIndex(items) === -1) setTabStop(items, initialIndex(items));

    const focused = activeElement(root);
    if (focused && contains(root, focused)) return; // focus never left
    if (lastFocusedIndex === -1) return;

    const target = Math.min(lastFocusedIndex, items.length - 1);
    const back = nextEnabled(items, target, -1);
    const restore = back === -1 ? firstEnabled(items) : back;
    if (restore !== -1) focusItem(items, restore);
  });

  const initial = listItems();
  if (initial.length > 0) setTabStop(initial, initialIndex(initial));

  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("focusin", onFocusIn);
  observer.observe(root, { childList: true, subtree: true });

  return () => {
    root.removeEventListener("keydown", onKeyDown);
    root.removeEventListener("focusin", onFocusIn);
    observer.disconnect();
    win.clearTimeout(bufferTimer);
  };
}
