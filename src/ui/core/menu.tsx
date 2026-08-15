/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { MENU_ITEM_CLASS, MENU_SCOPE, type MenuAction } from "../contracts/menu-contract";
import { invokerAttrs, POPOVER_COORDS_ATTR } from "../contracts/overlay-contract";
import { scopeAttrs } from "../contracts/scope-attrs";
import { type Align, type Side, stateAttrs } from "../contracts/state-attrs";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

interface MenuRootProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode;
}

interface MenuTriggerProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the `Menu.Popup` this trigger toggles — its `commandfor` target. */
  id: string;
  children?: JSXNode;
}

interface MenuPopupProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  /** Element id — the `commandfor` target named by the matching `Menu.Trigger`. */
  id: string;
  /** Which side of its anchor the popup opens on. */
  side?: Side;
  align?: Align;
  /** Place this popup at a coordinate handed to `openPopoverAt` instead of against an invoker. */
  coords?: boolean;
  children?: JSXNode;
}

interface MenuItemBaseProps {
  /** id of the enclosing `Menu.Popup` to close on select; `false` leaves the menu open. */
  for?: string | false;
  children?: JSXNode;
}

type MenuItemProps = Omit<JSX.IntrinsicElements["button"], "children"> & MenuItemBaseProps;
type MenuCheckboxItemProps = MenuItemProps & { checked?: boolean };
type MenuRadioItemProps = MenuItemProps & { checked?: boolean };

interface MenuLinkItemProps extends Omit<JSX.IntrinsicElements["a"], "children"> {
  children?: JSXNode;
}

interface MenuSubmenuTriggerProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  /** id of the nested `Menu.Popup` this row opens — its `commandfor` target. */
  id: string;
  children?: JSXNode;
}

interface MenuGroupProps extends Omit<JSX.IntrinsicElements["fieldset"], "children"> {
  children?: JSXNode;
}

interface MenuGroupLabelProps extends Omit<JSX.IntrinsicElements["div"], "children"> {
  children?: JSXNode;
}

type MenuSeparatorProps = Omit<JSX.IntrinsicElements["hr"], "children">;

// No `display` utility: the UA rule `[popover]:not(:popover-open){display:none}` is not
// `!important`, so an author-origin `display` here leaves a closed popup permanently visible.
const POPUP_BASE = "z-50 min-w-[10rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none";
const ITEM_BASE = MENU_ITEM_CLASS;

const MenuRoot: FC<MenuRootProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("menu", inherited)} class={cn("relative inline-block", asClass(cls))} {...rest}>
    {children}
  </div>
);

const MenuTrigger: FC<MenuTriggerProps> = ({ id, class: cls, children, "data-slot": inherited, ...rest }) => (
  <button
    type='button'
    data-slot={slotToken("menu-trigger", inherited)}
    command='toggle-popover'
    commandfor={id}
    aria-haspopup='menu'
    {...invokerAttrs(id)}
    class={cn("cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring", asClass(cls))}
    {...rest}>
    {children}
  </button>
);

/** The menu surface — a native `popover="auto"` carrying the keyboard-behaviour scope. */
const MenuPopup: FC<MenuPopupProps> = ({
  id,
  side = "bottom",
  align = "start",
  coords = false,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <div
    id={id}
    role='menu'
    data-slot={slotToken("menu-popup", inherited)}
    data-scope={MENU_SCOPE}
    popover='auto'
    {...(coords ? { [POPOVER_COORDS_ATTR]: "" } : {})}
    {...stateAttrs({ side, align })}
    class={cn(POPUP_BASE, asClass(cls))}
    {...rest}>
    {children}
  </div>
);

/** Attributes that close the menu on select, unless the item opted out. */
function closeAttrs(target: string | false | undefined): Record<string, string> {
  return target ? { command: "hide-popover", commandfor: target } : {};
}

const MenuItem: FC<MenuItemProps> = ({ for: target, class: cls, children, "data-slot": inherited, ...rest }) => (
  <button
    type='button'
    role='menuitem'
    data-slot={slotToken("menu-item", inherited)}
    {...closeAttrs(target)}
    class={cn(ITEM_BASE, asClass(cls))}
    {...rest}>
    {children}
  </button>
);

const MenuCheckboxItem: FC<MenuCheckboxItemProps> = ({ for: target, checked = false, class: cls, children, "data-slot": inherited, ...rest }) => (
  <button
    type='button'
    role='menuitemcheckbox'
    data-slot={slotToken("menu-checkbox-item", inherited)}
    aria-checked={checked}
    {...stateAttrs({ checked })}
    {...scopeAttrs<MenuAction>({ onClick: "check" })}
    {...closeAttrs(target)}
    class={cn(ITEM_BASE, asClass(cls))}
    {...rest}>
    {children}
  </button>
);

const MenuRadioItem: FC<MenuRadioItemProps> = ({ for: target, checked = false, class: cls, children, "data-slot": inherited, ...rest }) => (
  <button
    type='button'
    role='menuitemradio'
    data-slot={slotToken("menu-radio-item", inherited)}
    aria-checked={checked}
    {...stateAttrs({ checked })}
    {...scopeAttrs<MenuAction>({ onClick: "select" })}
    {...closeAttrs(target)}
    class={cn(ITEM_BASE, asClass(cls))}
    {...rest}>
    {children}
  </button>
);

/** A menu row that navigates as a real `<a href>`. */
const MenuLinkItem: FC<MenuLinkItemProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <a role='menuitem' data-slot={slotToken("menu-link-item", inherited)} class={cn(ITEM_BASE, asClass(cls))} {...rest}>
    {children}
  </a>
);

/** A menu row that opens a nested `Menu.Popup`. */
const MenuSubmenuTrigger: FC<MenuSubmenuTriggerProps> = ({ id, class: cls, children, "data-slot": inherited, ...rest }) => (
  <button
    type='button'
    role='menuitem'
    data-slot={slotToken("menu-submenu-trigger", inherited)}
    command='toggle-popover'
    commandfor={id}
    aria-haspopup='menu'
    {...invokerAttrs(id)}
    class={cn(ITEM_BASE, asClass(cls))}
    {...rest}>
    {children}
  </button>
);

/** A labelled section of a menu. `<fieldset>` for its implicit `group` role, with the UA box reset. */
const MenuGroup: FC<MenuGroupProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <fieldset data-slot={slotToken("menu-group", inherited)} class={cn("flex flex-col border-0 m-0 p-0", asClass(cls))} {...rest}>
    {children}
  </fieldset>
);

/** Name a `Menu.Group` by giving this an `id` and pointing the group's `aria-labelledby` at it. */
const MenuGroupLabel: FC<MenuGroupLabelProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div
    data-slot={slotToken("menu-group-label", inherited)}
    class={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", asClass(cls))}
    {...rest}>
    {children}
  </div>
);

const MenuSeparator: FC<MenuSeparatorProps> = ({ class: cls, "data-slot": inherited, ...rest }) => (
  <hr data-slot={slotToken("menu-separator", inherited)} class={cn("my-1 h-px w-full border-0 bg-border", asClass(cls))} {...rest} />
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
