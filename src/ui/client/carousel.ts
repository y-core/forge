import { applyStateAttrs, STATE_ATTRS } from "../contracts/state-attrs";
import { type FragmentEntry, mountFragmentObserver } from "./fragment-observer";

/** The marker `Carousel.Dots` renders on the current dot, matching `Pagination.Item current`. */
const CURRENT_ATTR = "aria-current";
const CURRENT_VALUE = "page";

const STRIP_SELECTOR = "[data-slot~='carousel-strip']";
const DEFAULT_DOT_SELECTOR = "a[href^='#']";

/** Enough steps that the strip's most-visible slide is distinguishable mid-scroll, not just at rest. */
const THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];

const mountedDots = new WeakMap<Element, () => void>();

/** Options for {@link mountCarouselDots}. @public */
export interface CarouselDotsOptions {
  /** The `Carousel.Dots` nav whose anchors point at the slides. */
  root: Element;
  /** Selector for the dots to drive. */
  dotSelector?: string;
}

/** Marks the dot for the slide showing in the strip and returns a disposer; idempotent per nav. @public */
export function mountCarouselDots(options: CarouselDotsOptions): () => void {
  const { root, dotSelector = DEFAULT_DOT_SELECTOR } = options;

  return mountFragmentObserver({
    root,
    selector: dotSelector,
    fn: "mountCarouselDots",
    label: "carousel-dots",
    requires: "pass the nav rendered by `Carousel.Dots`",
    emptyTarget: "a slide",
    degraded: "the dots will not follow the strip",
    mounted: mountedDots,
    plan: (entries: FragmentEntry[]) => {
      const strip = entries[0]?.target.closest(STRIP_SELECTOR) ?? null;
      if (!strip) {
        console.warn("[carousel-dots] the dots resolve to slides outside any carousel strip; the dots will not follow the strip");
        return null;
      }

      // The selected look is baked into utility classes by `Pagination.Item`'s variants, so both
      // spellings are lifted off the server-rendered row rather than restated here — a theme, a size or
      // a caller class changes them, and this controller must not be the second place they are written.
      const on = entries.find((entry) => entry.link.hasAttribute(STATE_ATTRS.selected))?.link.getAttribute("class");
      const off = entries.find((entry) => !entry.link.hasAttribute(STATE_ATTRS.selected))?.link.getAttribute("class");
      // Without a marked dot there is no `on` string to lift, so every class write below is skipped while
      // the attributes still move — the row settles unselected forever, and silently, which is the one
      // failure mode here that said nothing. `Carousel.Dots` clamps `current`, so this reports markup it
      // did not render, exactly as the two checks above do.
      if (on === undefined || on === null) {
        console.warn(
          `[carousel-dots] no dot carries ${STATE_ATTRS.selected}, so the selected paint cannot be read off the row; the dots will not be marked`,
        );
        return null;
      }

      const mark = (entry: FragmentEntry, current: boolean) => {
        const cls = current ? on : off;
        if (current) entry.link.setAttribute(CURRENT_ATTR, CURRENT_VALUE);
        else entry.link.removeAttribute(CURRENT_ATTR);
        // `forge-ui-a11y-state-attrs-source`: the contract owns the spelling, so this is the only place
        // in `ui/client` that used to write one by hand.
        applyStateAttrs(entry.link, { selected: current });
        // A single-slide carousel has no unselected dot to lift `off` from, and nothing to clear either.
        if (cls !== null && cls !== undefined) entry.link.setAttribute("class", cls);
      };

      const ratios = new Map<Element, number>();

      const apply = () => {
        let best: FragmentEntry | undefined;
        let bestRatio = 0;
        for (const entry of entries) {
          const ratio = ratios.get(entry.target) ?? 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = entry;
          }
        }
        // Mid-flick every slide can be below the first threshold; the last marking is the truthful one to
        // keep, and blanking the row would flicker the highlight off on every scroll.
        if (!best) return;
        for (const entry of entries) mark(entry, entry === best);
      };

      return {
        init: { root: strip, threshold: THRESHOLDS },
        onRecords: (records) => {
          for (const record of records) ratios.set(record.target, record.intersectionRatio);
          apply();
        },
      };
    },
  });
}
