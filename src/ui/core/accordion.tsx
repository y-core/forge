/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXElement, JSXNode } from "../../jsx/types";
import type { ForgeIcon } from "./types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

interface AccordionRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode | undefined;
}

interface AccordionItemProps extends Omit<JSX.IntrinsicElements["details"], "children"> {
  children?: JSXNode | undefined;
}

interface AccordionTriggerProps<N extends string = string> extends Omit<JSX.IntrinsicElements["summary"], "children"> {
  icon: ForgeIcon<N | "chevron-down">;
  iconName?: N | undefined;
  children?: JSXNode | undefined;
}

interface AccordionContentProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  hint?: string | undefined;
  children?: JSXNode | undefined;
}

const AccordionRoot: FC<AccordionRootProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("accordion", inherited)} class={cn("flex flex-col", cls)} {...rest}>
    {children}
  </div>
);

const AccordionItem: FC<AccordionItemProps> = ({ open, class: cls, children, "data-slot": inherited, ...props }) => (
  <details
    data-slot={slotToken("accordion-item", inherited)}
    {...(open ? { open } : {})}
    class={cn("group/accordion-item border-b border-border last:border-b-0", cls)}
    {...props}>
    {children}
  </details>
);

const AccordionTrigger = <N extends string = string>({
  icon: Icon,
  iconName,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}: AccordionTriggerProps<N>): JSXElement => (
  <summary
    data-slot={slotToken("accordion-trigger", inherited)}
    class={cn(
      "flex cursor-pointer list-none items-center gap-2 rounded px-1 py-2 text-sm font-medium focus-ring select-none hover:bg-muted/40",
      cls,
    )}
    {...rest}>
    {iconName ? <Icon name={iconName} viewBox='0 0 24 24' class='size-4 shrink-0 text-muted-foreground' /> : null}
    <span class='flex-1 ps-1'>{children}</span>
    <Icon
      name='chevron-down'
      viewBox='0 0 24 24'
      class='size-4 shrink-0 text-muted-foreground group-open/accordion-item:rotate-180 motion-safe:transition-transform motion-safe:duration-200'
    />
  </summary>
);

const AccordionContent: FC<AccordionContentProps> = ({ hint, class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("accordion-content", inherited)} class={cn("px-1 pt-1 pb-3", cls)} {...rest}>
    {hint ? <p class='mb-2 text-xs text-muted-foreground'>{hint}</p> : null}
    {children}
  </div>
);

/** A native `<details>`-based disclosure group, exclusive-open when sibling items share a `name`. @public */
export const Accordion = Object.assign(AccordionRoot, { Item: AccordionItem, Trigger: AccordionTrigger, Content: AccordionContent });
