import { MENU_GROUP_SELECTOR, MENU_ITEM_SELECTOR, MENU_KEEP_OPEN_ATTR, MENU_RADIO_SELECTOR } from "../contracts/menu-contract";
import { applyStateAttrs } from "../contracts/state-attrs";
import { isDisabled, leavesRing, mountRovingFocus } from "./composite";
import { activeElement, asElement, closestAcross, contains, elementById, eventTarget, isRtl, ownerDocument } from "./dom";
import type { MenuOptions } from "./types";

const SUBMENU_TRIGGER_SELECTOR = '[data-slot~="menu-submenu-trigger"]';
const MENU_POPUP_SELECTOR = '[data-slot~="menu-popup"]';

const LINK_ROW_SELECTOR = "a[role='menuitem']";

// The cap is the whole point: `commandfor` may name a panel from an invoker inside that same panel,
// which makes the chain a cycle, and an uncapped walk over it hangs the tab it was serving.
function* chainOut<T>(from: T | null, next: (at: T) => T | null): Generator<T> {
  for (let at = from, hop = 0; at && hop < 16; at = next(at), hop += 1) yield at;
}

function isNested(popup: HTMLElement): boolean {
  // Climbing from `parentNode` rather than the popup keeps `closest` from matching the popup itself,
  // and rather than `parentElement` because a slotted popup's parent can be a `ShadowRoot`.
  return closestAcross(popup.parentNode, MENU_POPUP_SELECTOR) != null;
}

function setChecked(item: HTMLElement, checked: boolean): void {
  item.setAttribute("aria-checked", String(checked));
  applyStateAttrs(item, { checked });
}

/** Flips a checkable menu row, clearing the radio siblings it is mutually exclusive with. */
export function checkMenuItem(item: HTMLElement, scope: HTMLElement): void {
  if (isDisabled(item)) return;
  if (item.getAttribute("role") !== "menuitemradio") {
    setChecked(item, item.getAttribute("aria-checked") !== "true");
    return;
  }
  // Bounded to the scope: a menu rendered inside an unrelated `<fieldset>` would otherwise clear
  // radio rows belonging to a different menu entirely.
  const group = closestAcross<HTMLElement>(item, MENU_GROUP_SELECTOR);
  const within = group && contains(scope, group) ? group : scope;
  for (const sibling of within.querySelectorAll<HTMLElement>(MENU_RADIO_SELECTOR)) setChecked(sibling, false);
  setChecked(item, true);
}

/** Mounts a menu popup's keyboard behaviour, returning a disposer. */
export function mountMenu(popup: HTMLElement, options: MenuOptions = {}): () => void {
  const disposeFocus = mountRovingFocus(popup, { items: MENU_ITEM_SELECTOR, orientation: "vertical", loop: options.loop ?? true, typeahead: true });
  let opener: HTMLElement | null = null;

  const onBeforeToggle = (event: Event) => {
    if ((event as Event & { newState?: string }).newState !== "open") return;
    opener = asElement(activeElement(popup));
  };

  function firstRingItem(): HTMLElement | null {
    for (const item of popup.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)) {
      if (!leavesRing(item)) return item;
    }
    return null;
  }

  const onToggle = (event: Event) => {
    const newState = (event as Event & { newState?: string }).newState;
    if (newState === "open") {
      firstRingItem()?.focus();
      return;
    }
    const active = activeElement(popup);
    if (active && active !== ownerDocument(popup).body && !contains(popup, active)) return;
    opener?.focus();
  };

  const onKeyDown = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    // `keydown` bubbles from an open submenu to the panel containing it, so bailing on
    // `defaultPrevented` is what keeps both controllers from acting on one press.
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
      // The row's command is `toggle-popover`, and ARIA specifies this key as open-and-enter, never
      // as close, so an already-open submenu must not be clicked again.
      const target = elementById(row, row.getAttribute("commandfor") ?? "");
      if (target?.matches(":popover-open")) return;
      row.click();
      return;
    }

    if (!isNested(popup) || !popup.matches(":popover-open")) return;
    keyEvent.preventDefault();
    popup.hidePopover();
  };

  function openerOf(panel: HTMLElement): HTMLElement | null {
    if (!panel.id) return null;
    return ownerDocument(popup).querySelector<HTMLElement>(`[commandfor="${CSS.escape(panel.id)}"]`);
  }

  function parentPanelOf(panel: HTMLElement): HTMLElement | null {
    const nested = closestAcross<HTMLElement>(panel.parentNode, MENU_POPUP_SELECTOR);
    if (nested) return nested;
    const invoker = openerOf(panel);
    return invoker ? closestAcross<HTMLElement>(invoker, MENU_POPUP_SELECTOR) : null;
  }

  function openerOutside(node: Node): Node | null {
    const panel = closestAcross<HTMLElement>(node, MENU_POPUP_SELECTOR);
    return panel === null ? null : openerOf(panel);
  }

  // A submenu panel need not be a DOM descendant of the one it belongs to; `commandfor` is the
  // relationship, and following it is what keeps a parent open while its submenu holds focus.
  function withinMenu(node: Node): boolean {
    for (const at of chainOut<Node>(node, openerOutside)) if (contains(popup, at)) return true;
    return false;
  }

  // An `<a>` cannot be an invoker, so a link row has no `command="hide-popover"` of its own: a
  // same-document href would otherwise scroll the page and leave the menu standing open behind it.
  const onActivateLink = (event: Event) => {
    const link = closestAcross<HTMLElement>(eventTarget(event) as Node | null, LINK_ROW_SELECTOR);
    if (!link || !contains(popup, link) || link.hasAttribute(MENU_KEEP_OPEN_ATTR)) return;
    if (popup.matches(":popover-open")) popup.hidePopover();
  };

  function closeMenuToward(next: Node): void {
    for (const panel of chainOut(popup, parentPanelOf)) {
      if (contains(panel, next)) break;
      if (panel.matches(":popover-open")) panel.hidePopover();
    }
  }

  let pressingInvoker = false;

  const onPointerDown = (event: Event) => {
    pressingInvoker = contains(openerOf(popup), eventTarget(event) as Node | null);
  };

  // A press released off the invoker fires no click, so the focus-out it deferred is settled here.
  const settleInvokerPress = () => {
    if (!pressingInvoker) return;
    pressingInvoker = false;
    const active = activeElement(popup);
    if (!active || active === ownerDocument(popup).body || withinMenu(active)) return;
    closeMenuToward(active);
  };

  // A touch pointer is implicitly captured, so its `pointerup` targets the invoker wherever the finger
  // lifts; only the release point says whether it lifted there.
  function releasedOnInvoker(event: Event): boolean {
    const { clientX, clientY } = event as PointerEvent;
    return contains(openerOf(popup), ownerDocument(popup).elementFromPoint(clientX, clientY));
  }

  const onPointerUp = (event: Event) => {
    if (releasedOnInvoker(event)) {
      pressingInvoker = false;
      return;
    }
    settleInvokerPress();
  };

  // The platform light-dismisses a popover on pointer-down outside it and on Escape, never on focus
  // leaving it — so Tab out is the one exit APG asks for that `popover="auto"` does not give.
  const onFocusOut = (event: Event) => {
    const next = (event as FocusEvent).relatedTarget as Node | null;
    // A null `relatedTarget` is the popup being hidden under the focus it held, not a user leaving it.
    if (!next || withinMenu(next)) return;
    // Closing here on a press of the invoker lets its click's `toggle-popover` reopen the menu.
    if (pressingInvoker) return;
    closeMenuToward(next);
  };

  popup.addEventListener("beforetoggle", onBeforeToggle);
  popup.addEventListener("toggle", onToggle);
  popup.addEventListener("keydown", onKeyDown);
  popup.addEventListener("focusout", onFocusOut);
  popup.addEventListener("click", onActivateLink);
  const doc = ownerDocument(popup);
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("pointerup", onPointerUp, true);
  doc.addEventListener("pointercancel", settleInvokerPress, true);

  return () => {
    popup.removeEventListener("beforetoggle", onBeforeToggle);
    popup.removeEventListener("toggle", onToggle);
    popup.removeEventListener("keydown", onKeyDown);
    popup.removeEventListener("focusout", onFocusOut);
    popup.removeEventListener("click", onActivateLink);
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("pointerup", onPointerUp, true);
    doc.removeEventListener("pointercancel", settleInvokerPress, true);
    disposeFocus();
  };
}
