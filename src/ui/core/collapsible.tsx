/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import type { ForgeIcon } from "./types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

interface CollapsibleRootProps extends Omit<JSX.IntrinsicElements["details"], "children"> {
  open?: boolean | undefined;
  children?: JSXNode | undefined;
}

interface CollapsibleTriggerProps extends Omit<JSX.IntrinsicElements["summary"], "children"> {
  icon: ForgeIcon<"chevron-down">;
  children?: JSXNode | undefined;
}

interface CollapsibleContentProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode | undefined;
}

const CollapsibleRoot: FC<CollapsibleRootProps> = ({ open = false, class: cls, children, "data-slot": inherited, ...rest }) => (
  <details data-slot={slotToken("collapsible", inherited)} {...(open ? { open } : {})} class={cn("group/collapsible-item", cls)} {...rest}>
    {children}
  </details>
);

const CollapsibleTrigger: FC<CollapsibleTriggerProps> = ({ icon: Icon, class: cls, children, "data-slot": inherited, ...rest }) => (
  <summary
    data-slot={slotToken("collapsible-trigger", inherited)}
    class={cn(
      // `outline-none` is not repeated here: `focus-ring` emits it, and the group key it now owns means
      // a token beside it would survive into the markup rather than being folded away as it once was.
      "flex cursor-pointer list-none items-center gap-2 rounded px-1 py-2 text-sm font-medium select-none",
      "focus-ring hover:bg-muted/40",
      cls,
    )}
    {...rest}>
    <span class='flex-1 ps-1'>{children}</span>
    <Icon
      name='chevron-down'
      viewBox='0 0 24 24'
      class='size-4 shrink-0 text-muted-foreground group-open/collapsible-item:rotate-180 motion-safe:transition-transform motion-safe:duration-200'
    />
  </summary>
);

const CollapsibleContent: FC<CollapsibleContentProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("collapsible-content", inherited)} class={cn("px-1 pb-2 text-sm text-muted-foreground", cls)} {...rest}>
    {children}
  </div>
);

/** Compound disclosure on native `<details>`. @public */
export const Collapsible = Object.assign(CollapsibleRoot, { Trigger: CollapsibleTrigger, Content: CollapsibleContent });
