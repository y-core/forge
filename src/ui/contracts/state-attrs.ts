/**
 * Single source of truth for the **state attributes** forge's UI emits — the styling hooks CSS
 * matches on to react to a component's state.
 *
 * A state attribute is written in two places that cannot see each other: an SSR component in
 * `ui/core/*.tsx` that runs on the Worker, and a client controller in `ui/client/*.ts` that runs in
 * the browser. Nothing but a shared module keeps those in lockstep, and drift here is *silent* — the
 * selector simply stops matching, so the component looks unstyled rather than broken. This is the
 * same argument that produced `scope-events.ts`, and this module is its sibling: pure data plus pure
 * functions, side-effect-free, safe to import into either bundle.
 *
 * The same argument reaches one step further out, which is why this is published rather than
 * internal: an app consuming forge's components has to *address* this DOM, and with no export its
 * only option is to re-type every name as a string literal — a third writer of the same attribute,
 * in a repository this package's gate cannot see.
 *
 * **Boolean states are emitted by presence, with an empty value (`data-open=""`), never `"true"`.**
 * `[data-open]` is a cheaper and more honest selector than `[data-open="true"]`. `aria-*` keeps its
 * `"true"` / `"false"` string form because WAI-ARIA requires it — the whole point of `data-pressed`
 * beside `aria-pressed` is that CSS should not have to read ARIA.
 */

/**
 * Every state attribute forge emits. Adding a styling hook means adding it here first.
 * @public
 */
export const STATE_ATTRS = {
  /** Present while a popup, disclosure or overlay is open. */
  open: "data-open",
  /** Present while it is closed. Paired with `open`: exactly one of the two is always present. */
  closed: "data-closed",
  /** Present while a pressable trigger or toggle item is pressed. */
  pressed: "data-pressed",
  /** Present while a checkable control is checked. */
  checked: "data-checked",
  /** Present while a tab is the selected one. Distinct from `checked`: ARIA models tab selection as
   * `aria-selected`, not `aria-checked`, and conflating them would announce a tab as a radio. */
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
  /** Present on a *trigger* while the popup it controls is open — the trigger's own state, distinct
   * from `open`, which belongs to the popup. */
  popupOpen: "data-popup-open",
} as const;

/**
 * One of the declared state-attribute names.
 * @public
 */
export type StateAttrName = (typeof STATE_ATTRS)[keyof typeof STATE_ATTRS];

/** Layout axis. Composites use `horizontal` / `vertical`; `responsive` is a field-layout value
 * meaning "vertical until the container is wide enough", and only `FormField` emits it.
 * @public
 */
export type Orientation = "horizontal" | "vertical" | "responsive";

/**
 * Side a popup is positioned on, relative to its anchor.
 * @public
 */
export type Side = "top" | "right" | "bottom" | "left";

/**
 * Alignment of a popup along its side.
 * @public
 */
export type Align = "start" | "center" | "end";

/**
 * Animation phase, when a component is transitioning rather than at rest.
 * @public
 */
export type TransitionState = "starting" | "ending";

/**
 * The states a forge component can declare. Every key is optional and an omitted key means
 * "this component has no such state" — which is different from `false`, and matters to
 * {@link applyStateAttrs}, where an omitted key is left untouched rather than removed.
 * @public
 */
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
  /** `"starting"` → `data-starting-style`, `"ending"` → `data-ending-style`. Pass `null` to say
   * "at rest", which clears both — distinct from omitting the key, which leaves them untouched. */
  transition?: TransitionState | null;
}

// Literal keys, never `STATE_ATTRS.open`. A runtime reference to the table above would retain the
// whole object in every bundle that spreads one of these hooks; the literals let it be dropped from
// the SSR and browser builds alike. Base UI's `popupStateMapping.ts` makes the same trade for the
// same reason.
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

/** Which attributes each state key owns — the one table that keeps the SSR builder below and the
 * client mutator writing and clearing exactly the same names. */
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

/**
 * Build the state attributes for an SSR element. Spread the result:
 * `<div {...stateAttrs({ open, side, align })}>`. Falsy presence states emit nothing at all, so an
 * unstyled state costs no bytes.
 * @public
 */
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

/**
 * Reconcile the same state attributes on a live element — the browser-side half of the contract, so
 * a controller can never disagree with the component that rendered the markup.
 *
 * Only the keys actually present in `state` are touched: a controller that flips `open` leaves a
 * `data-orientation` stamped by SSR alone. Within a touched key the reconciliation is total — the
 * attributes that key owns are set or removed, so `open: false` clears `data-open` *and* writes
 * `data-closed` in one call.
 * @public
 */
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
