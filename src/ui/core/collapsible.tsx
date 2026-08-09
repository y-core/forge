/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import { COLLAPSIBLE_SCOPE } from "../contracts/toggle-contract";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

interface CollapsibleRootProps extends Omit<JSX.IntrinsicElements["details"], "children"> {
  open?: boolean;
  children?: JSXNode;
}

interface CollapsibleTriggerProps extends Omit<JSX.IntrinsicElements["summary"], "children"> {
  children?: JSXNode;
}

interface CollapsiblePanelProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode;
}

/**
 * A disclosure, on native `<details>` / `<summary>`.
 *
 * Open and closed are the element's own — there is no state machine here, no `hidden` toggling and
 * no height animation in JavaScript. The `data-open` / `data-closed` pair is maintained by A5's
 * `mountTransitionState`, which observes the `toggle` event `<details>` already fires, so an exit
 * animation is a stylesheet's business rather than this component's.
 *
 * `core/accordion.tsx` makes the same platform bet at multi-item granularity and shares this markup;
 * the two are deliberately the same shape rather than two disclosure implementations.
 */
const CollapsibleRoot: FC<CollapsibleRootProps> = ({ open = false, class: cls, children, "data-slot": inherited, ...rest }) => (
  <details
    data-slot={slotToken("collapsible", inherited)}
    data-scope={COLLAPSIBLE_SCOPE}
    {...(open ? { open } : {})}
    {...stateAttrs({ open })}
    class={cn("group/collapsible", asClass(cls))}
    {...rest}>
    {children}
  </details>
);

const CollapsibleTrigger: FC<CollapsibleTriggerProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <summary
    data-slot={slotToken("collapsible-trigger", inherited)}
    class={cn(
      "flex cursor-pointer list-none select-none items-center gap-2 rounded px-1 py-2 text-sm font-medium outline-none",
      "hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring",
      asClass(cls),
    )}
    {...rest}>
    {children}
  </summary>
);

const CollapsiblePanel: FC<CollapsiblePanelProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("collapsible-panel", inherited)} class={cn("px-1 pb-2 text-sm text-muted-foreground", asClass(cls))} {...rest}>
    {children}
  </div>
);

/**
 * Compound disclosure on native `<details>`.
 *
 * ```tsx
 * <Collapsible>
 *   <Collapsible.Trigger>Advanced</Collapsible.Trigger>
 *   <Collapsible.Panel>…</Collapsible.Panel>
 * </Collapsible>
 * ```
 * @public
 */
export const Collapsible = Object.assign(CollapsibleRoot, { Trigger: CollapsibleTrigger, Panel: CollapsiblePanel });
