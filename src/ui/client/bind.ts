import { applyStateAttrs } from "../contracts/state-attrs";
import { closestAcross } from "./dom";
import type { ResumeContext } from "./resume";
import type { SignalRecord } from "./signal-record";
import { writeSignal } from "./signal-record";

/** Minimal control surface read/written by the binding helpers (a checkbox or value input). */
interface ControlElement {
  checked: boolean;
  value: string;
}

/**
 * Parse a control element to the type of the value it drives, inferred from the `current` value:
 * a `boolean` reads `checked`, a `number` reads `Number(value)`, anything else reads the raw
 * `value` string. Pair with {@link applyControlValue} for the inverse. @public
 */
export function parseControlValue<T>(el: ControlElement, current: T): T {
  if (typeof current === "boolean") return el.checked as unknown as T;
  if (typeof current === "number") return Number(el.value) as unknown as T;
  return el.value as unknown as T;
}

/**
 * Seed a control element from a typed value — the inverse of {@link parseControlValue}. A `boolean`
 * sets `checked`; anything else sets `value` (stringified). Use it to re-seed uncontrolled inputs
 * after a programmatic signal write (e.g. a "reset" action). @public
 */
export function applyControlValue(el: ControlElement, value: unknown): void {
  if (typeof value === "boolean") el.checked = value;
  else el.value = String(value);
}

/**
 * Build a resumable-scope action that two-way-binds controls to a `SignalRecord`. On the bound
 * event, it reads the field name from the control's `data-field` attribute (stamped server-side by
 * `fieldAttr`), parses the control's value by the signal's current type, and writes it into
 * `signals[field]`. Register it under the action name the controls reference:
 *
 *     registerScope("chrome", { on: { bindField: bindField(sig), ...appActions } })
 *
 * forge owns this generic field↔signal glue; the app layers its own effects (persist, render,
 * readouts) on the same signals. @public
 */
export function bindField<T extends Record<string, unknown>>(signals: SignalRecord<T>): (ctx: ResumeContext) => void {
  return ({ el }) => {
    const field = el.dataset.field as keyof T | undefined;
    if (field == null || !(field in signals)) return;
    writeSignal(signals, field, parseControlValue(el as unknown as ControlElement, signals[field].value));
  };
}

/** Write both halves of an item's pressed state: the ARIA property assistive technology reads, and
 * the `data-pressed` hook CSS reads. `applyStateAttrs` owns the data half so the name can never
 * drift from the one `core/toggle-group.tsx` renders in a different bundle. */
function setPressed(item: HTMLElement, pressed: boolean): void {
  applyStateAttrs(item, { pressed });
  item.setAttribute("aria-pressed", String(pressed));
}

function isPressed(item: HTMLElement): boolean {
  return item.getAttribute("aria-pressed") === "true";
}

/**
 * Build a resumable-scope action that binds a button group (segmented control) to a `SignalRecord`
 * **and reconciles the pressed state across the whole group**.
 *
 * This function used to write the signal and stop, with its own doc comment sending pressed-state
 * reconciliation back to the application as "an effect on the same signal". That single sentence is
 * why a segmented control was styled initial markup rather than a primitive, and why an app would
 * hand-roll its own toolbar instead of adopting this one. The reconciliation is forge's now:
 *
 * - **`type="single"`** (the default) — the clicked item becomes the only pressed one, every sibling
 *   is cleared, and the signal receives the clicked item's `data-value` string.
 * - **`type="multiple"`** — the clicked item toggles on its own, siblings are untouched, and the
 *   signal receives the array of values currently pressed.
 *
 * Which of the two applies is read from the group's `data-multiple` attribute, emitted by
 * `core/toggle-group.tsx` from its `type` prop — so the client behaviour and the announced semantics
 * come from one declaration rather than two.
 *
 * The group is the nearest `[data-slot='toggle-group']` ancestor, falling back to the scope root, so
 * two independent groups inside one scope reconcile independently. Button elements cannot express a
 * boolean or numeric value, so `parseControlValue` is bypassed and `data-value` is used raw.
 *
 *     registerScope("chrome", { on: { bindField: bindField(sig), bindGroup: bindGroup(sig) } })
 * @public
 */
export function bindGroup<T extends Record<string, unknown>>(signals: SignalRecord<T>): (ctx: ResumeContext) => void {
  return ({ root, el }) => {
    // Shadow-safe, and it also absorbs a click that landed on an inner `<svg>` or `<span>`.
    const target = closestAcross(el, "[data-field][data-value]");
    if (target == null) return;
    const field = target.dataset.field as keyof T | undefined;
    const value = target.dataset.value;
    if (field == null || !(field in signals) || value == null) return;

    const group = closestAcross(target, "[data-slot='toggle-group']") ?? root;
    const items = [...group.querySelectorAll<HTMLElement>("[data-field][data-value]")].filter((item) => item.dataset.field === field);

    if (group.hasAttribute("data-multiple")) {
      setPressed(target, !isPressed(target));
      const pressed = items.filter(isPressed).map((item) => item.dataset.value ?? "");
      writeSignal(signals, field, pressed as T[typeof field]);
      return;
    }

    for (const item of items) setPressed(item, item === target);
    writeSignal(signals, field, value as T[typeof field]);
  };
}
