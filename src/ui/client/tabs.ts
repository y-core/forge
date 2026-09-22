import { applyStateAttrs } from "../contracts/state-attrs";
import { TAB_SELECTOR, TABLIST_SELECTOR, TABS_MOUNTED_ATTR } from "../contracts/tabs-contract";
import { isDisabled, mountRovingFocus } from "./composite";
import { closestAcross, elementById, eventTarget } from "./dom";
import type { TabsOptions } from "./types";

function tabsIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TAB_SELECTOR)];
}

function panelFor(tab: HTMLElement): HTMLElement | null {
  return elementById(tab, tab.getAttribute("aria-controls") ?? "");
}

function select(root: HTMLElement, chosen: HTMLElement): void {
  for (const tab of tabsIn(root)) {
    const isChosen = tab === chosen;
    tab.setAttribute("aria-selected", String(isChosen));
    applyStateAttrs(tab, { selected: isChosen });
    const panel = panelFor(tab);
    if (!panel) continue;
    panel.hidden = !isChosen;
    applyStateAttrs(panel, { selected: isChosen });
  }
}

/** Mounts a `Tabs` root and returns a disposer. */
export function mountTabs(root: HTMLElement, options: TabsOptions = {}): () => void {
  const list = root.querySelector<HTMLElement>(TABLIST_SELECTOR) ?? root;
  const vertical = root.getAttribute("data-orientation") === "vertical";
  const activation = options.activation ?? (root.getAttribute("data-activation") === "manual" ? "manual" : "automatic");

  const disposeFocus = mountRovingFocus(list, { items: TAB_SELECTOR, orientation: vertical ? "vertical" : "horizontal", loop: true });

  const onActivate = (event: Event) => {
    const tab = closestAcross(eventTarget(event) as Node | null, TAB_SELECTOR);
    if (!tab || !list.contains(tab)) return;
    if (tab.getAttribute("aria-disabled") === "true") return;
    select(root, tab);
  };

  // The tab is an `<a href="#panel">` so it works with no script, but once this controller is live
  // the fragment must not be followed: it would push a history entry and scroll the panel into view.
  const onClick = (event: Event) => {
    const tab = closestAcross(eventTarget(event) as Node | null, TAB_SELECTOR);
    if (tab && list.contains(tab)) event.preventDefault();
  };

  // Under manual activation the keyboard has to say so, and a tab is an `<a href>`: the platform
  // synthesises a click for Enter but never for Space, which would scroll the page instead.
  const onKeyDown = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.defaultPrevented || keyEvent.key !== " ") return;
    const tab = closestAcross(eventTarget(keyEvent) as Node | null, TAB_SELECTOR);
    if (!tab || !list.contains(tab)) return;
    keyEvent.preventDefault();
    onActivate(keyEvent);
  };

  // A tab list is entered at the tab the widget is showing, not wherever the reader last arrowed to,
  // so leaving the list hands the stop back to the selected tab.
  const onFocusOut = (event: Event) => {
    const next = (event as FocusEvent).relatedTarget as Node | null;
    if (next && list.contains(next as Node)) return;
    const tabs = tabsIn(list);
    // Nothing requires a `Tabs` to render a selection, and under manual activation arrowing alone
    // never makes one — so without both fallbacks the whole list leaves the tab sequence for good.
    const entry = tabs.find((tab) => tab.getAttribute("aria-selected") === "true") ?? tabs.find((tab) => !isDisabled(tab)) ?? tabs[0];
    for (const tab of tabs) tab.tabIndex = tab === entry ? 0 : -1;
  };

  // Automatic activation rides `focusin`, which the arrow keys already produce, so the selection
  // follows the roving focus without this controller knowing which key moved it.
  const activateOn = activation === "automatic" ? "focusin" : "click";
  list.addEventListener(activateOn, onActivate);
  list.addEventListener("click", onClick);
  if (activation === "manual") list.addEventListener("keydown", onKeyDown);
  list.addEventListener("focusout", onFocusOut);

  // Retires the `:target` fallback, which exists only for the no-script case.
  root.setAttribute(TABS_MOUNTED_ATTR, "");

  return () => {
    root.removeAttribute(TABS_MOUNTED_ATTR);
    list.removeEventListener(activateOn, onActivate);
    list.removeEventListener("click", onClick);
    list.removeEventListener("keydown", onKeyDown);
    list.removeEventListener("focusout", onFocusOut);
    disposeFocus();
  };
}
