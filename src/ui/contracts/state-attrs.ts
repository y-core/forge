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
  /** Layout axis — `horizontal` or `vertical`. Valued, not a presence flag. */
  orientation: "data-orientation",
  /** Which side a popup sits on relative to its anchor. Valued. */
  side: "data-side",
  /** How a popup is aligned along that side. Valued. */
  align: "data-align",
} as const;

/** One of the declared state-attribute names. @public */
export type StateAttrName = (typeof STATE_ATTRS)[keyof typeof STATE_ATTRS];

/** Layout axis; `responsive` means "vertical until the container is wide enough". @public */
export type Orientation = "horizontal" | "vertical" | "responsive";

/** Side a popup is positioned on, in either physical or logical spelling. @public */
export type Side = "top" | "right" | "bottom" | "left" | "block-start" | "block-end" | "inline-start" | "inline-end";

/** Alignment of a popup along its side. @public */
export type Align = "start" | "center" | "end";

/** The states a forge component can declare; an omitted key differs from `false`. @public */
export interface StateAttrsProps {
  pressed?: boolean;
  checked?: boolean;
  selected?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  orientation?: Orientation;
  side?: Side;
  align?: Align;
}

// Literal keys, never `STATE_ATTRS.pressed`: a runtime reference would retain the whole table in
// every bundle that spreads one of these hooks.
const PRESSED_HOOK = { "data-pressed": "" };
const CHECKED_HOOK = { "data-checked": "" };
const SELECTED_HOOK = { "data-selected": "" };
const DISABLED_HOOK = { "data-disabled": "" };
const INVALID_HOOK = { "data-invalid": "" };

/** Which attributes each state key owns. */
const GOVERNS: Record<keyof StateAttrsProps, readonly StateAttrName[]> = {
  pressed: ["data-pressed"],
  checked: ["data-checked"],
  selected: ["data-selected"],
  disabled: ["data-disabled"],
  invalid: ["data-invalid"],
  orientation: ["data-orientation"],
  side: ["data-side"],
  align: ["data-align"],
};

/** Builds the state attributes for an SSR element, to be spread onto it. @public */
export function stateAttrs(state: StateAttrsProps): Record<string, string> {
  return {
    ...(state.pressed ? PRESSED_HOOK : {}),
    ...(state.checked ? CHECKED_HOOK : {}),
    ...(state.selected ? SELECTED_HOOK : {}),
    ...(state.disabled ? DISABLED_HOOK : {}),
    ...(state.invalid ? INVALID_HOOK : {}),
    ...(state.orientation ? { "data-orientation": state.orientation } : {}),
    ...(state.side ? { "data-side": state.side } : {}),
    ...(state.align ? { "data-align": state.align } : {}),
  };
}

/** Reconciles the attributes owned by each present state key on a live element. @public */
export function applyStateAttrs(el: Element, state: StateAttrsProps): void {
  const next = stateAttrs(state);
  for (const key of Object.keys(state) as Array<keyof StateAttrsProps>) {
    if (state[key] === undefined) continue;
    for (const name of GOVERNS[key]) {
      const value = next[name];
      if (value === undefined) el.removeAttribute(name);
      else el.setAttribute(name, value);
    }
  }
}
