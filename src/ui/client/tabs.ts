import { applyStateAttrs } from "../contracts/state-attrs";
import { TAB_SELECTOR, TABLIST_SELECTOR } from "../contracts/tabs-contract";
import { mountRovingFocus } from "./composite";
import { closestAcross, elementById, eventTarget } from "./dom";

/**
 * Tab selection and keyboard navigation.
 *
 * The list is one Tab stop via `mountRovingFocus`; this adds the part that is specific to tabs —
 * moving the selection, and the panel visibility that follows it. Panels are found through the
 * `aria-controls` the markup already declares, so there is no second registry to keep in step.
 */

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

/**
 * Mount a `Tabs` root and return a disposer.
 * @public
 */
export function mountTabs(root: HTMLElement, options: TabsOptions = {}): () => void {
  const list = root.querySelector<HTMLElement>(TABLIST_SELECTOR) ?? root;
  const vertical = root.getAttribute("data-orientation") === "vertical";
  const activation = options.activation ?? (root.getAttribute("data-activation") === "manual" ? "manual" : "automatic");

  const disposeFocus = mountRovingFocus(list, { items: TAB_SELECTOR, orientation: vertical ? "vertical" : "horizontal", loop: true });

  const onActivate = (event: Event) => {
    const tab = closestAcross(eventTarget(event) as Node | null, TAB_SELECTOR);
    if (tab && list.contains(tab)) select(root, tab);
  };

  // Automatic activation rides `focusin`, which the arrow keys already produce — so the selection
  // follows the roving focus without this controller knowing which key moved it.
  list.addEventListener(activation === "automatic" ? "focusin" : "click", onActivate);

  return () => {
    list.removeEventListener(activation === "automatic" ? "focusin" : "click", onActivate);
    disposeFocus();
  };
}
