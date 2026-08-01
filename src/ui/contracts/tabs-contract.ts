/**
 * Shared Tabs wiring — imported by BOTH the SSR `<Tabs>` component (`ui/core`) and the client scope
 * that mounts its keyboard behaviour (`ui/core/client.ts`). Pure data, side-effect-free.
 */

/**
 * Resumable-scope name the Tabs root stamps and the client scope registers.
 * @public
 */
export const TABS_SCOPE = "tabs";

/**
 * A tab, by role — the same reasoning as {@link MENU_ITEM_SELECTOR}.
 * @public
 */
export const TAB_SELECTOR = "[role='tab']";

/**
 * The tablist a {@link TAB_SELECTOR} match belongs to.
 * @public
 */
export const TABLIST_SELECTOR = "[role='tablist']";
