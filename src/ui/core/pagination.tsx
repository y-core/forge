/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { LABEL_DEFAULTS } from "../contracts/labels";
import { currentAttrs } from "../contracts/state-attrs";
import type { Size } from "../contracts/types";
import { buttonVariants } from "./button";
import type { ForgeIcon } from "./types";
import { cloneAsChild, slotToken } from "./utils/as-child";

interface PaginationRootProps extends Omit<JSX.IntrinsicElements["nav"], "children"> {
  label?: string | undefined;
  children?: JSXNode | undefined;
}

interface PaginationItemProps extends Omit<JSX.IntrinsicElements["a"], "children"> {
  current?: boolean | undefined;
  size?: Size | undefined;
  asChild?: boolean | undefined;
  children?: JSXNode | undefined;
}

interface PaginationPreviousProps extends Omit<JSX.IntrinsicElements["a"], "children"> {
  icon: ForgeIcon<"chevron-left">;
  /** Accessible name, rendered `sr-only`. Required: `Icon` is `aria-hidden` and `children` is not. */
  label: string;
  size?: Size | undefined;
  asChild?: boolean | undefined;
  children?: JSXNode | undefined;
}

interface PaginationNextProps extends Omit<JSX.IntrinsicElements["a"], "children"> {
  icon: ForgeIcon<"chevron-right">;
  /** Accessible name, rendered `sr-only`. Required: `Icon` is `aria-hidden` and `children` is not. */
  label: string;
  size?: Size | undefined;
  asChild?: boolean | undefined;
  children?: JSXNode | undefined;
}

interface PaginationEllipsisProps extends Omit<JSX.IntrinsicElements["li"], "children"> {
  /** Accessible name for the gap, rendered `sr-only`. @default LABEL_DEFAULTS.paginationEllipsis */
  label?: string | undefined;
}

const LIST_BASE = "flex items-center gap-1";
const ELLIPSIS_BASE = "inline-flex size-control-sm items-center justify-center";

const PaginationRoot: FC<PaginationRootProps> = ({ label = LABEL_DEFAULTS.pagination, class: cls, children, "data-slot": inherited, ...rest }) => {
  return (
    <nav aria-label={label} data-slot={slotToken("pagination", inherited)} class={cls} {...rest}>
      <ul data-slot='pagination-list' class={LIST_BASE}>
        {children}
      </ul>
    </nav>
  );
};

function linkClass(current: boolean, size: Size, shape: "default" | "icon", cls: string | undefined): string {
  return buttonVariants({ tone: current ? "primary" : "neutral", appearance: current ? "solid" : "ghost", size, shape, class: cls });
}

const PaginationItem: FC<PaginationItemProps> = ({
  current = false,
  size = "sm",
  asChild = false,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => {
  const className = linkClass(current, size, "icon", cls);
  const attrs = { ...currentAttrs(current), ...rest };
  const slot = slotToken("pagination-item", inherited);

  if (asChild) {
    return (
      <li>
        {cloneAsChild(children, {
          slot,
          class: className,
          props: attrs,
          message:
            "Pagination.Item with asChild requires exactly one JSX element child (e.g. <a>); received a string, number, fragment, array, or empty child instead.",
        })}
      </li>
    );
  }

  return (
    <li>
      <a data-slot={slot} class={className} {...attrs}>
        {children}
      </a>
    </li>
  );
};

const PaginationPrevious: FC<PaginationPreviousProps> = ({
  icon: PreviousIcon,
  label,
  size = "sm",
  asChild = false,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => {
  const className = linkClass(false, size, "default", cls);
  const slot = slotToken("pagination-previous", inherited);

  if (asChild) {
    return (
      <li>
        {cloneAsChild(children, {
          slot,
          class: className,
          props: { ...rest },
          prefix: <PreviousIcon name='chevron-left' width={16} height={16} />,
          suffix: <span class='sr-only'>{label}</span>,
          message:
            "Pagination.Previous with asChild requires exactly one JSX element child (e.g. <a>); received a string, number, fragment, array, or empty child instead.",
        })}
      </li>
    );
  }

  return (
    <li>
      <a data-slot={slot} class={className} {...rest}>
        <PreviousIcon name='chevron-left' width={16} height={16} />
        {children}
        <span class='sr-only'>{label}</span>
      </a>
    </li>
  );
};

const PaginationNext: FC<PaginationNextProps> = ({
  icon: NextIcon,
  label,
  size = "sm",
  asChild = false,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => {
  const className = linkClass(false, size, "default", cls);
  const slot = slotToken("pagination-next", inherited);

  if (asChild) {
    return (
      <li>
        {cloneAsChild(children, {
          slot,
          class: className,
          props: { ...rest },
          prefix: <span class='sr-only'>{label}</span>,
          suffix: <NextIcon name='chevron-right' width={16} height={16} />,
          message:
            "Pagination.Next with asChild requires exactly one JSX element child (e.g. <a>); received a string, number, fragment, array, or empty child instead.",
        })}
      </li>
    );
  }

  return (
    <li>
      <a data-slot={slot} class={className} {...rest}>
        {children}
        <span class='sr-only'>{label}</span>
        <NextIcon name='chevron-right' width={16} height={16} />
      </a>
    </li>
  );
};

const PaginationEllipsis: FC<PaginationEllipsisProps> = ({
  label = LABEL_DEFAULTS.paginationEllipsis,
  class: cls,
  "data-slot": inherited,
  ...rest
}) => {
  return (
    <li data-slot={slotToken("pagination-ellipsis", inherited)} class={cls} {...rest}>
      <span aria-hidden='true' class={ELLIPSIS_BASE}>
        …
      </span>
      <span class='sr-only'>{label}</span>
    </li>
  );
};

/** A page-number navigation, with `Item`, `Previous`, `Next`, and `Ellipsis` subcomponents. @public */
export const Pagination = Object.assign(PaginationRoot, {
  Item: PaginationItem,
  Previous: PaginationPrevious,
  Next: PaginationNext,
  Ellipsis: PaginationEllipsis,
});
