/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import type { ComponentFn, FC, JSX, JSXNode } from "../../render/jsx/types";
import { MENU_ITEM_CLASS, MENU_KEEP_OPEN_ATTR, MENU_SCOPE, menuItemAttrs } from "../contracts/menu-contract";
import { nameAttrs, triggerId } from "../contracts/naming";
import { invokerAttrs, POPOVER_COORDS_ATTR } from "../contracts/overlay-contract";
import { stateAttrs } from "../contracts/state-attrs";
import type { MenuItemAttrsOptions } from "../contracts/types";
import type { Align, InvokerShape, MenuPopupNaming, Side } from "../contracts/types";
import { buttonBox } from "./button";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { mergeIdRefs } from "./utils/id-refs";
import { fillPartProps } from "./utils/part-props";
import { RULE } from "./utils/recipes";

interface MenuRootProps extends Omit<JSX.IntrinsicElements["span"], "children"> {
  children?: JSXNode | undefined;
}

interface MenuTriggerProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the `Menu.Popup` this trigger toggles — its `commandfor` target. */
  for: string;
  /** `"icon"` squares the box and drops its inline padding, for a child that is only an icon. */
  shape?: InvokerShape | undefined;
  children?: JSXNode | undefined;
}

type MenuPopupProps = MenuPopupNaming & MenuPopupOwnProps;

interface MenuPopupOwnProps extends Omit<JSX.IntrinsicElements["span"], "children"> {
  /** Element id — the `commandfor` target named by the matching `Menu.Trigger`. */
  id: string;
  /** Which side of its anchor the popup opens on. */
  side?: Side | undefined;
  align?: Align | undefined;
  /** Place this popup at a coordinate handed to `openPopoverAt` instead of against an invoker. */
  coords?: boolean | undefined;
  children?: JSXNode | undefined;
}

interface MenuItemBaseProps {
  /** id of the enclosing `Menu.Popup` to close on select; `false` leaves the menu open. */
  for?: string | false | undefined;
  children?: JSXNode | undefined;
}

type MenuItemProps = Omit<JSX.IntrinsicElements["button"], "children"> & MenuItemBaseProps;
type MenuCheckboxItemProps = MenuItemProps & { checked?: boolean | undefined };
type MenuRadioItemProps = MenuItemProps & { checked?: boolean | undefined };

interface MenuLinkItemProps extends Omit<JSX.IntrinsicElements["a"], "children"> {
  /** `false` leaves the menu open on activation. A link takes no id: it closes the panel it sits in. */
  for?: false | undefined;
  children?: JSXNode | undefined;
}

interface MenuSubmenuTriggerProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the nested `Menu.Popup` this row opens — its `commandfor` target. */
  for: string;
  children?: JSXNode | undefined;
}

interface MenuGroupProps extends Omit<JSX.IntrinsicElements["span"], "children"> {
  /** Disable every row in the group that leaves its own `disabled` unset. */
  disabled?: boolean | undefined;
  children?: JSXNode | undefined;
}

interface MenuGroupLabelProps extends Omit<JSX.IntrinsicElements["span"], "children"> {
  children?: JSXNode | undefined;
}

type MenuSeparatorProps = Omit<JSX.IntrinsicElements["span"], "children">;

// No `display` utility: the UA rule `[popover]:not(:popover-open){display:none}` is not
// `!important`, so an author-origin `display` here leaves a closed popup permanently visible.
const POPUP_BASE = "z-50 min-w-40 rounded-box border-field border-border bg-popover p-1 text-popover-foreground shadow-md outline-none";
const ITEM_BASE = MENU_ITEM_CLASS;

const MenuRoot: FC<MenuRootProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <span data-slot={slotToken("menu", inherited)} class={cn("relative inline-block", cls)} {...rest}>
    {children}
  </span>
);

const MenuTrigger: FC<MenuTriggerProps> = ({ for: target, shape, class: cls, children, "data-slot": inherited, ...rest }) => (
  <button
    type='button'
    data-slot={slotToken("menu-trigger", inherited)}
    command='toggle-popover'
    commandfor={target}
    {...invokerAttrs(target, "menu")}
    class={cn(buttonBox({ size: "sm", shape }), "border-transparent", "cursor-pointer", cls)}
    {...rest}
    // After `rest`, because the popup's `aria-labelledby` points here: a caller's own `id` would
    // leave `role="menu"` with no name at all, which is what it has today.
    id={triggerId(target)}>
    {children}
  </button>
);

/** The menu surface — a native `popover="auto"` carrying the keyboard-behaviour scope. */
const MenuPopup: FC<MenuPopupProps> = ({
  id,
  triggered,
  label,
  labelledby,
  side = "bottom",
  align = "start",
  coords = false,
  class: cls,
  children,
  "data-slot": inherited,
  "aria-labelledby": ownLabelledBy,
  ...rest
}) => (
  <span
    id={id}
    role='menu'
    // The derived reference is reachable only through `triggered`, which is the caller asserting the
    // forge trigger it points at: a popup opened from an invoker of their own has no such element.
    {...(triggered
      ? { "aria-labelledby": mergeIdRefs(ownLabelledBy, [triggerId(id)]) }
      : { ...nameAttrs({ label, labelledby }), ...(ownLabelledBy === undefined ? {} : { "aria-labelledby": ownLabelledBy }) })}
    data-slot={slotToken("menu-popup", inherited)}
    data-scope={MENU_SCOPE}
    popover='auto'
    {...(coords ? { [POPOVER_COORDS_ATTR]: "" } : {})}
    {...stateAttrs({ side, align })}
    class={cn(POPUP_BASE, cls)}
    {...rest}>
    {children}
  </span>
);

// `menuItemAttrs` is published for rows an app builds in the browser; spending it here too is what
// keeps the SSR and client tiers from drifting.
const rowAttrs = (options: MenuItemAttrsOptions, own: string, inherited: unknown): Record<string, string> => ({
  ...menuItemAttrs(options),
  "data-slot": slotToken(own, inherited),
});

const MenuItem: FC<MenuItemProps> = ({ for: target, class: cls, children, "data-slot": inherited, ...rest }) => (
  <button type='button' {...rowAttrs({ closes: target }, "menu-item", inherited)} class={cn(ITEM_BASE, cls)} {...rest}>
    {children}
  </button>
);

const MenuCheckboxItem: FC<MenuCheckboxItemProps> = ({ for: target, checked = false, class: cls, children, "data-slot": inherited, ...rest }) => (
  <button
    type='button'
    {...rowAttrs({ closes: target, role: "menuitemcheckbox", checked }, "menu-checkbox-item", inherited)}
    class={cn(ITEM_BASE, cls)}
    {...rest}>
    {children}
  </button>
);

const MenuRadioItem: FC<MenuRadioItemProps> = ({ for: target, checked = false, class: cls, children, "data-slot": inherited, ...rest }) => (
  <button
    type='button'
    {...rowAttrs({ closes: target, role: "menuitemradio", checked }, "menu-radio-item", inherited)}
    class={cn(ITEM_BASE, cls)}
    {...rest}>
    {children}
  </button>
);

/** A menu row that navigates as a real `<a href>`. */
const MenuLinkItem: FC<MenuLinkItemProps> = ({ for: closes, class: cls, children, "data-slot": inherited, ...rest }) => (
  <a
    role='menuitem'
    data-slot={slotToken("menu-link-item", inherited)}
    {...(closes === false ? { [MENU_KEEP_OPEN_ATTR]: "" } : {})}
    class={cn(ITEM_BASE, cls)}
    {...rest}>
    {children}
  </a>
);

/** A menu row that opens a nested `Menu.Popup`. */
const MenuSubmenuTrigger: FC<MenuSubmenuTriggerProps> = ({ for: target, class: cls, children, "data-slot": inherited, ...rest }) => (
  <button
    type='button'
    role='menuitem'
    data-slot={slotToken("menu-submenu-trigger", inherited)}
    command='toggle-popover'
    commandfor={target}
    {...invokerAttrs(target, "menu")}
    class={cn(ITEM_BASE, cls)}
    {...rest}
    id={triggerId(target)}>
    {children}
  </button>
);

const DISABLED_ROWS = new Map<ComponentFn, Record<string, unknown>>(
  [MenuItem, MenuCheckboxItem, MenuRadioItem, MenuSubmenuTrigger].map((row) => [row, { disabled: true }]),
);

/** A labelled section of a menu. */
const MenuGroup: FC<MenuGroupProps> = ({ disabled = false, class: cls, children, "data-slot": inherited, ...rest }) => (
  <span
    data-slot={slotToken("menu-group", inherited)}
    role='group'
    {...(disabled ? { "aria-disabled": "true" } : {})}
    class={cn("flex flex-col", cls)}
    {...rest}>
    {disabled ? fillPartProps(children, DISABLED_ROWS) : children}
  </span>
);

/** Name a `Menu.Group` by giving this an `id` and pointing the group's `aria-labelledby` at it. */
const MenuGroupLabel: FC<MenuGroupLabelProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <span
    data-slot={slotToken("menu-group-label", inherited)}
    class={cn("block px-2 py-1.5 text-xs font-medium text-muted-foreground", cls)}
    {...rest}>
    {children}
  </span>
);

const MenuSeparator: FC<MenuSeparatorProps> = ({ class: cls, "data-slot": inherited, ...rest }) => (
  <span data-slot={slotToken("menu-separator", inherited)} role='separator' class={cn("my-1 block h-px w-full", RULE, cls)} {...rest} />
);

/** Compound menu built on the native Popover and Invoker Commands APIs. @public */
export const Menu = Object.assign(MenuRoot, {
  Trigger: MenuTrigger,
  Popup: MenuPopup,
  Item: MenuItem,
  LinkItem: MenuLinkItem,
  SubmenuTrigger: MenuSubmenuTrigger,
  CheckboxItem: MenuCheckboxItem,
  RadioItem: MenuRadioItem,
  Group: MenuGroup,
  GroupLabel: MenuGroupLabel,
  Separator: MenuSeparator,
});
