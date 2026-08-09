import { MENU_ITEM_SELECTOR } from "../contracts/menu-contract";
import { mountRovingFocus } from "./composite";
import { activeElement, asElement, closestAcross, contains, elementById, isRtl, ownerDocument } from "./dom";
import { mountAnchorBinding } from "./popover-anchor";
import { mountPopupTriggerState, mountTransitionState } from "./transition";

/**
 * Menu keyboard behaviour — the part of a menu the platform does not already provide.
 *
 * Opening, closing, light-dismiss, Escape and top-layer stacking belong to the Popover API, and
 * selecting an item closes the menu through `command="hide-popover"` in the markup. What is left is
 * what ARIA's menu pattern asks for and the platform does not: arrow navigation over the items,
 * typeahead, focus on the first item when the menu opens, focus back on the trigger when it closes,
 * and the two **horizontal** arrows that move between a panel and its submenu.
 *
 * Which physical arrow means which is resolved from the popup's own writing direction, because ARIA's
 * menu pattern specifies these two as mirrored in RTL — the key pointing *at* the submenu opens it and
 * the key pointing away closes it, in both directions.
 *
 * Those two are the only place this opens or closes anything, and they do it through the platform
 * rather than around it — the opening key clicks the submenu trigger, whose own `command` is what
 * opens the popup, and the closing key calls `hidePopover()` on the nested panel exactly as Escape
 * would. Every other state change is still the platform's alone.
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

/** The row that opens a nested panel, and the panel itself. Token-list matching (`~=`) because an
 * `asChild` composition can leave more than one slot name on the same element. */
const SUBMENU_TRIGGER_SELECTOR = '[data-slot~="menu-submenu-trigger"]';
const MENU_POPUP_SELECTOR = '[data-slot~="menu-popup"]';

/** A menu popup nested inside another one — the submenu case, and the only one whose trigger is not
 * a fixed part of its compound. */
function isNested(popup: HTMLElement): boolean {
  // Two details carry this. The climb starts at the **parent**, because `closest` matches the element
  // it starts from and starting at the popup would report every menu as nested. And it starts from
  // `parentNode`, not `parentElement`, because a slotted popup's parent can be a `ShadowRoot` — which
  // `parentElement` reports as `null`, losing the boundary `closestAcross` exists to cross.
  return closestAcross(popup.parentNode, MENU_POPUP_SELECTOR) != null;
}

/**
 * Mount a menu popup's keyboard behaviour, transition state and trigger state, returning a
 * disposer.
 *
 * In RTL the keys and the placement now agree: a logical `side` resolves against the element's own
 * directionality in CSS, so the submenu opens on the edge the arrow keys move toward.
 * @public
 */
export function mountMenu(popup: HTMLElement, options: MenuOptions = {}): () => void {
  const disposeFocus = mountRovingFocus(popup, { items: MENU_ITEM_SELECTOR, orientation: "vertical", loop: options.loop ?? true, typeahead: true });
  const disposeTransition = mountTransitionState(popup);
  const disposeTriggers = mountPopupTriggerState(popup);
  // Only the nested case. After the stylesheet's panel-level binding every other menu is already
  // anchored correctly without JavaScript, and binding them anyway would put an inline write on
  // elements that do not need one — so this stays revertible without regressing anything.
  const disposeAnchor = isNested(popup) ? mountAnchorBinding(popup) : () => {};

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

  /**
   * The two horizontal arrows ARIA's menu pattern asks for, which `mountRovingFocus` deliberately
   * leaves unclaimed: under `orientation: "vertical"` it consumes Up, Down, Home and End and returns
   * without touching either horizontal key, so there is no contention to resolve here.
   *
   * Both guards are load-bearing. `defaultPrevented` is the nested-composite rule — `keydown` bubbles
   * from an open submenu to the panel containing it, and without the bail both controllers act on one
   * press. `preventDefault` on every key consumed is the other half of that same contract: it is what
   * tells the parent's handler the key was already claimed.
   */
  const onKeyDown = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.defaultPrevented) return;
    if (keyEvent.ctrlKey || keyEvent.metaKey || keyEvent.altKey) return;
    const { key } = keyEvent;
    if (key !== "ArrowLeft" && key !== "ArrowRight") return;

    // One direction read, resolved from the popup itself so an RTL subtree inside an LTR page mirrors
    // and a runtime `dir` flip is picked up on the next press. Behind the key test, because
    // `getComputedStyle` forces a style recalculation and no other key can consume the answer.
    const towardSubmenu = isRtl(popup) ? "ArrowLeft" : "ArrowRight";

    if (key === towardSubmenu) {
      // Climb from the deep active element rather than matching it directly: the row's own content —
      // the label span, the chevron — can be what focus reports on some paths. `closestAcross`
      // rather than `closest` for the same shadow-boundary reason the rest of this namespace uses it.
      const row = closestAcross<HTMLElement>(activeElement(popup), SUBMENU_TRIGGER_SELECTOR);
      if (!row || !contains(popup, row)) return;
      // The key is claimed either way — pointing at a row that has a submenu is this controller's, and
      // letting it fall through to the parent would move focus in the panel behind.
      keyEvent.preventDefault();
      // **Open-only, because the row's command is `toggle-popover`.** ARIA's menu pattern specifies
      // this key as open-and-enter and never as close, so clicking an already-open row would invert
      // the key's meaning. Normally focus has moved into the submenu by now and this cannot arise —
      // but only if the nested popup's own `mountMenu` is mounted, which a popup rendered outside a
      // menu scope is not. **Resolved from the row, not from this popup.** An id reference resolves in
      // the tree that declares it, and a row always sits in the same tree as the target its own
      // `commandfor` names — whereas this popup is the *parent* panel, which may be in the document
      // while the submenu it points at lives in a shadow root. Resolving from the parent would miss,
      // read as "not open", and toggle an already-open submenu shut: the exact inversion this guard
      // exists to prevent.
      const target = elementById(row, row.getAttribute("commandfor") ?? "");
      if (target?.matches(":popover-open")) return;
      // The row's own `command="toggle-popover"` is what opens the panel; the nested popup's own
      // `mountMenu` is what moves focus into it. Nothing about opening is reimplemented here.
      row.click();
      return;
    }

    // The key pointing away from the submenu, which closes a nested panel and does nothing on a
    // top-level one.
    if (!isNested(popup) || !popup.matches(":popover-open")) return;
    // Exactly the path Escape already takes: the platform hides the popup, `onToggle` above restores
    // focus to the row that opened it. A second, parallel close would be a second thing to keep right.
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
