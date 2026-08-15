import { applyStateAttrs } from "../contracts/state-attrs";
import { TAB_SELECTOR, TABLIST_SELECTOR, TABS_MOUNTED_ATTR } from "../contracts/tabs-contract";
import { mountRovingFocus } from "./composite";
import { closestAcross, elementById, eventTarget } from "./dom";

export interface TabsOptions {
  /** Select a tab as soon as focus reaches it. @default read from the root's `data-activation` */
  activation?: "automatic" | "manual";
}

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

  // The tab is an `<a href="#panel">` so that it works with no script; once this controller is live
  // the fragment must not be followed, or every activation would push a history entry and scroll the
  // panel into view. Registered separately from `onActivate` because automatic activation rides
  // `focusin` and would otherwise never see the click at all.
  const onClick = (event: Event) => {
    const tab = closestAcross(eventTarget(event) as Node | null, TAB_SELECTOR);
    if (tab && list.contains(tab)) event.preventDefault();
  };

  // Automatic activation rides `focusin`, which the arrow keys already produce, so the selection
  // follows the roving focus without this controller knowing which key moved it.
  const activateOn = activation === "automatic" ? "focusin" : "click";
  list.addEventListener(activateOn, onActivate);
  list.addEventListener("click", onClick);

  // Retires the `:target` fallback, which exists only for the no-script case.
  root.setAttribute(TABS_MOUNTED_ATTR, "");

  return () => {
    root.removeAttribute(TABS_MOUNTED_ATTR);
    list.removeEventListener(activateOn, onActivate);
    list.removeEventListener("click", onClick);
    disposeFocus();
  };
}
