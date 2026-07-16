/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { asClass, cn } from "./utils/cn";

interface PopoverProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode;
}

type PopoverAlign = "start" | "center" | "end";
type PopoverSide = "bottom" | "top";

interface PopoverTriggerProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the `Popover.Content` this trigger toggles — its `commandfor` target. */
  id: string;
  children?: JSXNode;
}

interface PopoverContentProps {
  /** Element id — the `commandfor` target named by the matching `Popover.Trigger`. */
  id: string;
  align?: PopoverAlign;
  side?: PopoverSide;
  class?: string;
  children?: JSXNode;
}

const PopoverRoot: FC<PopoverProps> = ({ class: cls, children, ...props }) => (
  <div data-slot='popover' class={cn("relative inline-block", asClass(cls))} {...props}>
    {children}
  </div>
);

const PopoverTrigger: FC<PopoverTriggerProps> = ({ id, class: cls, children, ...props }) => (
  <button
    type='button'
    data-slot='popover-trigger'
    command='toggle-popover'
    commandfor={id}
    class={cn("list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring", asClass(cls))}
    {...props}>
    {children}
  </button>
);

/**
 * Popover panel. Rendered natively via the Popover API (`popover="auto"`): it lives in the top
 * layer with free light-dismiss (outside-click + Esc) and exclusive-open against sibling auto
 * popovers — no JavaScript. Placement (`align`/`side`) is applied by static CSS anchored to the
 * invoker (the popover's implicit anchor); the data attributes select the rule.
 */
const PopoverContent: FC<PopoverContentProps> = ({ id, align = "start", side = "bottom", class: cls, children }) => (
  <div
    id={id}
    data-slot='popover-content'
    popover='auto'
    data-align={align}
    data-side={side}
    class={cn("z-50 min-w-[8rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md", cls)}>
    {children}
  </div>
);

/**
 * Compound popover built on the native Popover + Invoker Commands APIs. The trigger is a
 * `<button command="toggle-popover" commandfor={id}>` and the content is a `<div popover="auto"
 * id={id}>`; the shared `id` links them. Open/close, top-layer stacking, and light-dismiss are all
 * handled by the platform — zero client JavaScript.
 *
 * ```tsx
 * <Popover>
 *   <Popover.Trigger id="menu-file">File</Popover.Trigger>
 *   <Popover.Content id="menu-file">…</Popover.Content>
 * </Popover>
 * ```
 *
 * @public
 */
export const Popover = Object.assign(PopoverRoot, { Trigger: PopoverTrigger, Content: PopoverContent });
