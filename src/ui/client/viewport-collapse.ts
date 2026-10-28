import type { ViewportCollapseOptions } from "./types";
import { MD_DOWN_QUERY, resolveDisclosure, trackViewport } from "./viewport-disclosure";

const mountedCollapses = new WeakMap<Element, () => void>();

function finishTransitions(el: HTMLDetailsElement): void {
  if (typeof el.getAnimations !== "function") return;
  for (const animation of el.getAnimations({ subtree: true })) {
    if ("transitionProperty" in animation) animation.finish();
  }
}

/** Collapses a disclosure while `query` matches, reopens it only if this controller is what closed it, and returns a disposer. @public */
export function mountViewportCollapse(options: ViewportCollapseOptions = {}): () => void {
  const el = resolveDisclosure("mountViewportCollapse", options);

  const existing = mountedCollapses.get(el);
  if (existing) return existing;

  // Environmental, so it degrades: the disclosure keeps whatever state the markup gave it.
  const query = trackViewport("viewport-collapse", el, options.query ?? MD_DOWN_QUERY);
  if (query === null) return () => {};

  const initialOpen = el.open;
  let userOwned = false;
  let ownWrites = 0;
  /** Whether the disclosure is shut *because of this controller* — the only state it may undo. */
  let closedByController = false;

  const write = (open: boolean) => {
    ownWrites += 1;
    el.open = open;
  };

  const applyViewport = () => {
    if (userOwned) return;
    if (query.matches) {
      if (!el.open) return;
      closedByController = true;
      write(false);
      return;
    }
    // The guard, not an optimisation: without it the controller would open every disclosure the
    // server rendered closed the moment the viewport went wide.
    if (!closedByController) return;
    closedByController = false;
    write(true);
  };

  // Every programmatic write fires exactly one `toggle`, in order, so one decrement per event tells
  // the controller's changes from the user's without inferring it from the resulting state.
  const consumeOwnWrite = (): boolean => {
    if (ownWrites === 0) return false;
    ownWrites -= 1;
    return true;
  };

  const onToggle = () => {
    if (consumeOwnWrite()) return;
    userOwned = true;
  };

  el.addEventListener("toggle", onToggle);
  query.addEventListener("change", applyViewport);
  applyViewport();
  if (closedByController) finishTransitions(el);

  const dispose = () => {
    query.removeEventListener("change", applyViewport);
    el.removeEventListener("toggle", onToggle);
    // Leaves the DOM as it was found: this controller's own close is undone, and nothing else.
    if (!userOwned && closedByController) el.open = initialOpen;
    mountedCollapses.delete(el);
  };

  mountedCollapses.set(el, dispose);
  return dispose;
}
