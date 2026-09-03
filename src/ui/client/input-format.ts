import { applyFormat, INPUT_FORMAT_ATTR } from "../contracts/input-format-contract";
import { asElement, contains, eventTarget } from "./dom";

const mountedFormats = new WeakMap<HTMLElement, () => void>();

/** Mounts blur-time cosmetic reformatting for a `format=` `<input>` and returns a disposer. */
export function mountInputFormat(root: HTMLElement): () => void {
  const noop = () => {};
  const existing = mountedFormats.get(root);
  if (existing) return existing;

  const template = root.getAttribute(INPUT_FORMAT_ATTR) ?? "";
  if (!template.includes("#")) {
    console.warn(`[input-format] ${INPUT_FORMAT_ATTR}="${template}" declares no "#" slot; nothing will be formatted`);
    return noop;
  }
  // A bound control's signal *is* its state, so re-spacing the value would lie to the signal and to
  // every reader that parses it back to a number.
  if (root.hasAttribute("data-field")) {
    console.warn("[input-format] a control with data-field is bound to a signal and will not be formatted");
    return noop;
  }

  let disposed = false;

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    root.removeEventListener("focusout", onFocusOut);
    mountedFormats.delete(root);
  }

  // `focusout`, never `blur`: only the former bubbles, and it fires at the element itself too, so a
  // bare `<input>` root and a wrapper root are the same case.
  const onFocusOut = (event: Event) => {
    const el = asElement(eventTarget(event)) as (HTMLInputElement & Partial<HTMLElement>) | null;
    if (!el || !contains(root, el)) return;
    if (typeof el.value !== "string") return;

    const next = applyFormat(template, el.value);
    // Assigning a value the field already holds resets an in-flight interaction for no gain.
    if (el.value === next) return;
    el.value = next;

    // A sanitising input type — `type="number"` above all — silently refuses a value carrying
    // separators, so the write is read back and the controller retires rather than fighting the
    // setter on every blur.
    if (el.value !== next) {
      console.warn("[input-format] this control's type refuses a formatted value; formatting is disabled for it");
      dispose();
    }
  };

  root.addEventListener("focusout", onFocusOut);
  mountedFormats.set(root, dispose);
  return dispose;
}
