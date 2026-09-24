import { activeElement, contains, ownerDocument, ownerWindow } from "./dom";
import type { NavDrawerOptions } from "./types";

/** Below Tailwind's `md` breakpoint (`48rem`), the width the drawer's markup is written for. */
const DEFAULT_QUERY =
  "(max-width: 47.99rem)"; /* modern-css-allow: forge-ui-platform-container-query — this arms a focus trap and a scroll lock, which are behaviour rather than style, and `@container` can only drive style; the decision is a page-chrome one taken against the viewport by design. */

/** The panel inside the disclosure: its first element child that is not the backdrop. */
const DEFAULT_PANEL_SELECTOR = ":scope > div:not([data-slot~='navbar-backdrop'])";

/** The trap's own candidate list: the ordinary interactive elements and nothing else. */
const FOCUSABLE =
  "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex='-1'])";

const mountedDrawers = new WeakMap<Element, () => void>();

/** The longest `duration + delay` a computed style's transition lists name, in milliseconds. */
function transitionSpan(style: CSSStyleDeclaration): number {
  const longest = (list: string) =>
    Math.max(0, ...list.split(",").map((time) => (Number.parseFloat(time) || 0) * (time.trim().endsWith("ms") ? 1 : 1000)));
  return longest(style.transitionDuration) + longest(style.transitionDelay);
}

/** The page's own `overflow`, saved once for a document and restored when the last drawer lets go. */
interface ScrollLock {
  saved: string;
  holders: number;
}

const scrollLocks = new WeakMap<Document, ScrollLock>();

/** Takes a share of the document's scroll lock, saving the page's own `overflow` on the first hold. */
function acquireScrollLock(doc: Document): void {
  const existing = scrollLocks.get(doc);
  if (existing) {
    existing.holders += 1;
    return;
  }
  // Through CSSOM rather than a class: forge ships `style-src 'self'` with no style nonce, and the
  // property has to be restored to whatever the page itself set, not merely removed.
  scrollLocks.set(doc, { saved: doc.documentElement.style.getPropertyValue("overflow"), holders: 1 });
  doc.documentElement.style.setProperty("overflow", "hidden");
}

/** Drops one share; the page's own `overflow` returns only once no drawer holds the lock. */
function releaseScrollLock(doc: Document): void {
  const lock = scrollLocks.get(doc);
  if (!lock) return;
  lock.holders -= 1;
  if (lock.holders > 0) return;
  scrollLocks.delete(doc);
  if (lock.saved === "") doc.documentElement.style.removeProperty("overflow");
  else doc.documentElement.style.setProperty("overflow", lock.saved);
}

/** Gives an open off-canvas disclosure its modal behaviour — Escape, scroll lock, focus trap — while `query` matches, and returns a disposer. @public */
export function mountNavDrawer(options: NavDrawerOptions = {}): () => void {
  const noop = () => {};
  const found = options.element ?? (options.selector ? ownerDocument(options.within).querySelector(options.selector) : null);
  const el = found as HTMLDetailsElement | null;
  // Duck-typed rather than `instanceof HTMLDetailsElement`, which is false for an element from
  // another realm and rejects a disclosure a consumer implemented some other way.
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

  // The summary draws the visible close glyph but is a sibling of the panel, so trapping the panel
  // alone leaves it outside the cycle — a keyboard trap under WCAG 2.1.2.
  const trapped = (): HTMLElement[] => (summary === null ? focusables() : [summary, ...focusables()]);

  // Per mount, so this drawer's own lock/unlock stay idempotent and `dispose` releases exactly its
  // own hold; the saved value itself belongs to the document, which is shared.
  let held = false;

  const lock = () => {
    if (held) return;
    held = true;
    acquireScrollLock(doc);
  };

  const unlock = () => {
    if (!held) return;
    held = false;
    releaseScrollLock(doc);
  };

  // The Tab trap below is keyboard-only, and a screen reader's swipe navigation is not a Tab keydown:
  // without `inert` a reader swipes straight past the last link into the page under the backdrop.
  let inerted: HTMLElement[] = [];

  /** Makes everything outside the disclosure inert, remembering only what this drawer itself marked. */
  const isolate = () => {
    if (inerted.length > 0) return;
    let node: HTMLElement = el;
    while (node !== doc.body) {
      const parent = node.parentElement;
      if (!parent) break;
      for (const sibling of parent.children) {
        const candidate = sibling as HTMLElement;
        if (candidate === node || candidate.inert) continue;
        candidate.inert = true;
        inerted.push(candidate);
      }
      node = parent;
    }
  };

  const release = () => {
    for (const node of inerted) node.inert = false;
    inerted = [];
  };

  let pendingFocus = 0;

  const cancelPendingFocus = () => {
    if (pendingFocus === 0) return;
    win.cancelAnimationFrame(pendingFocus);
    pendingFocus = 0;
  };

  // A panel that transitions `visibility` on open is still hidden when `toggle` fires, and the
  // browser refuses focus to a hidden element; the retry is bounded by the panel's own transition.
  const focusFirstItem = () => {
    const first = focusables()[0];
    if (first === undefined || panel === null) return;
    first.focus();
    if (activeElement(el) === first) return;
    const budget = transitionSpan(win.getComputedStyle(panel));
    let start: number | undefined;
    const retry = (time: number) => {
      pendingFocus = 0;
      start ??= time;
      if (!isActive()) return;
      first.focus();
      if (activeElement(el) === first || time - start >= budget) return;
      pendingFocus = win.requestAnimationFrame(retry);
    };
    pendingFocus = win.requestAnimationFrame(retry);
  };

  const applyState = () => {
    cancelPendingFocus();
    if (isActive()) {
      lock();
      isolate();
      focusFirstItem();
      return;
    }
    unlock();
    release();
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
    const items = trapped();
    const first = items[0];
    const last = items.at(-1);
    if (first === undefined || last === undefined) return;
    const active = activeElement(el);
    if (!contains(panel, active) && active !== summary) return;
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
  if (isActive()) {
    lock();
    isolate();
  }

  const dispose = () => {
    query.removeEventListener("change", applyState);
    el.removeEventListener("toggle", applyState);
    doc.removeEventListener("keydown", onKeydown);
    cancelPendingFocus();
    unlock();
    release();
    mountedDrawers.delete(el);
  };

  mountedDrawers.set(el, dispose);
  return dispose;
}
