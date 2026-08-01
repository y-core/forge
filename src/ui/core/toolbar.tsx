/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { ACTIVE_COMPOSITE_ITEM } from "../contracts/composite-contract";
import { type Orientation, stateAttrs } from "../contracts/state-attrs";
import { TOOLBAR_ITEM_ATTR, TOOLBAR_SCOPE } from "../contracts/toolbar-contract";
import { type ButtonProps, buttonVariants } from "./button";
import { cloneAsChild } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

type ToolbarOrientation = Extract<Orientation, "horizontal" | "vertical">;

/** What every toolbar item shares with `core/Button`: the same variants, the same sizes, and the
 * two-state marking a rail needs. Declared once rather than per item shape. */
interface ToolbarItemStyling {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  /** Two-state item — a pressed tool in a tool rail. Stamps `aria-pressed` **and** `data-pressed`,
   * never one without the other, plus the composite marker so the rail's boot tab stop lands on the
   * active tool rather than on whichever item happens to be first. */
  pressed?: boolean;
  /** Render onto the caller's own element instead of forge's. Same contract as `core/Button`'s:
   * exactly one JSX element child, or it throws. */
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
  /** Defaults to the axis across the toolbar: a horizontal toolbar gets vertical separators. */
  orientation?: ToolbarOrientation;
}

const ROOT_BASE = "flex items-center gap-1";

/** The attributes that make an element a rail stop: the roving-focus marker, the pressed pair, and
 * the boot tab stop when it is the pressed one. Shared by every item shape, because "a toolbar item"
 * is one idea and three of them declaring it separately is how they drift. */
function itemAttrs(pressed: boolean | undefined): Record<string, string> {
  return {
    [TOOLBAR_ITEM_ATTR]: "",
    ...(pressed === undefined ? {} : { "aria-pressed": String(pressed), ...stateAttrs({ pressed }) }),
    ...(pressed ? { [ACTIVE_COMPOSITE_ITEM]: "" } : {}),
  };
}

/**
 * Toolbar container. Stamps the resumable scope that mounts roving focus, so the whole toolbar is
 * **one Tab stop** and the arrow keys move between its items — the difference between a 52-button
 * toolbar being usable from the keyboard and being 52 things to Tab past.
 *
 * The scope is `eager`, because a roving tab stop has to exist before the first interaction: waiting
 * for one would mean every item is individually tabbable until the user happens to click something.
 */
const ToolbarRoot: FC<ToolbarRootProps> = ({ orientation = "horizontal", class: cls, children, ...rest }) => (
  <div
    role='toolbar'
    data-slot='toolbar'
    data-scope={TOOLBAR_SCOPE}
    {...stateAttrs({ orientation })}
    aria-orientation={orientation}
    class={cn(ROOT_BASE, orientation === "vertical" && "flex-col", asClass(cls))}
    {...rest}>
    {children}
  </div>
);

/** Item classes, resolved through `core/Button`'s variants rather than a base string of this
 * module's own — a toolbar button and a ghost `Button` are the same control in two places. */
function itemClass(styling: ToolbarItemStyling, cls: unknown, extra?: string): string {
  const own = cn(extra, asClass(cls));
  return buttonVariants({ variant: styling.variant ?? "ghost", size: styling.size ?? "sm", ...(own ? { class: own } : {}) });
}

/** A button inside a toolbar. Carries the roving-focus marker, so it is one of the arrow-key stops. */
const ToolbarButton: FC<ToolbarButtonProps> = ({ variant, size, pressed, asChild = false, class: cls, children, ...rest }) => {
  const className = itemClass({ variant, size }, cls);
  const attrs = { ...itemAttrs(pressed), ...rest };

  if (asChild) {
    return cloneAsChild(children, {
      slot: "toolbar-button",
      class: className,
      props: attrs,
      type: "button",
      ...(typeof rest.disabled === "boolean" ? { disabled: rest.disabled } : {}),
      message:
        "Toolbar.Button with asChild requires exactly one JSX element child (e.g. <a> or <button>); received a string, number, fragment, array, or empty child instead.",
    }) as ReturnType<FC<ToolbarButtonProps>>;
  }

  return (
    <button type='button' data-slot='toolbar-button' class={className} {...attrs}>
      {children}
    </button>
  );
};

/** A link inside a toolbar — a focus stop like any other item. */
const ToolbarLink: FC<ToolbarLinkProps> = ({ variant, size, pressed, asChild = false, class: cls, children, ...rest }) => {
  const className = itemClass({ variant, size }, cls, "underline-offset-4 hover:underline");
  const attrs = { ...itemAttrs(pressed), ...rest };

  if (asChild) {
    return cloneAsChild(children, {
      slot: "toolbar-link",
      class: className,
      props: attrs,
      message:
        "Toolbar.Link with asChild requires exactly one JSX element child (e.g. <a> or <button>); received a string, number, fragment, array, or empty child instead.",
    }) as ReturnType<FC<ToolbarLinkProps>>;
  }

  return (
    <a data-slot='toolbar-link' class={className} {...attrs}>
      {children}
    </a>
  );
};

/**
 * A text field inside a toolbar.
 *
 * This is the part with the subtle contract: arrow keys inside it belong to the **caret**, not to
 * the toolbar. `mountRovingFocus` detects a real text field and hands the key back, taking over only
 * at the very edge of the text — so arrow-ing out of a filled field feels like leaving it rather
 * than like the toolbar stealing the keystroke. Nothing here opts into that; it is the controller's
 * default, and `composite.browser.ts` pins it.
 */
const ToolbarInput: FC<ToolbarInputProps> = ({ class: cls, ...rest }) => (
  <input
    data-slot='toolbar-input'
    {...itemAttrs(undefined)}
    class={cn(
      "rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground",
      "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
      asClass(cls),
    )}
    {...rest}
  />
);

/**
 * Groups related items inside a toolbar. Not a focus stop itself — its children are.
 *
 * A `<fieldset>` with no explicit role, matching `core/toggle-group.tsx`: the implicit role is
 * already `group`, so stating it is redundant, and the UA's own border and margin are reset here.
 */
const ToolbarGroup: FC<ToolbarGroupProps> = ({ class: cls, children, ...rest }) => (
  <fieldset data-slot='toolbar-group' class={cn("inline-flex items-center gap-1 border-0 m-0 p-0", asClass(cls))} {...rest}>
    {children}
  </fieldset>
);

/** A divider between toolbar sections. Defaults to the axis across the toolbar. */
const ToolbarSeparator: FC<ToolbarSeparatorProps> = ({ orientation = "vertical", class: cls, ...rest }) => (
  <hr
    data-slot='toolbar-separator'
    aria-orientation={orientation}
    class={cn(orientation === "vertical" ? "h-5 w-px" : "h-px w-full", "border-0 bg-border", asClass(cls))}
    {...rest}
  />
);

/**
 * Compound toolbar: a single Tab stop whose items are reached with the arrow keys, Home and End.
 *
 * ```tsx
 * <Toolbar>
 *   <Toolbar.Button pressed>Bold</Toolbar.Button>
 *   <Toolbar.Separator />
 *   <Toolbar.Group>
 *     <Toolbar.Input placeholder='Search' />
 *   </Toolbar.Group>
 *   <Toolbar.Link href='/docs'>Docs</Toolbar.Link>
 * </Toolbar>
 * ```
 *
 * `Toolbar.Button` and `Toolbar.Link` take `core/Button`'s own `variant` and `size` (defaulting to
 * `ghost` / `sm`) and share its `asChild` contract, so an app can size its rail without overriding
 * the classes forge just handed it. `pressed` stamps `aria-pressed`, `data-pressed` and the
 * composite marker together — one prop, because an item that announces itself pressed to ARIA and
 * not to CSS is the asymmetry the state-attribute contract exists to prevent.
 *
 * The keyboard behaviour arrives with the `ui/core/client` side-effect import, which registers the
 * scope this root stamps; without it the markup is a plain, still-accessible toolbar.
 * @public
 */
export const Toolbar = Object.assign(ToolbarRoot, {
  Button: ToolbarButton,
  Link: ToolbarLink,
  Input: ToolbarInput,
  Group: ToolbarGroup,
  Separator: ToolbarSeparator,
});
