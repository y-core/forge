import { applyStateAttrs } from "../contracts/state-attrs";
import { asElement, closestAcross, contains, eventTarget, ownerDocument, ownerWindow, queryTrees, shadowTrees } from "./dom";
import { effect } from "./signal";
import type { SignalRecord } from "./types";

interface ControlElement extends HTMLElement {
  checked?: boolean;
  value?: string;
  form?: HTMLFormElement | null;
}

const FIELD_SELECTOR = "[data-field]";

// Tag-name rather than `instanceof`: a control inside a shadow tree may come from another document.
function isMultiSelect(el: ControlElement): el is ControlElement & HTMLSelectElement {
  return el.tagName === "SELECT" && (el as ControlElement & HTMLSelectElement).multiple;
}

function isFileInput(el: ControlElement): boolean {
  return el.tagName === "INPUT" && (el as ControlElement & HTMLInputElement).type === "file";
}

/** Reads a control as the type the signal it drives already holds. @internal */
export function readControl(el: ControlElement, current: unknown): unknown {
  const tagged = el.dataset.value;
  if (Array.isArray(current)) {
    if (isMultiSelect(el)) return [...el.selectedOptions].map((option) => option.value);
    if (tagged === undefined) return current;
    // Read, not flipped, because one interaction fires `input`, `change` *and* `click`: a flip would
    // run three times and land back where it started.
    const next = typeof el.checked === "boolean" ? el.checked : !current.includes(tagged);
    if (!next) return current.filter((entry) => entry !== tagged);
    return current.includes(tagged) ? current : [...current, tagged];
  }
  if (typeof current === "boolean") return tagged === undefined ? el.checked === true : isChosen(el, true);
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

/** Paints one control from the signal, skipping a write that would not change it. @internal */
// The differs-check is not an optimisation: assigning `value` mid-drag resets a range input's
// interaction, so a paint that agrees with the DOM has to be a no-op.
export function paintControl(el: ControlElement, value: unknown): void {
  if (el.dataset.value !== undefined) {
    const chosen = isChosen(el, value);
    if (typeof el.checked === "boolean") {
      if (el.checked !== chosen) el.checked = chosen;
      return;
    }
    if (el.getAttribute("aria-pressed") !== String(chosen)) el.setAttribute("aria-pressed", String(chosen));
    if (el.hasAttribute("data-pressed") !== chosen) applyStateAttrs(el, { pressed: chosen });
    return;
  }
  if (typeof value === "boolean") {
    if (el.checked !== value) el.checked = value;
    return;
  }
  // The `value` setter on a file input throws `InvalidStateError` for anything but `""`, and `effect`
  // rethrows on its first run, which would leave every sibling control in the scope unbound.
  if (isFileInput(el)) return;
  if (typeof value === "number") {
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
  const onInteract = (event: Event) => {
    const el = closestAcross<ControlElement>(asElement(eventTarget(event)), FIELD_SELECTOR);
    if (!el || !contains(root, el)) return;
    const field = el.dataset.field as keyof T | undefined;
    if (field === undefined) return;
    const signal = signals[field];
    if (signal === undefined) {
      console.warn(`[bindControls] data-field="${String(field)}" names no signal in this scope`);
      return;
    }
    signal.value = readControl(el, signal.value) as T[typeof field];
  };

  let trees = shadowTrees(root);

  // Every shadow root under a bound root is a consumer's, forge authoring none (`UI_SSR_COMPONENTS.md` §1k); a detached one still answers
  // `querySelectorAll`, so its stale hit would read as live and the control the swap put on screen would never be painted.
  const isStale = (tree: Element | Document | DocumentFragment): boolean => {
    const host = (tree as Partial<ShadowRoot>).host;
    return host != null && !contains(root, host);
  };

  const paintField = (field: keyof T, value: unknown) => {
    const selector = `[data-field="${CSS.escape(String(field))}"]`;
    let found = trees.some(isStale) ? [] : queryTrees<ControlElement>(trees, selector);
    if (found.length === 0) {
      trees = shadowTrees(root);
      found = queryTrees<ControlElement>(trees, selector);
    }
    for (const el of found) paintControl(el, value);
  };

  const disposers = (Object.keys(signals) as Array<keyof T>).map((field) => effect(() => paintField(field, signals[field].value)));

  const doc = ownerDocument(root);
  const lifetime = new AbortController();
  const onReset = (event: Event) => {
    const form = event.target as Node | null;
    if (!form) return;
    const governed = contains(form, root) || queryTrees<ControlElement>(shadowTrees(root), FIELD_SELECTOR).some((el) => el.form === form);
    if (!governed) return;
    // A reset the reader clicks drains microtasks between firing `reset` and reverting the controls,
    // so the repaint waits a task, which runs after the revert either way.
    ownerWindow(root).setTimeout(() => {
      if (lifetime.signal.aborted) return;
      trees = shadowTrees(root);
      for (const field of Object.keys(signals) as Array<keyof T>) paintField(field, signals[field].value);
    }, 0);
  };
  doc.addEventListener("reset", onReset, { capture: true, signal: lifetime.signal });
  for (const tree of trees) {
    if (tree.nodeType !== 11) continue;
    tree.addEventListener("change", onInteract, { signal: lifetime.signal });
    tree.addEventListener("reset", onReset, { capture: true, signal: lifetime.signal });
  }

  root.addEventListener("input", onInteract, { signal: lifetime.signal });
  root.addEventListener("change", onInteract, { signal: lifetime.signal });
  root.addEventListener("click", onInteract, { signal: lifetime.signal });

  return () => {
    for (const dispose of disposers) dispose();
    lifetime.abort();
  };
}
