/** Every state attribute forge emits; booleans are emitted by presence with an empty value. @public */
export const STATE_ATTRS = {
  /** Present while a popup, disclosure or overlay is open. */
  open: "data-open",
  /** Present while it is closed. Paired with `open`: exactly one of the two is always present. */
  closed: "data-closed",
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
  /** Present for one frame as the component begins animating in. */
  startingStyle: "data-starting-style",
  /** Present while the component is animating out. */
  endingStyle: "data-ending-style",
  /** Present on a trigger while the popup it controls is open. */
  popupOpen: "data-popup-open",
} as const;

/** One of the declared state-attribute names. @public */
export type StateAttrName = (typeof STATE_ATTRS)[keyof typeof STATE_ATTRS];

/** Layout axis; `responsive` means "vertical until the container is wide enough". @public */
export type Orientation = "horizontal" | "vertical" | "responsive";

/** Side a popup is positioned on, in either physical or logical spelling. @public */
export type Side = "top" | "right" | "bottom" | "left" | "block-start" | "block-end" | "inline-start" | "inline-end";

/** Alignment of a popup along its side. @public */
export type Align = "start" | "center" | "end";

/** Animation phase, when a component is transitioning rather than at rest. @public */
export type TransitionState = "starting" | "ending";

/** The states a forge component can declare; an omitted key differs from `false`. @public */
export interface StateAttrsProps {
  /** `true` → `data-open`, `false` → `data-closed`. The pair is exhaustive. */
  open?: boolean;
  pressed?: boolean;
  checked?: boolean;
  selected?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  popupOpen?: boolean;
  orientation?: Orientation;
  side?: Side;
  align?: Align;
  /** `"starting"` → `data-starting-style`, `"ending"` → `data-ending-style`; `null` clears both. */
  transition?: TransitionState | null;
}

// Literal keys, never `STATE_ATTRS.open`: a runtime reference would retain the whole table in
// every bundle that spreads one of these hooks.
const OPEN_HOOK = { "data-open": "" };
const CLOSED_HOOK = { "data-closed": "" };
const PRESSED_HOOK = { "data-pressed": "" };
const CHECKED_HOOK = { "data-checked": "" };
const SELECTED_HOOK = { "data-selected": "" };
const DISABLED_HOOK = { "data-disabled": "" };
const INVALID_HOOK = { "data-invalid": "" };
const POPUP_OPEN_HOOK = { "data-popup-open": "" };
const STARTING_HOOK = { "data-starting-style": "" };
const ENDING_HOOK = { "data-ending-style": "" };

/** Which attributes each state key owns. */
const GOVERNS: Record<keyof StateAttrsProps, readonly StateAttrName[]> = {
  open: ["data-open", "data-closed"],
  pressed: ["data-pressed"],
  checked: ["data-checked"],
  selected: ["data-selected"],
  disabled: ["data-disabled"],
  invalid: ["data-invalid"],
  popupOpen: ["data-popup-open"],
  orientation: ["data-orientation"],
  side: ["data-side"],
  align: ["data-align"],
  transition: ["data-starting-style", "data-ending-style"],
};

/** Builds the state attributes for an SSR element, to be spread onto it. @public */
export function stateAttrs(state: StateAttrsProps): Record<string, string> {
  return {
    ...(state.open === undefined ? {} : state.open ? OPEN_HOOK : CLOSED_HOOK),
    ...(state.pressed ? PRESSED_HOOK : {}),
    ...(state.checked ? CHECKED_HOOK : {}),
    ...(state.selected ? SELECTED_HOOK : {}),
    ...(state.disabled ? DISABLED_HOOK : {}),
    ...(state.invalid ? INVALID_HOOK : {}),
    ...(state.popupOpen ? POPUP_OPEN_HOOK : {}),
    ...(state.transition === "starting" ? STARTING_HOOK : {}),
    ...(state.transition === "ending" ? ENDING_HOOK : {}),
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
