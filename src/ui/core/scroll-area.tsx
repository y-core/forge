/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { type Orientation, stateAttrs } from "../contracts/state-attrs";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

type ScrollOrientation = Extract<Orientation, "horizontal" | "vertical">;

interface ScrollAreaRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  orientation?: ScrollOrientation;
  children?: JSXNode;
}

interface ScrollAreaViewportProps extends Omit<JSX.IntrinsicElements["section"], "children"> {
  // Required, not optional: the viewport is an unconditional tab stop, and a focusable element with
  // no role and no name announces nothing at all when a keyboard user lands on it. The name is also
  // what gives the `<section>` its `region` role — an unnamed one is a generic box.
  /** Accessible name for the scrollable region. */
  label: string;
  children?: JSXNode;
}

const ScrollAreaRoot: FC<ScrollAreaRootProps> = ({ orientation = "vertical", class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("scroll-area", inherited)} {...stateAttrs({ orientation })} class={cn("relative", asClass(cls))} {...rest}>
    {children}
  </div>
);

const ScrollAreaViewport: FC<ScrollAreaViewportProps> = ({ label, class: cls, children, "data-slot": inherited, ...rest }) => (
  <section
    data-slot={slotToken("scroll-area-viewport", inherited)}
    aria-label={label}
    tabindex={0}
    class={cn(
      // `max-h-[inherit]` is what makes a root bounded by `max-h-*` work: `h-full` resolves to `auto`
      // against an indefinite parent, so the viewport would grow to its content and spill out of the
      // root's max-height box instead of scrolling. Inheriting the computed max-height binds the
      // scrolling element itself. A root bounded by a definite `h-*` computes `max-height: none`,
      // so this is inert there and `h-full` keeps governing.
      "h-full max-h-[inherit] w-full overflow-auto overscroll-contain rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "[scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]",
      asClass(cls),
    )}
    {...rest}>
    {children}
  </section>
);

/** A bounded, scrollable region built from CSS alone, with native scrolling retained. @public */
export const ScrollArea = Object.assign(ScrollAreaRoot, { Viewport: ScrollAreaViewport });
