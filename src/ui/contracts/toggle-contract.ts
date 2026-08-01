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
 * Resumable-scope name the Collapsible `<details>` stamps. Eager.
 * @public
 */
export const COLLAPSIBLE_SCOPE = "collapsible";

/**
 * Resumable-scope name the Tooltip root stamps. Eager.
 * @public
 */
export const TOOLTIP_SCOPE = "tooltip";
