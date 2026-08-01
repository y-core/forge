/**
 * Shared Menu wiring — imported by BOTH the SSR `<Menu>` component (`ui/core`) and the client scope
 * that mounts its keyboard behaviour (`ui/core/client.ts`). Pure data, side-effect-free.
 */

/**
 * Resumable-scope name the Menu popup stamps and the client scope registers.
 * @public
 */
export const MENU_SCOPE = "menu";

/**
 * Menu items, identified by their **ARIA roles** rather than by a forge-specific marker.
 *
 * That choice is load-bearing for a context menu whose rows arrive from synchronous callbacks and
 * are constructed at runtime: a row built in the browser is navigable the moment it is a
 * correctly-roled menu item, with nothing forge-specific to remember to stamp.
 * @public
 */
export const MENU_ITEM_SELECTOR = "[role='menuitem'],[role='menuitemcheckbox'],[role='menuitemradio']";

/**
 * The class string every menu row shape wears — `Menu.Item`, `Menu.LinkItem`, `Menu.SubmenuTrigger`,
 * and the checkbox and radio variants.
 *
 * **Published because a client-built row cannot invoke an SSR component.** A context menu whose rows
 * arrive from a synchronous callback has to construct them in the browser, and `Menu.Item` renders on
 * the Worker — so without this the consumer's only option is to re-type the class string as a
 * literal, which is a second declaration of forge's own styling in a repository forge's gate cannot
 * see. That is the same argument `state-attrs.ts` and this module's selector already make.
 * @public
 */
export const MENU_ITEM_CLASS =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-popover-foreground " +
  "bg-transparent border-0 cursor-pointer outline-none " +
  "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground " +
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

/** What {@link menuItemAttrs} needs to know about the row it is describing. */
export interface MenuItemAttrsOptions {
  /**
   * id of the enclosing menu popup. Emits `command="hide-popover"` + `commandfor`, which is how
   * selecting a row closes the menu **with no JavaScript**.
   *
   * **Omit it — or pass `false` — for a disabled row or a submenu header.** The platform runs an
   * invoker command *regardless of `aria-disabled`*, so a greyed row carrying it dismisses a menu
   * that should have stayed open, and a submenu header dismisses the menu the user was navigating
   * into. This is the single easiest thing to get wrong when building rows by hand, which is why the
   * option is opt-in rather than defaulted.
   */
  readonly closes?: string | false;
  /** `menuitemcheckbox` / `menuitemradio` instead of a plain `menuitem`. @default "menuitem" */
  readonly role?: "menuitem" | "menuitemcheckbox" | "menuitemradio";
  /** Disabled rows stay focusable and announce their state — never `disabled`, which removes them
   * from the ring and makes the menu's shape change as commands come and go. */
  readonly disabled?: boolean;
}

/**
 * Every attribute a **client-built** menu row needs, stamped from forge's own declaration rather than
 * copied out of it.
 *
 * ```ts
 * const row = document.createElement("button");
 * row.type = "button";
 * row.className = MENU_ITEM_CLASS;
 * for (const [name, value] of Object.entries(menuItemAttrs({ closes: menuId }))) row.setAttribute(name, value);
 * ```
 *
 * A `<button>`, always: only a button is a valid Invoker command source, and forge's menu controller
 * moves focus onto rows with `focus()`, which a non-interactive element cannot take.
 * @public
 */
export function menuItemAttrs(options: MenuItemAttrsOptions = {}): Record<string, string> {
  const { closes, role = "menuitem", disabled = false } = options;
  return {
    role,
    "data-slot": role === "menuitem" ? "menu-item" : role === "menuitemcheckbox" ? "menu-checkbox-item" : "menu-radio-item",
    ...(disabled ? { "aria-disabled": "true" } : {}),
    ...(closes ? { command: "hide-popover", commandfor: closes } : {}),
  };
}
