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
