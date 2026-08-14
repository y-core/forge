/** Resumable-scope name the `<dialog>` element stamps. Eager. @public */
export const DIALOG_SCOPE = "dialog";

/** Resumable-scope name the popover panel stamps. Eager. @public */
export const POPOVER_SCOPE = "popover";

// A context menu has no invoker to anchor against, so every `anchor()` in the placement rules
// resolves to nothing and the UA's `[popover]` default centres it in the viewport.
/** Marks a popup placed at a coordinate rather than against an invoker. @public */
export const POPOVER_COORDS_ATTR = "data-coords";

/** Custom property carrying the coordinate-placed popup's viewport X, written by `openPopoverAt`. @public */
export const ANCHOR_X_PROPERTY = "--anchor-x";

/** Custom property carrying the coordinate-placed popup's viewport Y, written by `openPopoverAt`. @public */
export const ANCHOR_Y_PROPERTY = "--anchor-y";
