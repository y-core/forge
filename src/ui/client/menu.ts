import { MENU_ITEM_SELECTOR } from "../contracts/menu-contract";
import { mountRovingFocus } from "./composite";
import { activeElement, asElement, closestAcross, contains, elementById, isRtl, ownerDocument } from "./dom";
import { mountAnchorBinding } from "./popover-anchor";
import { mountPopupTriggerState, mountTransitionState } from "./transition";

/** Options for {@link mountMenu}. */
export interface MenuOptions {
  /** Wrap from the last item to the first. @default true */
  loop?: boolean;
}

/** The row that opens a nested panel, and the panel itself. Token-list matching (`~=`) because an
 * `asChild` composition can leave more than one slot name on the same element. */
const SUBMENU_TRIGGER_SELECTOR = '[data-slot~="menu-submenu-trigger"]';
const MENU_POPUP_SELECTOR = '[data-slot~="menu-popup"]';

/** Whether a menu popup is nested inside another one. */
function isNested(popup: HTMLElement): boolean {
  // Climbing from `parentNode` rather than the popup keeps `closest` from matching the popup itself,
  // and rather than `parentElement` because a slotted popup's parent can be a `ShadowRoot`.
  return closestAcross(popup.parentNode, MENU_POPUP_SELECTOR) != null;
}

/** Mounts a menu popup's keyboard behaviour, transition state and trigger state, returning a disposer. @public */
export function mountMenu(popup: HTMLElement, options: MenuOptions = {}): () => void {
  const disposeFocus = mountRovingFocus(popup, { items: MENU_ITEM_SELECTOR, orientation: "vertical", loop: options.loop ?? true, typeahead: true });
  const disposeTransition = mountTransitionState(popup);
  const disposeTriggers = mountPopupTriggerState(popup);
  const disposeAnchor = isNested(popup) ? mountAnchorBinding(popup) : () => {};

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
    // Only reclaim focus the close actually stranded: a click elsewhere has already put focus where
    // the user wants it.
    const active = activeElement(popup);
    if (active && active !== ownerDocument(popup).body && !contains(popup, active)) return;
    opener?.focus();
  };

  const onKeyDown = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    // `keydown` bubbles from an open submenu to the panel containing it; bailing on
    // `defaultPrevented` and calling `preventDefault` on every consumed key is what keeps both
    // controllers from acting on one press.
    if (keyEvent.defaultPrevented) return;
    if (keyEvent.ctrlKey || keyEvent.metaKey || keyEvent.altKey) return;
    const { key } = keyEvent;
    if (key !== "ArrowLeft" && key !== "ArrowRight") return;

    // Read behind the key test because `getComputedStyle` forces a style recalculation.
    const towardSubmenu = isRtl(popup) ? "ArrowLeft" : "ArrowRight";

    if (key === towardSubmenu) {
      const row = closestAcross<HTMLElement>(activeElement(popup), SUBMENU_TRIGGER_SELECTOR);
      if (!row || !contains(popup, row)) return;
      keyEvent.preventDefault();
      // The row's command is `toggle-popover`, so an already-open submenu must not be clicked again:
      // ARIA specifies this key as open-and-enter, never as close. Resolved from the row because an
      // id reference resolves in the tree that declares it, which may be a shadow root this parent
      // panel is not in.
      const target = elementById(row, row.getAttribute("commandfor") ?? "");
      if (target?.matches(":popover-open")) return;
      row.click();
      return;
    }

    if (!isNested(popup) || !popup.matches(":popover-open")) return;
    // The same path Escape takes: the platform hides the popup and `onToggle` restores focus.
    keyEvent.preventDefault();
    popup.hidePopover();
  };

  popup.addEventListener("beforetoggle", onBeforeToggle);
  popup.addEventListener("toggle", onToggle);
  popup.addEventListener("keydown", onKeyDown);

  return () => {
    popup.removeEventListener("beforetoggle", onBeforeToggle);
    popup.removeEventListener("toggle", onToggle);
    popup.removeEventListener("keydown", onKeyDown);
    disposeAnchor();
    disposeTriggers();
    disposeTransition();
    disposeFocus();
  };
}
