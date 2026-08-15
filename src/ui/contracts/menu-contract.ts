/** Resumable-scope name the Menu popup stamps and the client scope registers. @public */
export const MENU_SCOPE = "menu";

/** Menu items, identified by their ARIA roles rather than by a forge-specific marker. @public */
export const MENU_ITEM_SELECTOR = "[role='menuitem'],[role='menuitemcheckbox'],[role='menuitemradio']";

/** Radio rows, whose selection the client scope makes exclusive within their group. @public */
export const MENU_RADIO_SELECTOR = "[role='menuitemradio']";

/** The element a radio row's mutually-exclusive siblings share; `Menu.Group` is a `<fieldset>`. @public */
export const MENU_GROUP_SELECTOR = "fieldset,[role='group']";

/** The actions a checkable menu row names in `data-on-click` and the client scope handles. @public */
export type MenuAction = "check" | "select";

/** The class string every menu row shape wears, including client-built rows. @public */
export const MENU_ITEM_CLASS =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm text-popover-foreground " +
  "bg-transparent border-0 cursor-pointer outline-none " +
  "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground " +
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

/** What {@link menuItemAttrs} needs to know about the row it is describing. */
export interface MenuItemAttrsOptions {
  // Omit for a disabled row or a submenu header: the platform runs an invoker command regardless
  // of `aria-disabled`, so such a row would dismiss a menu that must stay open.
  /** id of the enclosing menu popup, which emits the `hide-popover` invoker command. */
  readonly closes?: string | false;
  /** `menuitemcheckbox` / `menuitemradio` instead of a plain `menuitem`. @default "menuitem" */
  readonly role?: "menuitem" | "menuitemcheckbox" | "menuitemradio";
  /** Marks the row `aria-disabled`, keeping it focusable and in the navigation ring. */
  readonly disabled?: boolean;
  /** Initial checked state of a `menuitemcheckbox` or `menuitemradio`. @default false */
  readonly checked?: boolean;
}

/** The `aria-checked` and delegated-action attributes a checkable row carries; empty for a plain row. */
function checkableAttrs(role: MenuItemAttrsOptions["role"], checked: boolean): Record<string, string> {
  if (role !== "menuitemcheckbox" && role !== "menuitemradio") return {};
  return { "aria-checked": String(checked), "data-on-click": role === "menuitemcheckbox" ? "check" : "select" };
}

/** Every attribute a client-built menu row needs; the element must be a `<button>`. @public */
export function menuItemAttrs(options: MenuItemAttrsOptions = {}): Record<string, string> {
  const { closes, role = "menuitem", disabled = false, checked = false } = options;
  return {
    role,
    "data-slot": role === "menuitem" ? "menu-item" : role === "menuitemcheckbox" ? "menu-checkbox-item" : "menu-radio-item",
    ...checkableAttrs(role, checked),
    ...(disabled ? { "aria-disabled": "true" } : {}),
    ...(closes ? { command: "hide-popover", commandfor: closes } : {}),
  };
}
