/**
 * Shared Menu wiring — imported by BOTH the SSR `<Menu>` component (`ui/core`) and the client scope
 * that mounts its keyboard behaviour (`ui/core/client.ts`). Pure data, side-effect-free. Internal:
 * not part of the package's public export surface.
 */

/** Resumable-scope name the Menu popup stamps and the client scope registers. */
export const MENU_SCOPE = "menu";

/**
 * Menu items, identified by their **ARIA roles** rather than by a forge-specific marker.
 *
 * That choice is load-bearing for cad-forge's context menu, whose rows arrive from synchronous
 * kernel callbacks and are constructed at runtime: a row built in the browser is navigable the
 * moment it is a correctly-roled menu item, with nothing forge-specific to remember to stamp.
 */
export const MENU_ITEM_SELECTOR = "[role='menuitem'],[role='menuitemcheckbox'],[role='menuitemradio']";
