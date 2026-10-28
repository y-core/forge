import {
  BIND_ATTR_ATTR,
  BIND_TEXT_ATTR,
  ENUMERATED_BOUND_ATTRS,
  isBindAttrRefused,
  isBoundScriptUrl,
  parseBindAttr,
  safeBindAttrValue,
} from "../contracts/bind-contract";
import { queryAcross } from "./dom";
import { effect } from "./signal";
import type { SignalRecord } from "./types";
import type { BindTextOptions } from "./types";

/** The signal a binding element names, or `undefined` after reporting that it names none. */
function resolve<T extends Record<string, unknown>>(signals: SignalRecord<T>, field: string, attr: string) {
  const signal = signals[field as keyof T];
  // A property of the markup, not of the call site, so it reports rather than throws — the same
  // posture `bindControls` takes for an unknown `data-field`.
  if (signal === undefined) console.warn(`[${attr}] "${field}" names no signal in this scope`);
  return signal;
}

/** Runs `bind` for every element under `root` carrying `attr`, and returns one disposer for all of them. */
function bindEach(root: HTMLElement, attr: string, bind: (el: HTMLElement, value: string) => (() => void) | undefined): () => void {
  const disposers: Array<() => void> = [];
  for (const el of queryAcross<HTMLElement>(root, `[${attr}]`)) {
    const dispose = bind(el, el.getAttribute(attr) ?? "");
    if (dispose) disposers.push(dispose);
  }
  return () => {
    for (const dispose of disposers) dispose();
  };
}

/** Binds every `[data-bind-text]` under `root` to the signal it names, and returns a disposer. @public */
export function bindText<T extends Record<string, unknown>>(
  root: HTMLElement,
  signals: SignalRecord<T>,
  options: BindTextOptions = {},
): () => void {
  const format = options.format ?? String;
  return bindEach(root, BIND_TEXT_ATTR, (el, field) => {
    const signal = resolve(signals, field, BIND_TEXT_ATTR);
    if (signal === undefined) return undefined;
    return effect(() => {
      const next = format(signal.value);
      // Guarded rather than assigned unconditionally: writing `textContent` replaces the node even
      // when the string is identical, which collapses any selection the reader had inside it.
      if (el.textContent !== next) el.textContent = next;
    });
  });
}

/** The keyword a bound boolean is written as, or `undefined` where presence carries it. */
function spellBoundBoolean(attribute: string, value: boolean): string | undefined {
  const lower = attribute.toLowerCase();
  if (lower.startsWith("aria-")) return String(value);
  const spelling = ENUMERATED_BOUND_ATTRS.get(lower);
  return spelling?.[value ? 0 : 1];
}

/** Binds every `[data-bind-attr]` under `root` to the signal it names, and returns a disposer. @public */
export function bindAttr<T extends Record<string, unknown>>(root: HTMLElement, signals: SignalRecord<T>): () => void {
  return bindEach(root, BIND_ATTR_ATTR, (el, spec) => {
    const parsed = parseBindAttr(spec);
    if (parsed === null) {
      console.warn(`[${BIND_ATTR_ATTR}] "${spec}" is not an "attribute:field" pair`);
      return undefined;
    }
    if (isBindAttrRefused(parsed.attribute)) {
      console.warn(`[${BIND_ATTR_ATTR}] "${parsed.attribute}" may not be bound to a signal`);
      return undefined;
    }
    const signal = resolve(signals, parsed.field, BIND_ATTR_ATTR);
    if (signal === undefined) return undefined;
    let warnedScriptUrl = false;
    return effect(() => {
      const value = signal.value;
      if (isBoundScriptUrl(parsed.attribute, String(value))) {
        el.removeAttribute(parsed.attribute);
        if (!warnedScriptUrl) console.warn(`[${BIND_ATTR_ATTR}] "${parsed.attribute}" was removed: its bound value is a script URL`);
        warnedScriptUrl = true;
        return;
      }
      const spelled = typeof value === "boolean" ? spellBoundBoolean(parsed.attribute, value) : undefined;
      if (spelled !== undefined) el.setAttribute(parsed.attribute, spelled);
      else if (value === false || value === null || value === undefined) el.removeAttribute(parsed.attribute);
      else el.setAttribute(parsed.attribute, value === true ? "" : safeBindAttrValue(parsed.attribute, String(value)));
    });
  });
}
