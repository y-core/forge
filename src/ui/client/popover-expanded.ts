import { ownerDocument } from "./dom";

/** Writes `open` to every invoker in `popup`'s tree that names it through `aria-controls`. */
function syncInvokers(popup: HTMLElement, open: boolean): void {
  const id = popup.id;
  if (!id) return;
  // Matched by reading the attribute rather than by an `[aria-controls="…"]` selector, because an id
  // is not required to be a valid CSS identifier and escaping it would be the only other option.
  const root = popup.getRootNode() as Partial<ParentNode>;
  const tree = typeof root.querySelectorAll === "function" ? (root as ParentNode) : ownerDocument(popup);
  for (const invoker of tree.querySelectorAll("[aria-controls]")) {
    if (invoker.getAttribute("aria-controls") === id) invoker.setAttribute("aria-expanded", String(open));
  }
}

/** Keeps every invoker's `aria-expanded` in step with `popup`'s open state, returning a disposer. */
export function mountExpandedState(popup: HTMLElement): () => void {
  const onToggle = (event: Event) => syncInvokers(popup, (event as Event & { newState?: string }).newState === "open");
  // Both events, for two different reasons. The Popover API fires them for every open and close path
  // — invoker command, Escape, light dismiss and `hidePopover()` alike — so no route leaves the
  // attribute stale; but `toggle` is queued a task later, and `beforetoggle` is what updates the
  // attribute within the same event as the click that caused it.
  popup.addEventListener("beforetoggle", onToggle);
  popup.addEventListener("toggle", onToggle);
  return () => {
    popup.removeEventListener("beforetoggle", onToggle);
    popup.removeEventListener("toggle", onToggle);
  };
}

/** Mounts {@link mountExpandedState} on every popover at or below `root`, returning one disposer. */
export function mountExpandedStates(root: HTMLElement): () => void {
  const disposers = [root, ...root.querySelectorAll<HTMLElement>("[popover]")].filter((el) => el.hasAttribute("popover")).map(mountExpandedState);
  return () => {
    for (const dispose of disposers) dispose();
  };
}
