import { activeElement, contains } from "./dom";

/** Marks `root` inert, first moving focus to what `rehome` names when `root` holds it, and removes it once its exit transitions finish. @internal */
export function removeRehomingFocus(root: HTMLElement, rehome: (root: HTMLElement) => HTMLElement | null): void {
  // A timer and a click can both dismiss one toast; the first one wins.
  if (root.inert) return;
  // Moved before `inert`, which would otherwise drop the focus it holds to `<body>` first.
  const active = activeElement(root);
  const target = active && contains(root, active) ? rehome(root) : null;
  target?.focus();
  root.inert = true;
  // Transitions only: a consumer's infinite `animate-*` never finishes, and would hold the node forever.
  const running = typeof root.getAnimations === "function" ? root.getAnimations().filter((animation) => "transitionProperty" in animation) : [];
  if (running.length === 0) {
    root.remove();
    return;
  }
  void Promise.allSettled(running.map((animation) => animation.finished)).then(() => root.remove());
}

/** Lets focus into an element that could not otherwise take it, leaving one that already could alone. @internal */
// The rehome exists to preserve the reader's route through the page, so it must not take a stop out
// of it: a container a consumer made focusable — a scroll region, a skip-link landing — keeps its own.
export function programmaticStop(el: HTMLElement): HTMLElement {
  if (!el.hasAttribute("tabindex") && el.tabIndex < 0) el.tabIndex = -1;
  return el;
}
