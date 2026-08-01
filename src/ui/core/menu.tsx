/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { MENU_SCOPE } from "../contracts/menu-contract";
import { type Align, type Side, stateAttrs } from "../contracts/state-attrs";
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
  side?: Extract<Side, "top" | "bottom">;
  align?: Align;
  children?: JSXNode;
}

interface MenuItemBaseProps {
  /**
   * id of the enclosing `Menu.Popup`. Emits `command="hide-popover"`, which is how selecting an item
   * closes the menu **without any JavaScript** — the platform hides the popover, while forge's own
   * `data-on-click` delegation on the same button runs the item's action. Pass `false` for an item
   * that should leave the menu open.
   */
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

const POPUP_BASE =
  "z-50 min-w-[10rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md " + "outline-none flex flex-col";
const ITEM_BASE =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-popover-foreground " +
  "bg-transparent border-0 cursor-pointer outline-none " +
  "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground " +
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const MenuRoot: FC<MenuRootProps> = ({ class: cls, children, ...rest }) => (
  <div data-slot='menu' class={cn("relative inline-block", asClass(cls))} {...rest}>
    {children}
  </div>
);

const MenuTrigger: FC<MenuTriggerProps> = ({ id, class: cls, children, ...rest }) => (
  <button
    type='button'
    data-slot='menu-trigger'
    command='toggle-popover'
    commandfor={id}
    aria-haspopup='menu'
    class={cn("cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring", asClass(cls))}
    {...rest}>
    {children}
  </button>
);

/**
 * The menu surface. A native `popover="auto"`, so the top layer, light-dismiss, Escape and
 * exclusive-open against sibling popovers are the platform's and stay free.
 *
 * The scope stamped here mounts the keyboard behaviour the platform does *not* supply: arrow
 * navigation, typeahead, and focus restoration to the trigger. It resolves its items live from this
 * element on every interaction, so a popup whose rows are replaced between openings — the shape a
 * context menu built from synchronous callbacks has — needs no re-mounting.
 */
const MenuPopup: FC<MenuPopupProps> = ({ id, side = "bottom", align = "start", class: cls, children, ...rest }) => (
  <div
    id={id}
    role='menu'
    data-slot='menu-popup'
    data-scope={MENU_SCOPE}
    popover='auto'
    {...stateAttrs({ open: false, side, align })}
    class={cn(POPUP_BASE, asClass(cls))}
    {...rest}>
    {children}
  </div>
);

/** Attributes that close the menu on select, unless the item opted out. */
function closeAttrs(target: string | false | undefined): Record<string, string> {
  return target ? { command: "hide-popover", commandfor: target } : {};
}

const MenuItem: FC<MenuItemProps> = ({ for: target, class: cls, children, ...rest }) => (
  <button type='button' role='menuitem' data-slot='menu-item' {...closeAttrs(target)} class={cn(ITEM_BASE, asClass(cls))} {...rest}>
    {children}
  </button>
);

const MenuCheckboxItem: FC<MenuCheckboxItemProps> = ({ for: target, checked = false, class: cls, children, ...rest }) => (
  <button
    type='button'
    role='menuitemcheckbox'
    data-slot='menu-checkbox-item'
    aria-checked={String(checked) as "true" | "false"}
    {...stateAttrs({ checked })}
    {...closeAttrs(target)}
    class={cn(ITEM_BASE, asClass(cls))}
    {...rest}>
    {children}
  </button>
);

const MenuRadioItem: FC<MenuRadioItemProps> = ({ for: target, checked = false, class: cls, children, ...rest }) => (
  <button
    type='button'
    role='menuitemradio'
    data-slot='menu-radio-item'
    aria-checked={String(checked) as "true" | "false"}
    {...stateAttrs({ checked })}
    {...closeAttrs(target)}
    class={cn(ITEM_BASE, asClass(cls))}
    {...rest}>
    {children}
  </button>
);

/**
 * A menu row that is a **real link**. Use it wherever the row navigates: an `<a href>` keeps
 * middle-click, open-in-new-tab, copy-link-address and no-JavaScript navigation, all of which a
 * `<button>` silently drops.
 *
 * No `command="hide-popover"`: only a button can be an Invoker command source, and a navigation
 * unloads the page anyway. `MENU_ITEM_SELECTOR` matches on the ARIA role, so this is part of the
 * arrow-key ring the moment it exists — which is the case that role-based selector was chosen for.
 */
const MenuLinkItem: FC<MenuLinkItemProps> = ({ class: cls, children, ...rest }) => (
  <a role='menuitem' data-slot='menu-link-item' class={cn(ITEM_BASE, asClass(cls))} {...rest}>
    {children}
  </a>
);

/**
 * A menu row that opens a nested `Menu.Popup`.
 *
 * Distinct from `Menu.Trigger`, and the difference is load-bearing: a bare trigger carries no role,
 * so a nested one would be invisible to `MENU_ITEM_SELECTOR` and the parent's arrow navigation would
 * skip straight past the submenu it opens. This carries `role="menuitem"` so the row is reachable,
 * and `aria-haspopup="menu"` so it announces what it does.
 */
const MenuSubmenuTrigger: FC<MenuSubmenuTriggerProps> = ({ id, class: cls, children, ...rest }) => (
  <button
    type='button'
    role='menuitem'
    data-slot='menu-submenu-trigger'
    command='toggle-popover'
    commandfor={id}
    aria-haspopup='menu'
    class={cn(ITEM_BASE, asClass(cls))}
    {...rest}>
    {children}
  </button>
);

/** A labelled section of a menu. `<fieldset>` for its implicit `group` role, with the UA box reset. */
const MenuGroup: FC<MenuGroupProps> = ({ class: cls, children, ...rest }) => (
  <fieldset data-slot='menu-group' class={cn("flex flex-col border-0 m-0 p-0", asClass(cls))} {...rest}>
    {children}
  </fieldset>
);

/** Name a `Menu.Group` by giving this an `id` and pointing the group's `aria-labelledby` at it. */
const MenuGroupLabel: FC<MenuGroupLabelProps> = ({ class: cls, children, ...rest }) => (
  <div data-slot='menu-group-label' class={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", asClass(cls))} {...rest}>
    {children}
  </div>
);

const MenuSeparator: FC<MenuSeparatorProps> = ({ class: cls, ...rest }) => (
  <hr data-slot='menu-separator' class={cn("my-1 h-px w-full border-0 bg-border", asClass(cls))} {...rest} />
);

/**
 * Compound menu on the native Popover and Invoker Commands APIs. The trigger is a
 * `<button command="toggle-popover" commandfor={id}>`, the popup is a `<div popover="auto" id={id}
 * role="menu">`, and an item closes the menu with `command="hide-popover"` — so opening, closing,
 * light-dismiss and Escape involve no JavaScript at all.
 *
 * ```tsx
 * <Menu>
 *   <Menu.Trigger id='file-menu'>File</Menu.Trigger>
 *   <Menu.Popup id='file-menu'>
 *     <Menu.Item for='file-menu' {...scopeAttrs({ onClick: 'save' })}>Save</Menu.Item>
 *     <Menu.Separator />
 *     <Menu.CheckboxItem for={false} checked>Autosave</Menu.CheckboxItem>
 *     <Menu.LinkItem href='/docs'>Docs</Menu.LinkItem>
 *   </Menu.Popup>
 * </Menu>
 * ```
 *
 * A submenu is a `Menu.SubmenuTrigger` beside its own `Menu.Popup`, nested inside the parent popup;
 * the trigger is a menu item in the parent's ring, and the nested popup is its own menu.
 *
 * Keyboard behaviour arrives with the `ui/core/client` side-effect import.
 * @public
 */
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
