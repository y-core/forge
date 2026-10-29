import { applyStateAttrs } from "../contracts/state-attrs";
import { TAB_SELECTOR, TABLIST_SELECTOR, TABS_MOUNTED_ATTR, TABS_SCOPE } from "../contracts/tabs-contract";
import { isDisabled, mountRovingFocus } from "./composite";
import { closestAcross, elementById, eventTarget } from "./dom";
import type { TabsOptions } from "./types";

const TABS_ROOT_SELECTOR = `[data-scope='${TABS_SCOPE}']`;

function tabsIn(list: HTMLElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>(TAB_SELECTOR)].filter((tab) => (closestAcross(tab, TABLIST_SELECTOR) ?? list) === list);
}

function panelFor(tab: HTMLElement): HTMLElement | null {
  return elementById(tab, tab.getAttribute("aria-controls") ?? "");
}

// `until-found` keeps an unselected panel searchable but leaves it focusable, so it also leaves the tab
// sequence; a disabled tab's panel stays plain `hidden`, which find-in-page never reveals.
function showPanel(panel: HTMLElement, tab: HTMLElement, shown: boolean): void {
  if (shown) panel.removeAttribute("hidden");
  else panel.setAttribute("hidden", isDisabled(tab) ? "" : "until-found");
  panel.tabIndex = shown ? 0 : -1;
}

function select(list: HTMLElement, chosen: HTMLElement): void {
  for (const tab of tabsIn(list)) {
    const isChosen = tab === chosen;
    tab.setAttribute("aria-selected", String(isChosen));
    applyStateAttrs(tab, { selected: isChosen });
    const panel = panelFor(tab);
    if (!panel) continue;
    showPanel(panel, tab, isChosen);
    applyStateAttrs(panel, { selected: isChosen });
  }
}

function alignPanels(list: HTMLElement): void {
  for (const tab of tabsIn(list)) {
    const panel = panelFor(tab);
    if (panel) showPanel(panel, tab, tab.getAttribute("aria-selected") === "true");
  }
}

/** Mounts a `Tabs` root and returns a disposer. */
export function mountTabs(root: HTMLElement, options: TabsOptions = {}): () => void {
  const list =
    [...root.querySelectorAll<HTMLElement>(TABLIST_SELECTOR)].find((l) => (closestAcross(l, TABS_ROOT_SELECTOR) ?? root) === root) ?? root;
  const vertical = list.getAttribute("aria-orientation") === "vertical";
  const activation = options.activation ?? (root.getAttribute("data-activation") === "manual" ? "manual" : "automatic");

  const disposeFocus = mountRovingFocus(list, { items: TAB_SELECTOR, orientation: vertical ? "vertical" : "horizontal", loop: true });

  const onActivate = (event: Event) => {
    const tab = closestAcross(eventTarget(event) as Node | null, TAB_SELECTOR);
    if (!tab || !list.contains(tab)) return;
    if (tab.getAttribute("aria-disabled") === "true") return;
    select(list, tab);
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
    const entry = tabs.find((tab) => tab.getAttribute("aria-selected") === "true") ?? tabs.find((tab) => !isDisabled(tab)) ?? tabs[0];
    for (const tab of tabs) tab.tabIndex = tab === entry ? 0 : -1;
  };

  const activateOn = activation === "automatic" ? "focusin" : "click";
  const lifetime = new AbortController();
  const { signal } = lifetime;
  list.addEventListener(activateOn, onActivate, { signal });
  list.addEventListener("click", onClick, { signal });
  if (activation === "manual") list.addEventListener("keydown", onKeyDown, { signal });
  list.addEventListener("focusout", onFocusOut, { signal });
  for (const tab of tabsIn(list)) {
    panelFor(tab)?.addEventListener(
      "beforematch",
      () => {
        if (isDisabled(tab)) return;
        select(list, tab);
        for (const other of tabsIn(list)) other.tabIndex = other === tab ? 0 : -1;
      },
      { signal },
    );
  }

  alignPanels(list);
  root.setAttribute(TABS_MOUNTED_ATTR, "");

  return () => {
    lifetime.abort();
    root.removeAttribute(TABS_MOUNTED_ATTR);
    disposeFocus();
  };
}
