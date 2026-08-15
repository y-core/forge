// `Toggle` itself has no scope any more: it is a native checkbox whose `:checked` the CSS keys on,
// so there is no state for a controller to maintain and no bespoke runtime to keep in step with
// `ToggleGroup`'s.
/** Resumable-scope name a `ToggleGroup` stamps, for the roving focus a checkbox group lacks. Eager. @public */
export const TOGGLE_GROUP_SCOPE = "toggle-group";

/** The focusable element inside each `ToggleGroup.Item`, which roving focus moves between. @public */
export const TOGGLE_GROUP_ITEM_SELECTOR = "[data-slot~='toggle-group-input']";

/** Resumable-scope name the Tooltip root stamps. Eager. @public */
export const TOOLTIP_SCOPE = "tooltip";

/** Marks a tooltip whose controller has mounted, retiring the CSS-only hover fallback. @public */
export const TOOLTIP_MOUNTED_ATTR = "data-tooltip-mounted";
