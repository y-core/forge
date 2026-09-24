import { ownerDocument, ownerWindow } from "./dom";
import { mountFragmentObserver } from "./fragment-observer";
import type { FragmentEntry } from "./types";
import type { ScrollSpyOptions } from "./types";

/** The marker: `"location"` and never `"page"`, since the reader moved within a page that never navigated. */
const CURRENT_ATTR = "aria-current";
const CURRENT_VALUE = "location";

/** Biases toward the section at the top of the viewport: the bottom inset shrinks the band to the top slice. */
const BAND_BOTTOM_INSET = "-70%";

/** An edge-adjacent box counts as intersecting, so the band opens one pixel below the offset line. */
const EDGE_PX = 1;

const mountedSpies = new WeakMap<Element, () => void>();

function offsetLine(root: Element, entries: FragmentEntry[]): number {
  const view = ownerWindow(root);
  const doc = ownerDocument(root);
  const declared = view.getComputedStyle(doc.documentElement).scrollPaddingTop;
  const viewportHeight = (doc.scrollingElement ?? doc.documentElement).clientHeight;
  const padding = declared.endsWith("%") ? (parseFloat(declared) / 100) * viewportHeight : parseFloat(declared) || 0;
  const margin = Math.max(...entries.map((entry) => parseFloat(view.getComputedStyle(entry.target).scrollMarginTop) || 0));
  return padding + margin;
}

/** Marks the link for the section currently in view with `aria-current="location"` and returns a disposer; idempotent per root. @public */
export function mountScrollSpy(options: ScrollSpyOptions): () => void {
  const { root, linkSelector = "a[href^='#']", rootMargin } = options;

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
        init: { rootMargin: rootMargin ?? `${-(offsetLine(root, entries) + EDGE_PX)}px 0px ${BAND_BOTTOM_INSET} 0px` },
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
