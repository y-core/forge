/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import type { Size } from "../contracts/types";
import { Pagination } from "./pagination";
import type { CarouselSnap } from "./types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

interface CarouselRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  snap?: CarouselSnap | undefined;
  /** Accessible name; with it the root announces itself as a carousel, without it as a plain region of slides. */
  label?: string | undefined;
  /** Accessible name for the scrolling strip itself, which is a keyboard tab stop. @default the root's `label`, else `"Slides"` */
  stripLabel?: string | undefined;
  children?: JSXNode | undefined;
}

interface CarouselItemProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  snap?: CarouselSnap | undefined;
  /** Accessible name; with it the slide announces itself as a slide, without it as a plain group. */
  label?: string | undefined;
  children?: JSXNode | undefined;
}

interface CarouselDotsProps extends Omit<JSX.IntrinsicElements["nav"], "children"> {
  /** The `id` of each item, in strip order — every dot is an anchor to one. */
  ids: readonly string[];
  /** Zero-based index of the item on show. */
  current?: number | undefined;
  size?: Size | undefined;
  label?: string | undefined;
}

// `scroll-smooth` sits under `motion-safe:` so a reader who asked for no motion gets an instant jump
// from a dot, which is also what the browser spec reads.
const STRIP = "flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain rounded-box [scrollbar-width:thin] motion-safe:scroll-smooth";
const ITEM = "w-full shrink-0";
const SNAP: Record<CarouselSnap, string> = { start: "snap-start", center: "snap-center" };

const CarouselRoot: FC<CarouselRootProps> = ({ snap = "start", label, stripLabel, class: cls, children, "data-slot": inherited, ...rest }) => (
  <div
    data-slot={slotToken("carousel", inherited)}
    data-snap={snap}
    {...(label !== undefined ? { "aria-roledescription": "carousel", "aria-label": label } : {})}
    class={cn("relative", cls)}
    {...rest}>
    {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- WCAG 2.1.1 requires a scrollable region to be a keyboard tab stop; the rule does not model overflow. */}
    <div data-slot='carousel-strip' role='group' aria-label={stripLabel ?? label ?? "Slides"} tabindex={0} class={STRIP}>
      {children}
    </div>
  </div>
);

// A dot is a real fragment link, so the browser scrolls the *document* to the slide as well as the
// strip — a page with fixed chrome above the carousel needs `scroll-margin-top` here to say where the
// slide lands. Forge ships none: the offset is the app's chrome, not the component's.
const CarouselItem: FC<CarouselItemProps> = ({ snap = "start", label, class: cls, children, "data-slot": inherited, ...rest }) => (
  <div
    data-slot={slotToken("carousel-item", inherited)}
    role='group'
    // All-or-nothing, mirroring the root: `aria-roledescription` renames a role a reader is then
    // told nothing else about, so an unnamed slide stays a plain group rather than an anonymous one.
    {...(label !== undefined ? { "aria-roledescription": "slide", "aria-label": label } : {})}
    class={cn(ITEM, SNAP[snap], cls)}
    {...rest}>
    {children}
  </div>
);

// `current` is a public `number`, so a caller can hand over an index no slide has. Left unclamped it
// marks no dot at all, and the controller then has no selected paint to lift off the row — the one
// failure mode in this component that said nothing. Exactly one dot is always marked.
function currentIndex(current: number, count: number): number {
  if (!Number.isFinite(current) || count === 0) return 0;
  return Math.min(Math.max(Math.trunc(current), 0), count - 1);
}

const CarouselDots: FC<CarouselDotsProps> = ({ ids, current = 0, size = "sm", label = "Slides", class: cls, "data-slot": inherited, ...rest }) => (
  <Pagination label={label} data-slot={slotToken("carousel-dots", inherited)} class={cn("mt-3 flex justify-center", cls)} {...rest}>
    {ids.map((id, index) => (
      <Pagination.Item href={`#${id}`} current={index === currentIndex(current, ids.length)} size={size} aria-label={`Slide ${index + 1}`}>
        {index + 1}
      </Pagination.Item>
    ))}
  </Pagination>
);

/** A scroll-snap strip of `Item` slides the platform scrolls, with an anchor-driven `Dots` row. @public */
export const Carousel = Object.assign(CarouselRoot, { Item: CarouselItem, Dots: CarouselDots });
