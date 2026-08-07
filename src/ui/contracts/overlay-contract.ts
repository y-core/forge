/**
 * Shared wiring for the two native overlays — `<dialog>` and `popover`. Imported by BOTH the SSR
 * components (`ui/core/dialog.tsx`, `ui/core/popover.tsx`) and the client scopes that publish their
 * state (`ui/core/client.ts`). Pure data, side-effect-free.
 *
 * Both scopes are **eager**, and out of necessity rather than taste: the markup an overlay emits
 * carries no `data-on-*` action at all — opening, closing, light-dismiss and Escape are the
 * platform's — so a lazy scope would have nothing to resume it and the state attributes would never
 * move off their server-rendered value.
 */

/**
 * Resumable-scope name the `<dialog>` element stamps. Eager.
 * @public
 */
export const DIALOG_SCOPE = "dialog";

/**
 * Resumable-scope name the popover panel stamps. Eager.
 * @public
 */
export const POPOVER_SCOPE = "popover";

/**
 * Marks a popup that is placed at a **coordinate** rather than against an invoker.
 *
 * Every other popup in forge is positioned by CSS Anchor Positioning against its trigger, through an
 * explicit `anchor-name` / `position-anchor` pair declared in `theme-base.css`. A context menu has no
 * trigger: it opens where the pointer was, on an element that is not a button at all. Nothing carries
 * the anchor name, every `anchor()` in the placement rules resolves to nothing, and the UA's
 * `[popover]` default (`inset: 0; margin: auto`) centres it in the viewport — the one place a context
 * menu must never appear.
 *
 * The attribute selects the coordinate rule; {@link ANCHOR_X_PROPERTY} and
 * {@link ANCHOR_Y_PROPERTY} feed it.
 * @public
 */
export const POPOVER_COORDS_ATTR = "data-coords";

/**
 * Custom property carrying the coordinate-placed popup's viewport X, written by `openPopoverAt`.
 * @public
 */
export const ANCHOR_X_PROPERTY = "--anchor-x";

/**
 * Custom property carrying the coordinate-placed popup's viewport Y, written by `openPopoverAt`.
 * @public
 */
export const ANCHOR_Y_PROPERTY = "--anchor-y";
