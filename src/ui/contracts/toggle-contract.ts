/**
 * Shared wiring for the components whose behaviour is a scope registered in `ui/core/client.ts`.
 * Pure data, side-effect-free.
 */

/**
 * Resumable-scope name the Toggle button stamps. Lazy — it resumes on its own `data-on-click`.
 * @public
 */
export const TOGGLE_SCOPE = "toggle";

/**
 * The action the Toggle button names in `data-on-click` and the client scope handles. Declared once
 * so the SSR `scopeAttrs` call and the `registerScope` handler table are typed against the same
 * vocabulary — the string is otherwise written twice, in two bundles, with nothing to catch a typo.
 * @public
 */
export type ToggleAction = "toggle";

/**
 * Resumable-scope name the Collapsible `<details>` stamps. Eager.
 * @public
 */
export const COLLAPSIBLE_SCOPE = "collapsible";

/**
 * Resumable-scope name each Accordion `<details>` item stamps. Eager, and the same kind of thing as
 * {@link COLLAPSIBLE_SCOPE}: a disclosure whose open state the platform owns and forge only
 * publishes.
 * @public
 */
export const ACCORDION_SCOPE = "accordion";

/**
 * Resumable-scope name the Tooltip root stamps. Eager.
 * @public
 */
export const TOOLTIP_SCOPE = "tooltip";
