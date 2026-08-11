import { ownerDocument, ownerWindow } from "./dom";

/**
 * Viewport-driven collapse for a native disclosure.
 *
 * A `<details>` cannot make its own `open` state depend on viewport width — there is no CSS that
 * writes it — so the choice is which state the server renders and which side JavaScript corrects.
 * This controller exists because **open** is the right server default: with scripting unavailable
 * the navigation is visible, which is the safe and accessible state, and JS only ever takes
 * something away rather than being required to add it back.
 */

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

/**
 * Collapses a disclosure while `query` matches, reopens it when the query stops matching **only if
 * this controller is what closed it**, and returns a disposer. Idempotent per element.
 *
 * **It never opens a disclosure it did not close.** A bar that server-renders closed is the common
 * case — the collapsed default — and expanding it at desktop width would show navigation the app
 * never asked to show. So the expand is strictly an undo of this controller's own close, not a
 * second opinion about what the wide-viewport state should be. Making it one-way instead would be
 * the mirror failure: a rail closed on a phone would stay shut for the rest of the session once the
 * device turned back, discarding the server's own choice.
 *
 * **It stops driving the disclosure the moment the user does.** "Explicit" here means any `toggle`
 * this controller did not itself cause — a click on the summary, a keyboard activation, or an app's
 * own scripted open. From that point the viewport is ignored for the lifetime of the mount, because
 * a rail that slams shut every time a phone rotates is worse than no controller at all. The decision
 * is per mount and deliberately not persisted: a fresh page load is a fresh question.
 *
 * The two rules compose in one direction: **the override outranks the restore.** A user who touches
 * the disclosure after this controller closed it cancels the reopen it would otherwise have owed,
 * because by then the state on screen is an answer they gave and the restore would overwrite it.
 *
 * Fails quiet when the element is absent, is not a disclosure, or when the realm has no
 * `matchMedia` — the disclosure then keeps the state the server rendered.
 * @public
 */
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

  // Every programmatic write fires exactly one `toggle`, in order, so a counter distinguishes the
  // controller's changes from the user's without inferring it from the resulting state — a user
  // toggling *back* to the value the controller last wrote is still the user deciding.
  const onToggle = () => {
    if (ownWrites > 0) {
      ownWrites -= 1;
      return;
    }
    userOwned = true;
  };

  el.addEventListener("toggle", onToggle);
  query.addEventListener("change", applyViewport);
  applyViewport();

  const dispose = () => {
    query.removeEventListener("change", applyViewport);
    el.removeEventListener("toggle", onToggle);
    // Leave the DOM as it was found, which under the same rule means undoing this controller's own
    // close and nothing else. Never undo the user either: once they have taken the disclosure over,
    // the state on screen is theirs and restoring the server's would be a second override at the
    // worst possible moment.
    if (!userOwned && closedByController) el.open = initialOpen;
    mountedCollapses.delete(el);
  };

  mountedCollapses.set(el, dispose);
  return dispose;
}
