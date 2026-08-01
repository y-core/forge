import { MENU_ITEM_SELECTOR } from "../contracts/menu-contract";
import { mountRovingFocus } from "./composite";
import { activeElement, asElement, contains, ownerDocument } from "./dom";
import { mountPopupTriggerState, mountTransitionState } from "./transition";

/**
 * Menu keyboard behaviour — the only part of a menu the platform does not already provide.
 *
 * Opening, closing, light-dismiss, Escape and top-layer stacking belong to the Popover API, and
 * selecting an item closes the menu through `command="hide-popover"` in the markup. Nothing here
 * opens or closes anything. What is left is what ARIA's menu pattern asks for and the platform does
 * not: arrow navigation over the items, typeahead, focus on the first item when the menu opens, and
 * focus back on the trigger when it closes.
 *
 * Items are resolved live from the popup on every interaction (`mountRovingFocus` does this by
 * construction), so a menu whose rows are rebuilt between openings — a context menu driven by
 * synchronous callbacks, say — works without re-mounting.
 */

/** Options for {@link mountMenu}. */
export interface MenuOptions {
  /** Wrap from the last item to the first. @default true */
  loop?: boolean;
}

/**
 * Mount a menu popup's keyboard behaviour, transition state and trigger state, returning a
 * disposer.
 * @public
 */
export function mountMenu(popup: HTMLElement, options: MenuOptions = {}): () => void {
  const disposeFocus = mountRovingFocus(popup, { items: MENU_ITEM_SELECTOR, orientation: "vertical", loop: options.loop ?? true, typeahead: true });
  const disposeTransition = mountTransitionState(popup);
  const disposeTriggers = mountPopupTriggerState(popup);

  /** Where focus was when the menu opened. Captured rather than derived from `commandfor`, because a
   * menu can be opened by any invoker — a context menu has no single trigger button. */
  let opener: HTMLElement | null = null;

  const onBeforeToggle = (event: Event) => {
    if ((event as Event & { newState?: string }).newState !== "open") return;
    opener = asElement(activeElement(popup));
  };

  const onToggle = (event: Event) => {
    const newState = (event as Event & { newState?: string }).newState;
    if (newState === "open") {
      popup.querySelector<HTMLElement>(MENU_ITEM_SELECTOR)?.focus();
      return;
    }
    // Only reclaim focus that the close actually stranded: a click elsewhere on the page has already
    // put focus where the user wants it, and yanking it back to the trigger would be worse than the
    // problem being fixed.
    const active = activeElement(popup);
    if (active && active !== ownerDocument(popup).body && !contains(popup, active)) return;
    opener?.focus();
  };

  popup.addEventListener("beforetoggle", onBeforeToggle);
  popup.addEventListener("toggle", onToggle);

  return () => {
    popup.removeEventListener("beforetoggle", onBeforeToggle);
    popup.removeEventListener("toggle", onToggle);
    disposeTriggers();
    disposeTransition();
    disposeFocus();
  };
}
