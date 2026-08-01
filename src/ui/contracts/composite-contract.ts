/**
 * Shared wiring for the roving-focus composites — a toolbar, a tab list, a radio group. Imported by
 * BOTH the SSR components that mark the active item and the client controller that reads the mark.
 * Pure data, side-effect-free.
 *
 * `client/composite.ts` re-exports the constant, so `ui/client`'s published surface is unchanged;
 * the declaration lives here because an SSR component running on the Worker cannot import a module
 * that names `document`.
 */

/**
 * Marks which item should hold the tab stop on mount — put it on the pressed tool, the selected tab,
 * the checked radio. Read once and never written: the live tab stop is `tabindex="0"`, which is the
 * platform's own signal and needs no parallel attribute to fall out of sync with.
 * @public
 */
export const ACTIVE_COMPOSITE_ITEM = "data-composite-item-active";
