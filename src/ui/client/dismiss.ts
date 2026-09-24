import { activeElement, contains } from "./dom";

/** Removes `root`, first moving focus to what `rehome` names when `root` is what holds it. @internal */
export function removeRehomingFocus(root: HTMLElement, rehome: (root: HTMLElement) => HTMLElement | null): void {
  // Read before the removal: once `root` is out of the document, `contains` can no longer tell that
  // the focus `<body>` now holds was the user's place inside it.
  const active = activeElement(root);
  const target = active && contains(root, active) ? rehome(root) : null;
  root.remove();
  target?.focus();
}

/** Lets focus into an element that could not otherwise take it, leaving one that already could alone. @internal */
// The rehome exists to preserve the reader's route through the page, so it must not take a stop out
// of it: a container a consumer made focusable — a scroll region, a skip-link landing — keeps its own.
export function programmaticStop(el: HTMLElement): HTMLElement {
  if (!el.hasAttribute("tabindex") && el.tabIndex < 0) el.tabIndex = -1;
  return el;
}
