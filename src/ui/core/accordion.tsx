/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import { ACCORDION_SCOPE } from "../contracts/toggle-contract";
import type { ForgeIcon } from "./icon";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

interface AccordionRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode;
}

interface AccordionItemProps extends Omit<JSX.IntrinsicElements["details"], "children"> {
  children?: JSXNode;
}

interface AccordionTriggerProps extends Omit<JSX.IntrinsicElements["summary"], "children"> {
  icon: ForgeIcon;
  iconName?: string;
  children?: JSXNode;
}

interface AccordionContentProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  hint?: string;
  children?: JSXNode;
}

const AccordionRoot: FC<AccordionRootProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("accordion", inherited)} class={cn("flex flex-col", asClass(cls))} {...rest}>
    {children}
  </div>
);

const AccordionItem: FC<AccordionItemProps> = ({ open, class: cls, children, "data-slot": inherited, ...props }) => (
  <details
    data-slot={slotToken("accordion-item", inherited)}
    data-scope={ACCORDION_SCOPE}
    {...(open ? { open } : {})}
    {...stateAttrs({ open: open === true })}
    class={cn("group/accordion-item border-b border-border last:border-b-0", asClass(cls))}
    {...props}>
    {children}
  </details>
);

const AccordionTrigger: FC<AccordionTriggerProps> = ({ icon: Icon, iconName, class: cls, children, "data-slot": inherited, ...rest }) => (
  <summary
    data-slot={slotToken("accordion-trigger", inherited)}
    class={cn(
      "flex items-center gap-2 cursor-pointer list-none select-none py-2 px-1 rounded text-sm font-medium outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring",
      asClass(cls),
    )}
    {...rest}>
    {iconName ? <Icon name={iconName} viewBox='0 0 24 24' class='size-4 shrink-0 text-muted-foreground' /> : null}
    <span class='flex-1 pl-1'>{children}</span>
    <Icon
      name='chevron-down'
      viewBox='0 0 24 24'
      class='size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open/accordion-item:rotate-180'
    />
  </summary>
);

const AccordionContent: FC<AccordionContentProps> = ({ hint, class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("accordion-content", inherited)} class={cn("px-1 pb-3 pt-1", asClass(cls))} {...rest}>
    {hint ? <p class='mb-2 text-xs text-muted-foreground'>{hint}</p> : null}
    {children}
  </div>
);

/** A native `<details>`-based disclosure group, exclusive-open when sibling items share a `name`. @public */
export const Accordion = Object.assign(AccordionRoot, { Item: AccordionItem, Trigger: AccordionTrigger, Content: AccordionContent });
