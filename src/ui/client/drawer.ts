import { activeElement, contains, ownerDocument, ownerWindow } from "./dom";

/** Below Tailwind's `md` breakpoint (`48rem`), the width the drawer's markup is written for. */
const DEFAULT_QUERY =
  "(max-width: 47.99rem)"; /* modern-css-allow: forge-ui-platform-container-query — this arms a focus trap and a scroll lock, which are behaviour rather than style, and `@container` can only drive style; the decision is a page-chrome one taken against the viewport by design. */

/** The panel inside the disclosure: its first element child that is not the backdrop. */
const DEFAULT_PANEL_SELECTOR = ":scope > div:not([data-slot~='navbar-backdrop'])";

/** The trap's own candidate list. Deliberately the ordinary interactive elements and nothing else —
 *  forge has no focus-trap utility to defer to, and a wider list is a wider surface to get wrong. */
const FOCUSABLE =
  "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex='-1'])";

const mountedDrawers = new WeakMap<Element, () => void>();

/** Options for {@link mountNavDrawer}. @public */
export interface NavDrawerOptions {
  /** The disclosure to drive — a `<details>`. Takes precedence over {@link NavDrawerOptions.selector}. */
  element?: Element | null;
  /** Selector for the disclosure, resolved in {@link NavDrawerOptions.within}'s document.
   *  Ignored when an element is given. */
  selector?: string;
  /** Any node in the document to search. Omit for the top-level page. */
  within?: Node;
  /** Media query that, for as long as it matches, makes the open disclosure a modal drawer. */
  query?: string;
  /** Selector for the sliding panel inside the disclosure. */
  panelSelector?: string;
}

/** Gives an open off-canvas disclosure its modal behaviour — Escape, scroll lock, focus trap — while `query` matches, and returns a disposer. @public */
export function mountNavDrawer(options: NavDrawerOptions = {}): () => void {
  const noop = () => {};
  const found = options.element ?? (options.selector ? ownerDocument(options.within).querySelector(options.selector) : null);
  const el = found as HTMLDetailsElement | null;
  // Duck-typed rather than `instanceof HTMLDetailsElement`, which is false for an element from
  // another realm, and which would also reject a disclosure a consumer implemented some other way.
  // The call named a target and it did not resolve, which is a property of the call site: it throws.
  if (!el || typeof el.open !== "boolean") {
    const named = options.element !== undefined ? "the given `element`" : `\`${options.selector ?? "(none)"}\``;
    throw new Error(`mountNavDrawer: ${named} did not resolve to a disclosure with an \`open\` property`);
  }

  const existing = mountedDrawers.get(el);
  if (existing) return existing;

  const win = ownerWindow(el);
  // Environmental, so it degrades: the disclosure keeps its native open/close, without the modal
  // behaviour a drawer layers on top.
  if (typeof win.matchMedia !== "function") {
    console.warn("[nav-drawer] matchMedia is unavailable in this realm; the disclosure will not behave as a drawer");
    return noop;
  }
  const query = win.matchMedia(options.query ?? DEFAULT_QUERY);
  if (typeof query.addEventListener !== "function") {
    console.warn("[nav-drawer] this realm's MediaQueryList has no addEventListener; the disclosure will not behave as a drawer");
    return noop;
  }

  const doc = ownerDocument(el);
  const summary = el.querySelector<HTMLElement>("summary");
  const panel = el.querySelector<HTMLElement>(options.panelSelector ?? DEFAULT_PANEL_SELECTOR);

  /** The drawer is modal exactly while it is both narrow enough to overlay and actually disclosed. */
  const isActive = () => query.matches && el.open;

  const focusables = (): HTMLElement[] => (panel === null ? [] : [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.hidden));

  let lockedOverflow: string | null = null;

  const lock = () => {
    if (lockedOverflow !== null) return;
    // Through CSSOM rather than a class: forge ships `style-src 'self'` with no style nonce, and the
    // property has to be restored to whatever the page itself set, not merely removed.
    lockedOverflow = doc.documentElement.style.getPropertyValue("overflow");
    doc.documentElement.style.setProperty("overflow", "hidden");
  };

  const unlock = () => {
    if (lockedOverflow === null) return;
    if (lockedOverflow === "") doc.documentElement.style.removeProperty("overflow");
    else doc.documentElement.style.setProperty("overflow", lockedOverflow);
    lockedOverflow = null;
  };

  const applyState = () => {
    if (isActive()) {
      lock();
      focusables()[0]?.focus();
      return;
    }
    unlock();
    // Only when focus is still inside the panel: a close the reader triggered from somewhere else on
    // the page must not yank their focus back to the bar.
    if (contains(panel, activeElement(el))) summary?.focus();
  };

  const onKeydown = (event: Event) => {
    if (!isActive()) return;
    const key = (event as KeyboardEvent).key;
    if (key === "Escape") {
      el.open = false;
      return;
    }
    if (key !== "Tab") return;
    const items = focusables();
    const first = items[0];
    const last = items.at(-1);
    if (first === undefined || last === undefined) return;
    const active = activeElement(el);
    if (!contains(panel, active)) return;
    if ((event as KeyboardEvent).shiftKey) {
      if (active !== first) return;
      event.preventDefault();
      last.focus();
      return;
    }
    if (active !== last) return;
    event.preventDefault();
    first.focus();
  };

  el.addEventListener("toggle", applyState);
  query.addEventListener("change", applyState);
  doc.addEventListener("keydown", onKeydown);
  if (isActive()) lock();

  const dispose = () => {
    query.removeEventListener("change", applyState);
    el.removeEventListener("toggle", applyState);
    doc.removeEventListener("keydown", onKeydown);
    unlock();
    mountedDrawers.delete(el);
  };

  mountedDrawers.set(el, dispose);
  return dispose;
}
