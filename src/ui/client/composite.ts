import { ACTIVE_COMPOSITE_ITEM } from "../contracts/composite-contract";
import { activeElement, contains, eventTarget, isRtl, ownerWindow } from "./dom";
import type { RovingFocusOptions } from "./types";

const ARROW_UP = "ArrowUp";
const ARROW_DOWN = "ArrowDown";
const ARROW_LEFT = "ArrowLeft";
const ARROW_RIGHT = "ArrowRight";
const HOME = "Home";
const END = "End";

/** The keys a composite claims. Anything outside this set is left to the platform. */
const COMPOSITE_KEYS = new Set<string>([ARROW_UP, ARROW_DOWN, ARROW_LEFT, ARROW_RIGHT, HOME, END]);

/** The index reported when the ring has no current item. */
const NO_CURRENT = -1;

const mountedComposites = new WeakMap<HTMLElement, () => void>();

/** Whether an item is inert — disabled by either `disabled` or `aria-disabled`. @internal */
export function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
}

/** Whether an item is out of the navigation ring entirely, which only the native `disabled` is. @internal */
export function leavesRing(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true;
}

// Which types leave the arrows to the ring, not which edit text: `range` is absent because it uses
// its own arrows, and `color` is present because it edits no text and has no use for them either.
/** The input types whose arrow keys belong to the composite rather than to the field. */
const NAVIGABLE_INPUT_TYPES = new Set(["checkbox", "radio", "button", "submit", "reset", "image", "file", "hidden", "color"]);

/** Whether a target is a real text field, whose own keys own the arrows. @internal */
export function isNativeInput(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
  const node = el as HTMLElement | null;
  if (node?.nodeType !== 1) return false;
  if (node.tagName === "TEXTAREA") return true;
  if (node.tagName !== "INPUT") return false;
  // The property, not the attribute: it normalises case and answers `"text"` for both an omitted
  // `type` and an unknown one, which is what the element actually renders as.
  return !NAVIGABLE_INPUT_TYPES.has((node as HTMLInputElement).type);
}

// Wider than `isNativeInput` and deliberately kept apart from it: `belongsToTextField` reads
// `selectionStart` and `value`, which a `<select>` and an edited region do not have.
/** Whether a target spends printable keys itself — a text field, a `<select>`'s own typeahead, an edited region. */
function consumesText(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (node?.nodeType !== 1) return false;
  return isNativeInput(node) || node.tagName === "SELECT" || node.isContentEditable;
}

/** Brings an item into view only when it is not already there. */
function scrollIntoViewIfNeeded(item: HTMLElement): void {
  item.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

/** Makes a composite's items one tab stop with arrow-key navigation and returns a disposer; idempotent per root. @public */
export function mountRovingFocus(root: HTMLElement, options: RovingFocusOptions): () => void {
  const existing = mountedComposites.get(root);
  if (existing) return existing;

  const { items: selector, orientation = "horizontal", loop = true, typeahead = false, typeaheadTimeout = 500 } = options;
  const win = ownerWindow(root) as Window & typeof globalThis;

  let buffer = "";
  let bufferTimer = 0;
  let lastFocusedIndex = -1;
  let lastFocusedItem: HTMLElement | null = null;
  let ringWritten = false;

  // The visibility filter is what makes a composite nestable: a closed submenu's popup is still a
  // descendant, and an unfiltered query would splice its items into the parent's ring.
  const listItems = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => el.checkVisibility?.() !== false);

  function setTabStop(items: HTMLElement[], index: number): void {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item) item.tabIndex = i === index ? 0 : -1;
    }
  }

  // The attribute and not the `tabIndex` property, which a native button reports as 0 without this
  // controller having written it — an item inserted after mount would pass as the standing stop.
  function tabStopIndex(items: HTMLElement[]): number {
    return items.findIndex((item) => item.getAttribute("tabindex") === "0");
  }

  /** Shadow-safe, so a click on a `<span>` inside a button still identifies the item. */
  function indexOf(items: HTMLElement[], node: Node | null): number {
    return items.findIndex((item) => contains(item, node));
  }

  /** The next item in the ring in `stride`'s direction, or `-1` when every one of them has left it. */
  function nextEnabled(items: HTMLElement[], from: number, stride: number): number {
    for (let i = from; i >= 0 && i < items.length; i += stride) {
      const item = items[i];
      if (item && !leavesRing(item)) return i;
    }
    return -1;
  }

  function firstEnabled(items: HTMLElement[]): number {
    return nextEnabled(items, 0, 1);
  }

  function lastEnabled(items: HTMLElement[]): number {
    return nextEnabled(items, items.length - 1, -1);
  }

  /** The index one step in `direction`, or `current` when there is nowhere to go. */
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

  /** Whether the key belongs to a text field's caret rather than to the composite. */
  // `aria-disabled` is not `readonly`: the caret in such a field still moves under the platform, so
  // claiming its arrows would fight what the reader sees happen.
  function belongsToTextField(target: EventTarget | null, key: string, shiftKey: boolean, forwardKey: string, backwardKey: string): boolean {
    if (!isNativeInput(target)) return false;
    const { selectionStart, selectionEnd, value } = target;
    // A type with no selection API — `email`, `number`, every date type — edits text all the same, and
    // its own keys are the platform's to interpret.
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
      if (!item || leavesRing(item)) continue;
      if ((item.textContent ?? "").trim().toLowerCase().startsWith(buffer)) {
        focusItem(items, index);
        return true;
      }
    }
    return false;
  }

  const onKeyDown = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    // `keydown` bubbles from an open submenu to the popup containing it; without this bail both
    // controllers move focus and the inner one's move is overwritten by the outer one's.
    if (keyEvent.defaultPrevented) return;
    const { key } = keyEvent;
    const modified = keyEvent.ctrlKey || keyEvent.metaKey || keyEvent.altKey;

    // `listItems()` is a `querySelectorAll` plus a `checkVisibility()` per hit, each forcing style
    // resolution — so it is deferred past every gate that can reject a key without seeing the ring.
    if (typeahead && key.length === 1 && key !== " " && !modified) {
      if (consumesText(eventTarget(keyEvent))) return;
      const typeaheadItems = listItems();
      if (typeaheadItems.length === 0) return;
      runTypeahead(typeaheadItems, key);
      // Consumed whether or not it matched: a key the innermost ring could not place still belongs to
      // it, and letting it bubble lets an enclosing composite move focus out of the open panel.
      keyEvent.preventDefault();
      return;
    }

    if (!COMPOSITE_KEYS.has(key)) return;
    if (modified) return;

    const items = listItems();
    if (items.length === 0) return;

    // The `&&` chain keeps `getComputedStyle`'s forced style recalculation off every key whose
    // meaning direction cannot change.
    const rtl = orientation !== "vertical" && (key === ARROW_LEFT || key === ARROW_RIGHT) && isRtl(root);
    const horizontalForward = rtl ? ARROW_LEFT : ARROW_RIGHT;
    const horizontalBackward = rtl ? ARROW_RIGHT : ARROW_LEFT;
    const forwardKey = orientation === "vertical" ? ARROW_DOWN : horizontalForward;
    const backwardKey = orientation === "vertical" ? ARROW_UP : horizontalBackward;

    if (belongsToTextField(eventTarget(keyEvent), key, keyEvent.shiftKey, forwardKey, backwardKey)) return;

    const current = tabStopIndex(items);
    const isForward = (orientation !== "vertical" && key === horizontalForward) || (orientation !== "horizontal" && key === ARROW_DOWN);
    const isBackward = (orientation !== "vertical" && key === horizontalBackward) || (orientation !== "horizontal" && key === ARROW_UP);

    const noCurrentItem = current === NO_CURRENT;
    const forwardOrigin = noCurrentItem ? 0 : current;
    const backwardOrigin = noCurrentItem ? items.length : current;

    let next = current;
    if (key === HOME) next = firstEnabled(items);
    else if (key === END) next = lastEnabled(items);
    else if (isForward) next = step(items, forwardOrigin, 1);
    else if (isBackward) next = step(items, backwardOrigin, -1);
    else return;

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
    if (markedItem && !leavesRing(markedItem)) return marked;
    const enabled = firstEnabled(items);
    return enabled === -1 ? 0 : enabled;
  }

  const onFocusIn = (event: Event) => {
    const items = listItems();
    const index = indexOf(items, eventTarget(event) as Node | null);
    if (index === -1) return;
    setTabStop(items, index);
    lastFocusedIndex = index;
    lastFocusedItem = items[index] ?? null;
  };

  // A null `relatedTarget` is focus going nowhere — the stranding the observer below repairs — so
  // only a move to a real element elsewhere forgets where the user was.
  const onFocusOut = (event: Event) => {
    const next = (event as FocusEvent).relatedTarget as Node | null;
    if (!next || contains(root, next)) return;
    lastFocusedIndex = -1;
    lastFocusedItem = null;
  };

  // Not "focus is on `<body>`", which is also where a click on blank page background leaves it — the
  // restore exists for the item that went away under a user who was still on it.
  /** Whether the item focus was last on was taken out of the document. */
  function focusStranded(): boolean {
    return lastFocusedItem !== null && !lastFocusedItem.isConnected;
  }

  /** Whether a mutated node is, or holds, something the ring would navigate. */
  function holdsItem(node: Node): boolean {
    if (node.nodeType !== 1) return false;
    const el = node as Element;
    return el.matches(selector) || el.querySelector(selector) !== null;
  }

  /** Whether a batch could have changed the ring's membership — a text swap in a badge could not. */
  function touchesRing(records: MutationRecord[]): boolean {
    for (const record of records) {
      if (record.type === "attributes") return true;
      for (const node of record.addedNodes) if (holdsItem(node)) return true;
      for (const node of record.removedNodes) if (holdsItem(node)) return true;
    }
    return false;
  }

  /** Writes the ring's one stop: the item already holding it, or the one the widget designates. */
  // A stop counts as standing only once this controller has written one. The attribute cannot carry
  // that on its own — forge renders `tabindex="0"` on an inert anchor, which is no entry point.
  function normaliseRing(items: HTMLElement[]): void {
    const standing = ringWritten ? tabStopIndex(items) : NO_CURRENT;
    setTabStop(items, standing === NO_CURRENT ? initialIndex(items) : standing);
    ringWritten = true;
  }

  /** Normalises the ring as it stands now, reporting false when there is nothing visible to write over yet. */
  function normaliseVisibleRing(): boolean {
    const items = listItems();
    if (items.length === 0) return false;
    normaliseRing(items);
    return true;
  }

  // Removing the focused item drops focus on `<body>`, stranding a keyboard user outside the widget;
  // this puts focus on whichever item took the removed one's place.
  const hasObserver = typeof win.MutationObserver === "function";
  if (!hasObserver) {
    console.warn("[composite] MutationObserver is unavailable in this realm; focus will not be restored when the focused item is removed");
  }
  const observer = hasObserver
    ? new win.MutationObserver((records) => {
        // The membership test first, because the pass below costs a `checkVisibility()` per item and
        // most of what a `{subtree: true}` observer delivers never reaches the ring at all.
        if (!touchesRing(records)) return;
        const focused = activeElement(root);
        const inside = focused !== null && contains(root, focused);

        // Over the whole current list, because an item that arrived or was revealed since the last
        // pass carries its own tab stop and only rewriting every item takes the ring back to one.
        const items = listItems();
        if (items.length === 0) return;
        normaliseRing(items);

        if (inside) return;
        if (lastFocusedIndex === -1) return;
        if (!focusStranded()) return;

        const target = Math.min(lastFocusedIndex, items.length - 1);
        const back = nextEnabled(items, target, -1);
        const restore = back === -1 ? firstEnabled(items) : back;
        if (restore !== -1) focusItem(items, restore);
      })
    : null;

  // What is revealed from *above* the root — a collapsed `<details>`, a class on an ancestor — mutates
  // nothing the MutationObserver below watches, and intersection is the one signal that survives that.
  const revealCtor = (win as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  let reveal: IntersectionObserver | null = null;
  if (!normaliseVisibleRing()) {
    if (typeof revealCtor !== "function") {
      console.warn(
        "[composite] IntersectionObserver is unavailable in this realm; a composite with no visible items at mount gets its tab stop on first focus",
      );
    } else {
      // An intersection change on a composite that has since been normalised is an ordinary scroll, so
      // this goes through `normaliseRing` like every other path and leaves a standing stop where it is.
      reveal = new revealCtor(() => {
        if (normaliseVisibleRing()) {
          reveal?.disconnect();
          reveal = null;
        }
      });
      reveal.observe(root);
    }
  }

  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  // `hidden` as well as `childList`: revealing an item admits it to the ring exactly as inserting one
  // does, and a root hidden at mount had no items to write a stop over until it is shown.
  observer?.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });

  const dispose = () => {
    mountedComposites.delete(root);
    root.removeEventListener("keydown", onKeyDown);
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("focusout", onFocusOut);
    observer?.disconnect();
    reveal?.disconnect();
    win.clearTimeout(bufferTimer);
  };
  mountedComposites.set(root, dispose);
  return dispose;
}
