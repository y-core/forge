// A context menu has no invoker to anchor against, so every `anchor()` in the placement rules
// resolves to nothing and the UA's `[popover]` default centres it in the viewport.
/** Marks a popup placed at a coordinate rather than against an invoker. @public */
export const POPOVER_COORDS_ATTR = "data-coords";

/** Custom property carrying the coordinate-placed popup's viewport X, written by `openPopoverAt`. @public */
export const ANCHOR_X_PROPERTY = "--anchor-x";

/** Custom property carrying the coordinate-placed popup's viewport Y, written by `openPopoverAt`. @public */
export const ANCHOR_Y_PROPERTY = "--anchor-y";

/** Resumable-scope name a `Popover.Content` stamps, so its invokers' `aria-expanded` is maintained. Eager. @public */
export const POPOVER_SCOPE = "popover";

// Stamped explicitly rather than left to the `commandfor` invoker mapping, which no engine ships
// reliably: an expanded state no assistive technology can read is the same as no state at all.
/** The expanded-state attributes a popover invoker carries at SSR, keyed to the popup's id. @public */
export function invokerAttrs(popupId: string): Record<string, string> {
  return { "aria-controls": popupId, "aria-expanded": "false" };
}
