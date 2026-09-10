import type { StateAttrsProps } from "./types";
/** Every state attribute forge emits; booleans are emitted by presence with an empty value. @public */
export const STATE_ATTRS = {
  /** Present while a pressable trigger or toggle item is pressed. */
  pressed: "data-pressed",
  /** Present while a checkable control is checked. */
  checked: "data-checked",
  /** Present while a tab is the selected one. */
  selected: "data-selected",
  /** Present while the component is disabled. */
  disabled: "data-disabled",
  /** Present while the component holds a validation error. */
  invalid: "data-invalid",
  /** Present while the component is waiting on work it started — a submitting button, a loading field. */
  busy: "data-busy",
  /** Layout axis — `horizontal` or `vertical`. Valued, not a presence flag. */
  orientation: "data-orientation",
  /** Which side a popup sits on relative to its anchor. Valued. */
  side: "data-side",
  /** How a popup is aligned along that side. Valued. */
  align: "data-align",
} as const;

// Literal keys, never `STATE_ATTRS.pressed`: a runtime reference would retain the whole table in
// every bundle that spreads one of these hooks.
const PRESSED_HOOK = { "data-pressed": "" };
const CHECKED_HOOK = { "data-checked": "" };
const SELECTED_HOOK = { "data-selected": "" };
const DISABLED_HOOK = { "data-disabled": "" };
const INVALID_HOOK = { "data-invalid": "" };
const BUSY_HOOK = { "data-busy": "" };

/** Builds the state attributes for an SSR element, to be spread onto it. @public */
export function stateAttrs(state: StateAttrsProps): Record<string, string> {
  return {
    ...(state.pressed ? PRESSED_HOOK : {}),
    ...(state.checked ? CHECKED_HOOK : {}),
    ...(state.selected ? SELECTED_HOOK : {}),
    ...(state.disabled ? DISABLED_HOOK : {}),
    ...(state.invalid ? INVALID_HOOK : {}),
    ...(state.busy ? BUSY_HOOK : {}),
    ...(state.orientation ? { "data-orientation": state.orientation } : {}),
    ...(state.side ? { "data-side": state.side } : {}),
    ...(state.align ? { "data-align": state.align } : {}),
  };
}

// `forge-ui-a11y-aria-beside-data` requires the two to move together, and four components had
// written the pair by hand — an invariant that held by vigilance rather than by construction.
/** The current-page pair: `aria-current="page"` beside `data-selected`. @public */
export function currentAttrs(current: boolean): Record<string, string> {
  return { ...(current ? { "aria-current": "page" } : {}), ...stateAttrs({ selected: current }) };
}

/** Reconciles the attributes owned by each present state key on a live element. @public */
export function applyStateAttrs(el: Element, state: StateAttrsProps): void {
  const next = stateAttrs(state);
  // Read straight off the table each key is declared in. A second map of key→attribute had no
  // compile-time link to it, so a key omitted there threw here rather than failing the build.
  for (const key of Object.keys(state) as Array<keyof StateAttrsProps>) {
    if (state[key] === undefined) continue;
    const name = STATE_ATTRS[key];
    const value = next[name];
    if (value === undefined) el.removeAttribute(name);
    else el.setAttribute(name, value);
  }
}
