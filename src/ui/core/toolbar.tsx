/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { type Orientation, stateAttrs } from "../contracts/state-attrs";
import { TOOLBAR_ITEM_ATTR, TOOLBAR_SCOPE } from "../contracts/toolbar-contract";
import { type ButtonProps, buttonVariants } from "./button";
import { cloneAsChild, slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { RULE } from "./utils/recipes";

interface ToolbarItemStyling {
  tone?: ButtonProps["tone"] | undefined;
  appearance?: ButtonProps["appearance"] | undefined;
  size?: ButtonProps["size"] | undefined;
  shape?: ButtonProps["shape"] | undefined;
  pressed?: boolean | undefined;
  asChild?: boolean | undefined;
}

interface ToolbarRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  orientation?: Orientation | undefined;
  children?: JSXNode | undefined;
}

interface ToolbarButtonProps extends Omit<JSX.IntrinsicElements["button"], "children">, ToolbarItemStyling {
  children?: JSXNode | undefined;
}

interface ToolbarLinkProps extends Omit<JSX.IntrinsicElements["a"], "children">, ToolbarItemStyling {
  children?: JSXNode | undefined;
}

type ToolbarInputProps = Omit<JSX.IntrinsicElements["input"], "children">;

interface ToolbarGroupProps extends Omit<JSX.IntrinsicElements["fieldset"], "children"> {
  children?: JSXNode | undefined;
}

interface ToolbarSeparatorProps extends Omit<JSX.IntrinsicElements["hr"], "children"> {
  orientation?: Orientation | undefined;
}

const ROOT_BASE = "flex items-center gap-1";

// The roving-tab-stop marker is deliberately *not* derived from `pressed`. It marks the one item holding
// the roving tab stop, and a toolbar may have several pressed items at once — `composite.ts` takes the
// first match and silently ignores the rest, so Bold and Italic both pressed handed the tab stop to
// Bold and left the app no way to override it. No default is stamped either: `initialIndex` already
// falls back to the first enabled item when nothing is marked, so the app's own marker is the only
// writer (`design/reference/09-interaction.md` tells apps to set it explicitly).
function itemAttrs(pressed: boolean | undefined): Record<string, string> {
  return { [TOOLBAR_ITEM_ATTR]: "", ...(pressed === undefined ? {} : { "aria-pressed": String(pressed), ...stateAttrs({ pressed }) }) };
}

/** Toolbar container, stamping the resumable scope that mounts roving focus. */
const ToolbarRoot: FC<ToolbarRootProps> = ({ orientation = "horizontal", class: cls, children, "data-slot": inherited, ...rest }) => (
  <div
    role='toolbar'
    data-slot={slotToken("toolbar", inherited)}
    data-scope={TOOLBAR_SCOPE}
    {...stateAttrs({ orientation })}
    aria-orientation={orientation}
    class={cn(ROOT_BASE, orientation === "vertical" && "flex-col", cls)}
    {...rest}>
    {children}
  </div>
);

function itemClass(styling: ToolbarItemStyling, cls: string | undefined, extra?: string): string {
  const merged = cn(extra, cls);
  return buttonVariants({
    tone: styling.tone ?? "neutral",
    appearance: styling.appearance ?? "ghost",
    size: styling.size ?? "sm",
    shape: styling.shape,
    ...(merged ? { class: merged } : {}),
  });
}

/** A button inside a toolbar, carrying the roving-focus marker. */
const ToolbarButton: FC<ToolbarButtonProps> = ({
  tone,
  appearance,
  size,
  shape,
  pressed,
  asChild = false,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => {
  const className = itemClass({ tone, appearance, size, shape }, cls);
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
const ToolbarLink: FC<ToolbarLinkProps> = ({
  tone,
  appearance,
  size,
  shape,
  pressed,
  asChild = false,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => {
  const className = itemClass({ tone, appearance, size, shape }, cls, "underline-offset-4 hover:underline");
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
      "rounded-field border border-input bg-background px-2 py-1 text-sm text-foreground",
      "focus-ring placeholder:text-muted-foreground",
      cls,
    )}
    {...rest}
  />
);

/** Groups related items inside a toolbar. */
const ToolbarGroup: FC<ToolbarGroupProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <fieldset data-slot={slotToken("toolbar-group", inherited)} class={cn("m-0 inline-flex items-center gap-1 border-0 p-0", cls)} {...rest}>
    {children}
  </fieldset>
);

/** A divider between toolbar sections. Defaults to the axis across the toolbar. */
const ToolbarSeparator: FC<ToolbarSeparatorProps> = ({ orientation = "vertical", class: cls, "data-slot": inherited, ...rest }) => (
  <hr
    data-slot={slotToken("toolbar-separator", inherited)}
    aria-orientation={orientation}
    class={cn(orientation === "vertical" ? "h-5 w-px" : "h-px w-full", RULE, cls)}
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
