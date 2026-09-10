import { mountFragmentObserver } from "./fragment-observer";
import type { FragmentEntry } from "./types";
import type { ScrollSpyOptions } from "./types";

/** The marker. `"location"` and never `"page"`: the page has not changed — the reader moved within
 *  it — and `"page"` would announce a navigation that never happened. */
const CURRENT_ATTR = "aria-current";
const CURRENT_VALUE = "location";

/** Biases toward the section at the top of the viewport rather than the one merely visible: the
 *  bottom inset shrinks the observation band to the top slice of the viewport, so a long section
 *  scrolling away stops being "current" as soon as its successor reaches the top. */
const DEFAULT_ROOT_MARGIN = "0px 0px -70% 0px";

const mountedSpies = new WeakMap<Element, () => void>();

/** Marks the link for the section currently in view with `aria-current="location"` and returns a disposer; idempotent per root. @public */
export function mountScrollSpy(options: ScrollSpyOptions): () => void {
  const { root, linkSelector = "a[href^='#']", rootMargin = DEFAULT_ROOT_MARGIN } = options;

  return mountFragmentObserver({
    root,
    selector: linkSelector,
    fn: "mountScrollSpy",
    label: "scroll-spy",
    requires: "pass the nav subtree holding the fragment links",
    emptyTarget: "an element",
    degraded: "links will not be marked current",
    mounted: mountedSpies,
    plan: (entries: FragmentEntry[]) => {
      const visible = new Set<Element>();

      const apply = () => {
        const active = entries.find((entry) => visible.has(entry.target));
        for (const entry of entries) {
          if (entry === active) entry.link.setAttribute(CURRENT_ATTR, CURRENT_VALUE);
          else entry.link.removeAttribute(CURRENT_ATTR);
        }
      };

      return {
        init: { rootMargin },
        onRecords: (records) => {
          for (const record of records) {
            if (record.isIntersecting) visible.add(record.target);
            else visible.delete(record.target);
          }
          apply();
        },
        // The attribute outlives the observer, so a nav re-mounted after a swap would otherwise show
        // two current sections until the first callback lands.
        cleanup: () => {
          for (const entry of entries) entry.link.removeAttribute(CURRENT_ATTR);
        },
      };
    },
  });
}
