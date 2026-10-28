import { activeElement, contains, ownerDocument, ownerWindow } from "./dom";
import type { NavDrawerOptions } from "./types";
import { MD_DOWN_QUERY, resolveDisclosure, trackViewport } from "./viewport-disclosure";

// The platform closes these on Escape after `keydown` is dispatched, so one is still open when the handler runs.
const OPEN_SURFACE = ":popover-open,dialog:modal";

const FOCUSABLE =
  "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex='-1'])";

// An app's backdrop is a sibling `div` like the panel, so the default keys on what a panel holds rather than on markup it may not carry.
const DEFAULT_PANEL_SELECTOR = `:scope > :not(summary, [data-slot~='navbar-backdrop']):has(${FOCUSABLE})`;

const mountedDrawers = new WeakMap<Element, () => void>();

// The reflected `popover` normalises case and an invalid value to `manual`, which never light-dismisses.
function ownsEscape(panel: HTMLElement | null): boolean {
  return panel !== null && [...panel.querySelectorAll<HTMLElement>(OPEN_SURFACE)].some((surface) => surface.popover !== "manual");
}

function transitionSpan(style: CSSStyleDeclaration): number {
  const longest = (list: string) =>
    Math.max(0, ...list.split(",").map((time) => (Number.parseFloat(time) || 0) * (time.trim().endsWith("ms") ? 1 : 1000)));
  return longest(style.transitionDuration) + longest(style.transitionDelay);
}

interface ScrollLock {
  saved: string;
  holders: number;
}

const scrollLocks = new WeakMap<Document, ScrollLock>();

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
  const el = resolveDisclosure("mountNavDrawer", options);

  const existing = mountedDrawers.get(el);
  if (existing) return existing;

  const query = trackViewport("nav-drawer", el, options.query ?? MD_DOWN_QUERY);
  if (query === null) return () => {};

  const win = ownerWindow(el);
  const doc = ownerDocument(el);
  const summary = el.querySelector<HTMLElement>("summary");
  const panel = el.querySelector<HTMLElement>(options.panelSelector ?? DEFAULT_PANEL_SELECTOR);
  if (!panel?.querySelector(FOCUSABLE)) {
    console.warn("[nav-drawer] no panel with a focusable item resolved; Tab will cycle on the summary alone");
  }

  const isActive = () => query.matches && el.open;

  const focusables = (): HTMLElement[] =>
    panel === null ? [] : [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.hidden && n.checkVisibility());

  // The summary draws the visible close glyph but is a sibling of the panel, so trapping the panel
  // alone leaves it outside the cycle — a keyboard trap under WCAG 2.1.2.
  const trapped = (): HTMLElement[] => (summary === null ? focusables() : [summary, ...focusables()]);

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

  // The items can still be hidden when `toggle` fires, so each frame re-resolves the first one
  // until the panel's transition has run.
  const focusFirstItem = () => {
    if (panel === null) return;
    const attempt = () => {
      const first = focusables()[0];
      first?.focus();
      return first !== undefined && activeElement(el) === first;
    };
    if (attempt()) return;
    const budget = Math.max(transitionSpan(win.getComputedStyle(panel)), transitionSpan(win.getComputedStyle(el, "::details-content")));
    let start: number | undefined;
    const retry = (time: number) => {
      pendingFocus = 0;
      start ??= time;
      if (!isActive()) return;
      if (attempt() || time - start >= budget) return;
      pendingFocus = win.requestAnimationFrame(retry);
    };
    pendingFocus = win.requestAnimationFrame(retry);
  };

  let focusDropped = false;

  const applyState = () => {
    cancelPendingFocus();
    if (isActive()) {
      focusDropped = false;
      lock();
      isolate();
      focusFirstItem();
      return;
    }
    unlock();
    release();
    const active = activeElement(el);
    if (contains(panel, active) || (focusDropped && (active === null || active === doc.body))) summary?.focus();
    focusDropped = false;
  };

  const onKeydown = (event: Event) => {
    if (!isActive()) return;
    const key = (event as KeyboardEvent).key;
    if (key === "Escape") {
      if (event.defaultPrevented || ownsEscape(panel)) return;
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

  const lifetime = new AbortController();
  const { signal } = lifetime;
  el.addEventListener("toggle", applyState, { signal });
  query.addEventListener("change", applyState, { signal });
  doc.addEventListener("keydown", onKeydown, { signal });
  doc.addEventListener(
    "focusin",
    () => {
      focusDropped = false;
    },
    { signal },
  );
  panel?.addEventListener(
    "focusout",
    (event) => {
      focusDropped = (event as FocusEvent).relatedTarget === null;
    },
    { signal },
  );
  if (isActive()) {
    lock();
    isolate();
  }

  const dispose = () => {
    lifetime.abort();
    cancelPendingFocus();
    unlock();
    release();
    mountedDrawers.delete(el);
  };

  mountedDrawers.set(el, dispose);
  return dispose;
}
