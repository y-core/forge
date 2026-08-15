/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import type { ForgeIcon } from "./icon";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

interface CollapsibleRootProps extends Omit<JSX.IntrinsicElements["details"], "children"> {
  open?: boolean;
  children?: JSXNode;
}

interface CollapsibleTriggerProps extends Omit<JSX.IntrinsicElements["summary"], "children"> {
  icon: ForgeIcon<"chevron-down">;
  children?: JSXNode;
}

interface CollapsiblePanelProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode;
}

const CollapsibleRoot: FC<CollapsibleRootProps> = ({ open = false, class: cls, children, "data-slot": inherited, ...rest }) => (
  <details data-slot={slotToken("collapsible", inherited)} {...(open ? { open } : {})} class={cn("group/collapsible-item", asClass(cls))} {...rest}>
    {children}
  </details>
);

const CollapsibleTrigger: FC<CollapsibleTriggerProps> = ({ icon: Icon, class: cls, children, "data-slot": inherited, ...rest }) => (
  <summary
    data-slot={slotToken("collapsible-trigger", inherited)}
    class={cn(
      "flex cursor-pointer list-none select-none items-center gap-2 rounded px-1 py-2 text-sm font-medium outline-none",
      "hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring",
      asClass(cls),
    )}
    {...rest}>
    <span class='flex-1 ps-1'>{children}</span>
    <Icon
      name='chevron-down'
      viewBox='0 0 24 24'
      class='size-4 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:duration-200 group-open/collapsible-item:rotate-180'
    />
  </summary>
);

const CollapsiblePanel: FC<CollapsiblePanelProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("collapsible-panel", inherited)} class={cn("px-1 pb-2 text-sm text-muted-foreground", asClass(cls))} {...rest}>
    {children}
  </div>
);

/** Compound disclosure on native `<details>`. @public */
export const Collapsible = Object.assign(CollapsibleRoot, { Trigger: CollapsibleTrigger, Panel: CollapsiblePanel });
