/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { ACTIVE_COMPOSITE_ITEM } from "../contracts/composite-contract";
import { type Orientation, stateAttrs } from "../contracts/state-attrs";
import { TOOLBAR_ITEM_ATTR, TOOLBAR_SCOPE } from "../contracts/toolbar-contract";
import { type ButtonProps, buttonVariants } from "./button";
import { cloneAsChild, slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

type ToolbarOrientation = Extract<Orientation, "horizontal" | "vertical">;

interface ToolbarItemStyling {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  pressed?: boolean;
  asChild?: boolean;
}

interface ToolbarRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  orientation?: ToolbarOrientation;
  children?: JSXNode;
}

interface ToolbarButtonProps extends Omit<JSX.IntrinsicElements["button"], "children">, ToolbarItemStyling {
  children?: JSXNode;
}

interface ToolbarLinkProps extends Omit<JSX.IntrinsicElements["a"], "children">, ToolbarItemStyling {
  children?: JSXNode;
}

type ToolbarInputProps = Omit<JSX.IntrinsicElements["input"], "children">;

interface ToolbarGroupProps extends Omit<JSX.IntrinsicElements["fieldset"], "children"> {
  children?: JSXNode;
}

interface ToolbarSeparatorProps extends Omit<JSX.IntrinsicElements["hr"], "children"> {
  orientation?: ToolbarOrientation;
}

const ROOT_BASE = "flex items-center gap-1";

function itemAttrs(pressed: boolean | undefined): Record<string, string> {
  return {
    [TOOLBAR_ITEM_ATTR]: "",
    ...(pressed === undefined ? {} : { "aria-pressed": String(pressed), ...stateAttrs({ pressed }) }),
    ...(pressed ? { [ACTIVE_COMPOSITE_ITEM]: "" } : {}),
  };
}

/** Toolbar container, stamping the resumable scope that mounts roving focus. */
const ToolbarRoot: FC<ToolbarRootProps> = ({ orientation = "horizontal", class: cls, children, "data-slot": inherited, ...rest }) => (
  <div
    role='toolbar'
    data-slot={slotToken("toolbar", inherited)}
    data-scope={TOOLBAR_SCOPE}
    {...stateAttrs({ orientation })}
    aria-orientation={orientation}
    class={cn(ROOT_BASE, orientation === "vertical" && "flex-col", asClass(cls))}
    {...rest}>
    {children}
  </div>
);

function itemClass(styling: ToolbarItemStyling, cls: unknown, extra?: string): string {
  const own = cn(extra, asClass(cls));
  return buttonVariants({ variant: styling.variant ?? "ghost", size: styling.size ?? "sm", ...(own ? { class: own } : {}) });
}

/** A button inside a toolbar, carrying the roving-focus marker. */
const ToolbarButton: FC<ToolbarButtonProps> = ({
  variant,
  size,
  pressed,
  asChild = false,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => {
  const className = itemClass({ variant, size }, cls);
  const attrs = { ...itemAttrs(pressed), ...rest };
  const slot = slotToken("toolbar-button", inherited);

  if (asChild) {
    return cloneAsChild(children, {
      slot,
      class: className,
      props: attrs,
      type: "button",
      ...(typeof rest.disabled === "boolean" ? { disabled: rest.disabled } : {}),
      message:
        "Toolbar.Button with asChild requires exactly one JSX element child (e.g. <a> or <button>); received a string, number, fragment, array, or empty child instead.",
    }) as ReturnType<FC<ToolbarButtonProps>>;
  }

  return (
    <button type='button' data-slot={slot} class={className} {...attrs}>
      {children}
    </button>
  );
};

/** A link inside a toolbar — a focus stop like any other item. */
const ToolbarLink: FC<ToolbarLinkProps> = ({ variant, size, pressed, asChild = false, class: cls, children, "data-slot": inherited, ...rest }) => {
  const className = itemClass({ variant, size }, cls, "underline-offset-4 hover:underline");
  const attrs = { ...itemAttrs(pressed), ...rest };
  const slot = slotToken("toolbar-link", inherited);

  if (asChild) {
    return cloneAsChild(children, {
      slot,
      class: className,
      props: attrs,
      message:
        "Toolbar.Link with asChild requires exactly one JSX element child (e.g. <a> or <button>); received a string, number, fragment, array, or empty child instead.",
    }) as ReturnType<FC<ToolbarLinkProps>>;
  }

  return (
    <a data-slot={slot} class={className} {...attrs}>
      {children}
    </a>
  );
};

/** A text field inside a toolbar. */
const ToolbarInput: FC<ToolbarInputProps> = ({ class: cls, "data-slot": inherited, ...rest }) => (
  <input
    data-slot={slotToken("toolbar-input", inherited)}
    {...itemAttrs(undefined)}
    class={cn(
      "rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground",
      "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      asClass(cls),
    )}
    {...rest}
  />
);

/** Groups related items inside a toolbar. */
const ToolbarGroup: FC<ToolbarGroupProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <fieldset data-slot={slotToken("toolbar-group", inherited)} class={cn("inline-flex items-center gap-1 border-0 m-0 p-0", asClass(cls))} {...rest}>
    {children}
  </fieldset>
);

/** A divider between toolbar sections. Defaults to the axis across the toolbar. */
const ToolbarSeparator: FC<ToolbarSeparatorProps> = ({ orientation = "vertical", class: cls, "data-slot": inherited, ...rest }) => (
  <hr
    data-slot={slotToken("toolbar-separator", inherited)}
    aria-orientation={orientation}
    class={cn(orientation === "vertical" ? "h-5 w-px" : "h-px w-full", "border-0 bg-border", asClass(cls))}
    {...rest}
  />
);

/** Compound toolbar: a single Tab stop whose items are reached with the arrow keys, Home and End. @public */
export const Toolbar = Object.assign(ToolbarRoot, {
  Button: ToolbarButton,
  Link: ToolbarLink,
  Input: ToolbarInput,
  Group: ToolbarGroup,
  Separator: ToolbarSeparator,
});
