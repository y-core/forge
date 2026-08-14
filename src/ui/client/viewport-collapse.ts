import { ownerDocument, ownerWindow } from "./dom";

/** Below Tailwind's `md` breakpoint (`48rem`). Stated in `rem` so it meets the `min-width` side
 *  exactly, leaving no width at which neither query matches. */
const DEFAULT_QUERY = "(max-width: 47.99rem)";

const mountedCollapses = new WeakMap<Element, () => void>();

/** Options for {@link mountViewportCollapse}. @public */
export interface ViewportCollapseOptions {
  /** The disclosure to drive — a `<details>`. Takes precedence over {@link ViewportCollapseOptions.selector}. */
  element?: Element | null;
  /** Selector for the disclosure, resolved in {@link ViewportCollapseOptions.within}'s document.
   *  Ignored when an element is given. */
  selector?: string;
  /** Any node in the document to search. Omit for the top-level page. */
  within?: Node;
  /** Media query that, for as long as it matches, keeps the disclosure collapsed. */
  query?: string;
}

/** Collapses a disclosure while `query` matches, reopens it only if this controller is what closed it, and returns a disposer. @public */
export function mountViewportCollapse(options: ViewportCollapseOptions = {}): () => void {
  const noop = () => {};
  const found = options.element ?? (options.selector ? ownerDocument(options.within).querySelector(options.selector) : null);
  const el = found as HTMLDetailsElement | null;
  // Duck-typed rather than `instanceof HTMLDetailsElement`, which is false for an element from
  // another realm, and which would also reject a disclosure a consumer implemented some other way.
  if (!el || typeof el.open !== "boolean") return noop;

  const existing = mountedCollapses.get(el);
  if (existing) return existing;

  const win = ownerWindow(el);
  if (typeof win.matchMedia !== "function") return noop;
  const query = win.matchMedia(options.query ?? DEFAULT_QUERY);
  if (typeof query.addEventListener !== "function") return noop;

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
