import { elementById, ownerWindow } from "./dom";

/**
 * Scroll spy — the runtime half of "the current destination is indicated on every page".
 *
 * A fragment nav (an on-page table of contents, a docs sidebar) has no navigation to hang the
 * current marker off: the URL does not change as the reader scrolls, so nothing server-side can say
 * which entry is current. This watches the sections the links point at and stamps the one being
 * read.
 *
 * It emits **only** the ARIA attribute. The visible cue is the stylesheet's, selected from
 * `aria-current` directly, so there is no parallel `data-*` state to keep in step.
 */

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

/**
 * Links paired with their targets, ordered by the **targets'** document position.
 *
 * The order has to come from the sections rather than from the markup, because "the section being
 * read" is a question about the page, and a nav is free to list its links in any order it likes.
 * Ids are resolved in the tree that declares them, so a nav inside a shadow root finds its own
 * sections; a link that resolves to nothing is skipped, since a fragment can point anywhere.
 */
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

/**
 * Marks the link for the section currently in view with `aria-current="location"`, and returns a
 * disposer. Idempotent per root.
 *
 * Fails quiet in every direction: no links, no resolvable targets, or no `IntersectionObserver`
 * yields a no-op disposer. The links are real anchors that navigate on their own, so the page is
 * never worse than unmarked.
 * @public
 */
export function mountScrollSpy(options: ScrollSpyOptions): () => void {
  const noop = () => {};
  const { root, linkSelector = "a[href^='#']", rootMargin = DEFAULT_ROOT_MARGIN } = options;
  if (!root) return noop;

  const existing = mountedSpies.get(root);
  if (existing) return existing;

  const entries = resolveEntries(root, linkSelector);
  if (entries.length === 0) return noop;

  // From the root's own realm, which is also what answers "does this browser have one at all".
  const observerCtor = (ownerWindow(root) as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  if (typeof observerCtor !== "function") return noop;

  const visible = new Set<Element>();

  // Exactly one link carries the marker, or none while nothing intersects — so the stamp is always
  // rewritten from the whole set rather than moved from the previous holder.
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
    // A torn-down spy must leave no stale marker: the attribute outlives the observer otherwise, and
    // a nav re-mounted after a swap would show two current sections until the first callback lands.
    for (const entry of entries) entry.link.removeAttribute(CURRENT_ATTR);
    mountedSpies.delete(root);
  };

  mountedSpies.set(root, dispose);
  return dispose;
}
