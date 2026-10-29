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
  /** A component-local enum a stylesheet reads. Valued. Never a serialized payload — that is `data-island-state`. */
  state: "data-state",
  /** Present while a tooltip opened inside the warm window, so its enter skips the fade. */
  instant: "data-instant",
  /** Present from a dismissal until the element is removed — what the exit fade keys on. */
  dismissing: "data-dismissing",
} as const;

// Literal keys, never `STATE_ATTRS.pressed`: a runtime reference would retain the whole table in
// every bundle that calls `stateAttrs`.
/** Builds the state attributes for an SSR element, to be spread onto it. @public */
export function stateAttrs(state: StateAttrsProps): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (state.pressed) attrs["data-pressed"] = "";
  if (state.checked) attrs["data-checked"] = "";
  if (state.selected) attrs["data-selected"] = "";
  if (state.disabled) attrs["data-disabled"] = "";
  if (state.invalid) attrs["data-invalid"] = "";
  if (state.busy) attrs["data-busy"] = "";
  if (state.orientation) attrs["data-orientation"] = state.orientation;
  if (state.side) attrs["data-side"] = state.side;
  if (state.align) attrs["data-align"] = state.align;
  if (state.state) attrs["data-state"] = state.state;
  return attrs;
}

// `location` is the in-page marker: the reader moved *within* a page that never navigated, which is
// what a fragment link does — `client/scroll-spy.ts` marks a spied section the same way.
/** The current pair: `aria-current` in `kind`'s spelling beside `data-selected`. @public */
export function currentAttrs(current: boolean, kind: "page" | "location" = "page"): Record<string, string> {
  return { ...(current ? { "aria-current": kind } : {}), ...stateAttrs({ selected: current }) };
}

/** Reconciles the attributes owned by each present state key on a live element. @public */
export function applyStateAttrs(el: Element, state: StateAttrsProps): void {
  const next = stateAttrs(state);
  for (const key of Object.keys(state) as Array<keyof StateAttrsProps>) {
    if (state[key] === undefined) continue;
    const name = STATE_ATTRS[key];
    const value = next[name];
    if (value === undefined) el.removeAttribute(name);
    else el.setAttribute(name, value);
  }
}
