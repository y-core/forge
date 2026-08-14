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

/** Parses a control element to the type of the value it drives, inferred from `current`. @public */
export function parseControlValue<T>(el: ControlElement, current: T): T {
  if (typeof current === "boolean") return el.checked as unknown as T;
  if (typeof current === "number") return Number(el.value) as unknown as T;
  return el.value as unknown as T;
}

/** Seeds a control element from a typed value — the inverse of {@link parseControlValue}. @public */
export function applyControlValue(el: ControlElement, value: unknown): void {
  if (typeof value === "boolean") el.checked = value;
  else el.value = String(value);
}

/** Builds a resumable-scope action that two-way-binds `data-field` controls to a `SignalRecord`. @public */
export function bindField<T extends Record<string, unknown>>(signals: SignalRecord<T>): (ctx: ResumeContext) => void {
  return ({ el }) => {
    const field = el.dataset.field as keyof T | undefined;
    if (field == null || !(field in signals)) return;
    writeSignal(signals, field, parseControlValue(el as unknown as ControlElement, signals[field].value));
  };
}

/** Writes both halves of an item's pressed state: the ARIA property and the `data-pressed` CSS hook. */
function setPressed(item: HTMLElement, pressed: boolean): void {
  applyStateAttrs(item, { pressed });
  item.setAttribute("aria-pressed", String(pressed));
}

function isPressed(item: HTMLElement): boolean {
  return item.getAttribute("aria-pressed") === "true";
}

/** Builds a resumable-scope action that binds a button group to a `SignalRecord` and reconciles the pressed state across the group. @public */
export function bindGroup<T extends Record<string, unknown>>(signals: SignalRecord<T>): (ctx: ResumeContext) => void {
  return ({ root, el }) => {
    // Shadow-safe, and it also absorbs a click that landed on an inner `<svg>` or `<span>`.
    const target = closestAcross(el, "[data-field][data-value]");
    if (target == null) return;
    const field = target.dataset.field as keyof T | undefined;
    const value = target.dataset.value;
    if (field == null || !(field in signals) || value == null) return;

    const group = closestAcross(target, "[data-slot~='toggle-group']") ?? root;
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
