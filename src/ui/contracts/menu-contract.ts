import { stateAttrs } from "./state-attrs";
import type { MenuItemAttrsOptions } from "./types";

/** Resumable-scope name the Menu popup stamps and the client scope registers. @public */
export const MENU_SCOPE = "menu";

/** Menu items, identified by their ARIA roles rather than by a forge-specific marker. @public */
export const MENU_ITEM_SELECTOR = "[role='menuitem'],[role='menuitemcheckbox'],[role='menuitemradio']";

/** Radio rows, whose selection the client scope makes exclusive within their group. @public */
export const MENU_RADIO_SELECTOR = "[role='menuitemradio']";

/** The element a radio row's mutually-exclusive siblings share; `Menu.Group` is a `<fieldset>`. @public */
export const MENU_GROUP_SELECTOR = "fieldset,[role='group']";

/** The class string every menu row shape wears, including client-built rows. @public */
export const MENU_ITEM_CLASS =
  "flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-start text-sm text-popover-foreground " +
  "bg-transparent border-0 cursor-pointer outline-none " +
  "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground " +
  "state-disabled";

/** The `aria-checked` and delegated-action attributes a checkable row carries; empty for a plain row. */
// `data-checked` beside `aria-checked` and never without it: `STATE_ATTRIBUTES.md` §1b names this
// function as the reason one exists, and a client-built row that emitted only the ARIA half styled
// nothing the CSS hooks paint from.
function checkableAttrs(role: MenuItemAttrsOptions["role"], checked: boolean): Record<string, string> {
  if (role !== "menuitemcheckbox" && role !== "menuitemradio") return {};
  return { "aria-checked": String(checked), ...stateAttrs({ checked }), "data-on-click": role === "menuitemcheckbox" ? "check" : "select" };
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
