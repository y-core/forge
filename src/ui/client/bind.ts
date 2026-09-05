import { asElement, closestAcross, contains, eventTarget, ownerDocument, ownerWindow, queryAcross } from "./dom";
import { effect } from "./signal";
import type { SignalRecord } from "./signal-record";

/** The controls a `[data-field]` can resolve to; a group item carries `data-value` instead of `value`. */
interface ControlElement extends HTMLElement {
  checked?: boolean;
  value?: string;
}

const FIELD_SELECTOR = "[data-field]";

/** Tag-name rather than `instanceof`: a control inside a shadow tree may come from another document. */
function isMultiSelect(el: ControlElement): el is ControlElement & HTMLSelectElement {
  return el.tagName === "SELECT" && (el as ControlElement & HTMLSelectElement).multiple;
}

function isFileInput(el: ControlElement): boolean {
  return el.tagName === "INPUT" && (el as ControlElement & HTMLInputElement).type === "file";
}

/** Reads a control as the type the signal it drives already holds.
 *
 * Inference from the current value is what lets a button group express a boolean, a number or a
 * multi-select, which the pressed-state-in-the-DOM design could not. @internal */
export function readControl(el: ControlElement, current: unknown): unknown {
  const tagged = el.dataset.value;
  if (Array.isArray(current)) {
    // A multi-select carries the whole answer in `selectedOptions`; there is no per-item `data-value`
    // to flip, so without this the signal never moves at all.
    if (isMultiSelect(el)) return [...el.selectedOptions].map((option) => option.value);
    if (tagged === undefined) return current;
    // A real checkbox already carries the answer; reading it rather than flipping membership is what
    // makes this idempotent, and it has to be — one interaction on an input fires `input`, `change`
    // *and* `click`, so a flip would run three times and land back where it started.
    const next = typeof el.checked === "boolean" ? el.checked : !current.includes(tagged);
    if (!next) return current.filter((entry) => entry !== tagged);
    return current.includes(tagged) ? current : [...current, tagged];
  }
  if (typeof current === "boolean") return tagged === undefined ? el.checked === true : true;
  const raw = tagged ?? el.value ?? "";
  // `Number("")` is 0, which would refill a numeric field the reader has just cleared. NaN keeps the
  // signal a number — so the inference above still holds — and `paintControl` declines to paint it.
  if (typeof current === "number") return raw.trim() === "" ? Number.NaN : Number(raw);
  return raw;
}

/** Whether a group item is the one `value` selects. @internal */
export function isChosen(item: ControlElement, value: unknown): boolean {
  const tagged = item.dataset.value ?? "";
  if (Array.isArray(value)) return value.includes(tagged);
  return String(value) === tagged;
}

/** Paints one control from the signal, skipping a write that would not change it.
 *
 * The differs-check is load-bearing rather than an optimisation: assigning `value` mid-drag resets a
 * range input's interaction, so a paint that agrees with the DOM has to be a no-op. @internal */
export function paintControl(el: ControlElement, value: unknown): void {
  if (el.dataset.value !== undefined) {
    const chosen = isChosen(el, value);
    // A real input owns its own checkedness, and the CSS keys on `:checked`; only a button surrogate
    // needs the ARIA and state-attribute pair painted for it.
    if (typeof el.checked === "boolean") {
      if (el.checked !== chosen) el.checked = chosen;
      return;
    }
    if (el.getAttribute("aria-pressed") !== String(chosen)) el.setAttribute("aria-pressed", String(chosen));
    if (el.hasAttribute("data-pressed") !== chosen) el.toggleAttribute("data-pressed", chosen);
    return;
  }
  if (typeof value === "boolean") {
    if (el.checked !== value) el.checked = value;
    return;
  }
  // The `value` setter on a file input throws `InvalidStateError` for anything but `""`, and `effect`
  // rethrows on its first run — which would abort `bindControls`' `.map()` and leave every sibling
  // control in the scope unbound.
  if (isFileInput(el)) return;
  if (typeof value === "number") {
    // NaN is what `readControl` reports for a cleared or unparseable numeric field (`""`, `-`).
    if (!Number.isFinite(value)) return;
    // A numeric compare, not the string one below: `1.` reads back as 1, and painting `"1"` over it
    // would delete the decimal point the reader is typing past. An empty field is not a 0 to keep.
    const raw = el.value ?? "";
    if (raw.trim() !== "" && Number(raw) === value) return;
  }
  if (isMultiSelect(el)) {
    // `el.value = "a,b"` matches no option and wipes the server-rendered selection.
    const wanted = new Set((Array.isArray(value) ? value : [value]).map(String));
    for (const option of el.options) {
      const chosen = wanted.has(option.value);
      if (option.selected !== chosen) option.selected = chosen;
    }
    return;
  }
  const next = String(value);
  if (el.value !== next) el.value = next;
}

/** Two-way-binds every `[data-field]` control under `root` to `signals`, and returns a disposer. @public */
export function bindControls<T extends Record<string, unknown>>(root: HTMLElement, signals: SignalRecord<T>): () => void {
  // One listener on the widget's own root rather than one per control, so controls swapped in later
  // are bound with no re-mount. `closestAcross` absorbs a click that landed on an inner icon or span.
  const onInteract = (event: Event) => {
    const el = closestAcross<ControlElement>(asElement(eventTarget(event)), FIELD_SELECTOR);
    if (!el || !contains(root, el)) return;
    const field = el.dataset.field as keyof T | undefined;
    if (field === undefined) return;
    const signal = signals[field];
    if (signal === undefined) {
      // A property of the markup, not of the call site, so it reports rather than throws.
      console.warn(`[bindControls] data-field="${String(field)}" names no signal in this scope`);
      return;
    }
    signal.value = readControl(el, signal.value) as T[typeof field];
  };

  const paintField = (field: keyof T, value: unknown) => {
    for (const el of queryAcross<ControlElement>(root, `[data-field="${CSS.escape(String(field))}"]`)) paintControl(el, value);
  };

  // One effect per field, not one over all of them: a repaint then touches only the controls whose
  // own signal moved. The signal is the state and the DOM is a paint of it, so nothing is read back.
  const disposers = (Object.keys(signals) as Array<keyof T>).map((field) => effect(() => paintField(field, signals[field].value)));

  // A native form reset reverts every control to its server-rendered value without firing `input` or
  // `change`, so nothing above would notice — and a bound widget would sit contradicting the signal
  // that is meant to be the state. A microtask, not a timer: the reset algorithm runs synchronously
  // after the event is dispatched, so the queue drains at the end of that same task.
  const onReset = (event: Event) => {
    const form = event.target as Node | null;
    if (!form || !contains(form, root)) return;
    ownerWindow(root).queueMicrotask(() => {
      for (const field of Object.keys(signals) as Array<keyof T>) paintField(field, signals[field].value);
    });
  };
  const doc = ownerDocument(root);
  // Capture, because `reset` is dispatched at the form: a bubble-phase listener on the document sees
  // it, but only a capture one is guaranteed to when the form sits inside a shadow tree.
  doc.addEventListener("reset", onReset, true);

  root.addEventListener("input", onInteract);
  root.addEventListener("change", onInteract);
  root.addEventListener("click", onInteract);

  return () => {
    for (const dispose of disposers) dispose();
    doc.removeEventListener("reset", onReset, true);
    root.removeEventListener("input", onInteract);
    root.removeEventListener("change", onInteract);
    root.removeEventListener("click", onInteract);
  };
}
