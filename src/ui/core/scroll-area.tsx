/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { type Orientation, stateAttrs } from "../contracts/state-attrs";
import { asClass, cn } from "./utils/cn";

type ScrollOrientation = Extract<Orientation, "horizontal" | "vertical">;

interface ScrollAreaRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  orientation?: ScrollOrientation;
  children?: JSXNode;
}

interface ScrollAreaViewportProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode;
}

const ScrollAreaRoot: FC<ScrollAreaRootProps> = ({ orientation = "vertical", class: cls, children, ...rest }) => (
  <div data-slot='scroll-area' {...stateAttrs({ orientation })} class={cn("relative", asClass(cls))} {...rest}>
    {children}
  </div>
);

/**
 * The scrolling element. `overflow` and `overscroll-behavior` are the whole mechanism — the
 * scrollbar is the UA's, keyboard scrolling is the UA's, momentum and rubber-banding are the UA's.
 *
 * `tabindex={0}` is not decoration: a scrollable region that cannot be focused cannot be scrolled
 * with the keyboard at all, which is the accessibility failure custom scroll areas are notorious for.
 */
const ScrollAreaViewport: FC<ScrollAreaViewportProps> = ({ class: cls, children, ...rest }) => (
  <div
    data-slot='scroll-area-viewport'
    tabindex={0}
    class={cn(
      "h-full w-full overflow-auto overscroll-contain rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "[scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]",
      asClass(cls),
    )}
    {...rest}>
    {children}
  </div>
);

/**
 * A bounded, scrollable region — **CSS only, with native scrolling retained**.
 *
 * There is deliberately no scroll listener, no `scrollTop` arithmetic, no wheel interception and no
 * custom scrollbar element anywhere in this file. A scroll area that stops scrolling when JavaScript
 * fails is a worse scroll area than a `<div>` with `overflow: auto`; styling the UA scrollbar with
 * `scrollbar-width` and `scrollbar-color` gets the appearance without giving up the behaviour.
 *
 * ```tsx
 * <ScrollArea class='h-48 w-64 rounded-md border border-border'>
 *   <ScrollArea.Viewport>…</ScrollArea.Viewport>
 * </ScrollArea>
 * ```
 * @public
 */
export const ScrollArea = Object.assign(ScrollAreaRoot, { Viewport: ScrollAreaViewport });
