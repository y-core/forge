import { activeElement, contains } from "./dom";

/** Where focus goes when the toast holding it leaves: a surviving toast's dismiss button, else the region. */
function rehomeTarget(root: HTMLElement): HTMLElement | null {
  const container = root.closest<HTMLElement>("[data-slot~='toast-container']");
  if (!container) return null;
  for (const button of container.querySelectorAll<HTMLElement>("[data-slot~='toast-close']")) {
    if (!contains(root, button)) return button;
  }
  // The region is not otherwise focusable, so it becomes a programmatic-only stop: focus has to land
  // somewhere that announces, and `<body>` announces nothing.
  container.tabIndex = -1;
  return container;
}

/** Removes a toast, rehoming focus first when the toast holds it. */
export function dismissToast(root: HTMLElement): void {
  // A dismiss on a timer is the case that matters: the user did not ask for it, so silently dropping
  // their focus to `<body>` loses their place in the page with no way to tell what happened.
  const active = activeElement(root);
  const target = active && contains(root, active) ? rehomeTarget(root) : null;
  root.remove();
  target?.focus();
}
