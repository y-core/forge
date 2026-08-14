import { elementById, ownerWindow } from "./dom";

/** The marker. `"location"` and never `"page"`: the page has not changed — the reader moved within
 *  it — and `"page"` would announce a navigation that never happened. */
const CURRENT_ATTR = "aria-current";
const CURRENT_VALUE = "location";

/** Biases toward the section at the top of the viewport rather than the one merely visible: the
 *  bottom inset shrinks the observation band to the top slice of the viewport, so a long section
 *  scrolling away stops being "current" as soon as its successor reaches the top. */
const DEFAULT_ROOT_MARGIN = "0px 0px -70% 0px";

/** `Node.DOCUMENT_POSITION_FOLLOWING`, spelled out rather than read off a bare `Node` global. */
const POSITION_FOLLOWING = 4;

const mountedSpies = new WeakMap<Element, () => void>();

/** Options for {@link mountScrollSpy}. @public */
export interface ScrollSpyOptions {
  /** The nav subtree holding the fragment links. */
  root: Element;
  /** Selector for the links to spy on. */
  linkSelector?: string;
  /** `rootMargin` for the observer — the default biases toward the section at the top of the
   *  viewport rather than the one merely visible. */
  rootMargin?: string;
}

/** One link and the section it points at. */
interface SpyEntry {
  link: Element;
  target: Element;
}

/** Links paired with their targets, ordered by the targets' document position rather than by the
 * nav's markup order, which is free to differ. */
function resolveEntries(root: Element, linkSelector: string): SpyEntry[] {
  const entries: SpyEntry[] = [];
  const seen = new Set<Element>();

  for (const link of root.querySelectorAll(linkSelector)) {
    const href = link.getAttribute("href") ?? "";
    if (!href.startsWith("#")) continue;
    const target = elementById(link, href.slice(1));
    if (!target || seen.has(target)) continue;
    seen.add(target);
    entries.push({ link, target });
  }

  return entries.sort((a, b) => ((a.target.compareDocumentPosition(b.target) & POSITION_FOLLOWING) !== 0 ? -1 : 1));
}

/** Marks the link for the section currently in view with `aria-current="location"` and returns a disposer; idempotent per root. @public */
export function mountScrollSpy(options: ScrollSpyOptions): () => void {
  const noop = () => {};
  const { root, linkSelector = "a[href^='#']", rootMargin = DEFAULT_ROOT_MARGIN } = options;
  if (!root) return noop;

  const existing = mountedSpies.get(root);
  if (existing) return existing;

  const entries = resolveEntries(root, linkSelector);
  if (entries.length === 0) return noop;

  const observerCtor = (ownerWindow(root) as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  if (typeof observerCtor !== "function") return noop;

  const visible = new Set<Element>();

  const apply = () => {
    const active = entries.find((entry) => visible.has(entry.target));
    for (const entry of entries) {
      if (entry === active) entry.link.setAttribute(CURRENT_ATTR, CURRENT_VALUE);
      else entry.link.removeAttribute(CURRENT_ATTR);
    }
  };

  const observer = new observerCtor(
    (records) => {
      for (const record of records) {
        if (record.isIntersecting) visible.add(record.target);
        else visible.delete(record.target);
      }
      apply();
    },
    { rootMargin },
  );

  for (const entry of entries) observer.observe(entry.target);

  const dispose = () => {
    observer.disconnect();
    // The attribute outlives the observer, so a nav re-mounted after a swap would otherwise show
    // two current sections until the first callback lands.
    for (const entry of entries) entry.link.removeAttribute(CURRENT_ATTR);
    mountedSpies.delete(root);
  };

  mountedSpies.set(root, dispose);
  return dispose;
}
