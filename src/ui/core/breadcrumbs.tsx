/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { currentAttrs } from "../contracts/state-attrs";
import type { ForgeIcon } from "./icon";
import { cloneAsChild, slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

interface BreadcrumbsRootProps extends Omit<JSX.IntrinsicElements["nav"], "children"> {
  label?: string | undefined;
  children?: JSXNode | undefined;
}

interface BreadcrumbsItemProps extends Omit<JSX.IntrinsicElements["li"], "children"> {
  current?: boolean | undefined;
  children?: JSXNode | undefined;
}

interface BreadcrumbsLinkProps extends Omit<JSX.IntrinsicElements["a"], "children"> {
  asChild?: boolean | undefined;
  children?: JSXNode | undefined;
}

interface BreadcrumbsSeparatorProps extends Omit<JSX.IntrinsicElements["li"], "children"> {
  icon?: ForgeIcon<"chevron-right"> | undefined;
  children?: JSXNode | undefined;
}

const LIST_BASE = "flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground";
const ITEM_BASE = "inline-flex items-center gap-1.5";
const LINK_BASE = "focus-ring rounded-sm hover:text-foreground";

const BreadcrumbsRoot: FC<BreadcrumbsRootProps> = ({ label = "Breadcrumb", class: cls, children, "data-slot": inherited, ...rest }) => {
  return (
    <nav aria-label={label} data-slot={slotToken("breadcrumbs", inherited)} class={cls} {...rest}>
      <ol data-slot='breadcrumbs-list' class={LIST_BASE}>
        {children}
      </ol>
    </nav>
  );
};

const BreadcrumbsItem: FC<BreadcrumbsItemProps> = ({ current = false, class: cls, children, "data-slot": inherited, ...rest }) => (
  <li
    data-slot={slotToken("breadcrumbs-item", inherited)}
    {...currentAttrs(current)}
    class={cn(ITEM_BASE, current && "font-medium text-foreground", cls)}
    {...rest}>
    {children}
  </li>
);

const BreadcrumbsLink: FC<BreadcrumbsLinkProps> = ({ asChild = false, class: cls, children, "data-slot": inherited, ...rest }) => {
  const className = cn(LINK_BASE, cls);
  const slot = slotToken("breadcrumbs-link", inherited);

  if (asChild) {
    return cloneAsChild(children, {
      slot,
      class: className,
      props: { ...rest },
      message:
        "Breadcrumbs.Link with asChild requires exactly one JSX element child (e.g. <a>); received a string, number, fragment, array, or empty child instead.",
    }) as ReturnType<FC<BreadcrumbsLinkProps>>;
  }

  return (
    <a data-slot={slot} class={className} {...rest}>
      {children}
    </a>
  );
};

const BreadcrumbsSeparator: FC<BreadcrumbsSeparatorProps> = ({ icon: SeparatorIcon, class: cls, children, "data-slot": inherited, ...rest }) => {
  return (
    <li role='presentation' aria-hidden='true' data-slot={slotToken("breadcrumbs-separator", inherited)} class={cls} {...rest}>
      {children ?? (SeparatorIcon ? <SeparatorIcon name='chevron-right' width={14} height={14} /> : null)}
    </li>
  );
};

/** A trail of ancestor links, with `Item`, `Link`, and `Separator` subcomponents. @public */
export const Breadcrumbs = Object.assign(BreadcrumbsRoot, { Item: BreadcrumbsItem, Link: BreadcrumbsLink, Separator: BreadcrumbsSeparator });
