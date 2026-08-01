/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { type Orientation, stateAttrs } from "../contracts/state-attrs";
import { TOOLBAR_ITEM_ATTR, TOOLBAR_SCOPE } from "../contracts/toolbar-contract";
import { asClass, cn } from "./utils/cn";

type ToolbarOrientation = Extract<Orientation, "horizontal" | "vertical">;

interface ToolbarRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  orientation?: ToolbarOrientation;
  children?: JSXNode;
}

interface ToolbarButtonProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  children?: JSXNode;
}

interface ToolbarLinkProps extends Omit<JSX.IntrinsicElements["a"], "children"> {
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
const ITEM_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md px-2 py-1 text-sm text-foreground " +
  "outline-none cursor-pointer hover:bg-accent hover:text-accent-foreground " +
  "focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

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

/** A button inside a toolbar. Carries the roving-focus marker, so it is one of the arrow-key stops. */
const ToolbarButton: FC<ToolbarButtonProps> = ({ class: cls, children, ...rest }) => (
  <button type='button' data-slot='toolbar-button' {...{ [TOOLBAR_ITEM_ATTR]: "" }} class={cn(ITEM_BASE, asClass(cls))} {...rest}>
    {children}
  </button>
);

/** A link inside a toolbar — a focus stop like any other item. */
const ToolbarLink: FC<ToolbarLinkProps> = ({ class: cls, children, ...rest }) => (
  <a data-slot='toolbar-link' {...{ [TOOLBAR_ITEM_ATTR]: "" }} class={cn(ITEM_BASE, "underline-offset-4 hover:underline", asClass(cls))} {...rest}>
    {children}
  </a>
);

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
    {...{ [TOOLBAR_ITEM_ATTR]: "" }}
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
 *   <Toolbar.Button>Bold</Toolbar.Button>
 *   <Toolbar.Separator />
 *   <Toolbar.Group>
 *     <Toolbar.Input placeholder='Search' />
 *   </Toolbar.Group>
 *   <Toolbar.Link href='/docs'>Docs</Toolbar.Link>
 * </Toolbar>
 * ```
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
