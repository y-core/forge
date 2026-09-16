/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import type { Orientation } from "../contracts/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

interface ScrollAreaRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  orientation?: Orientation | undefined;
  children?: JSXNode | undefined;
}

interface ScrollAreaViewportProps extends Omit<JSX.IntrinsicElements["section"], "children"> {
  // Required: the name is what gives the `<section>` its `region` role, and the viewport is an
  // unconditional tab stop, so an unnamed one announces nothing at all.
  /** Accessible name for the scrollable region. */
  label: string;
  children?: JSXNode | undefined;
}

const ScrollAreaRoot: FC<ScrollAreaRootProps> = ({ orientation = "vertical", class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("scroll-area", inherited)} {...stateAttrs({ orientation })} class={cn("relative", cls)} {...rest}>
    {children}
  </div>
);

const ScrollAreaViewport: FC<ScrollAreaViewportProps> = ({ label, class: cls, children, "data-slot": inherited, ...rest }) => (
  <section
    data-slot={slotToken("scroll-area-viewport", inherited)}
    aria-label={label}
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- WCAG 2.1.1 requires a scrollable region to be a keyboard tab stop; the rule does not model overflow.
    tabindex={0}
    class={cn(
      // `h-full` resolves to `auto` against an indefinite parent, so under a `max-h-*` root only
      // `max-h-[inherit]` stops the viewport growing to its content instead of scrolling.
      "h-full max-h-[inherit] w-full overflow-auto overscroll-contain rounded-[inherit] focus-ring",
      "[scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]",
      cls,
    )}
    {...rest}>
    {children}
  </section>
);

/** A bounded, scrollable region built from CSS alone, with native scrolling retained. @public */
export const ScrollArea = Object.assign(ScrollAreaRoot, { Viewport: ScrollAreaViewport });
