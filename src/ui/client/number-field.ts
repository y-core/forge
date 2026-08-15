import { closestAcross, eventTarget, ownerWindow } from "./dom";

const STEPPER_SELECTOR = "[data-slot~='number-field-decrement'],[data-slot~='number-field-increment']";

/** Mounts the stepper buttons for `<NumberField>` and returns a disposer. */
export function mountNumberField(root: HTMLElement): () => void {
  const input = root.querySelector<HTMLInputElement>("[data-slot~='number-field-input']");

  // Reflected rather than left to SSR: a stepper that looks live and does nothing is worse than one
  // that is visibly out of reach, and `readOnly` has no attribute of its own on a `<button>`.
  const reflect = () => {
    const inert = !input || input.disabled || input.readOnly;
    for (const button of root.querySelectorAll<HTMLButtonElement>(STEPPER_SELECTOR)) button.disabled = inert;
  };

  const onClick = (event: Event) => {
    const button = closestAcross(eventTarget(event) as Node | null, STEPPER_SELECTOR);
    if (!button || !root.contains(button)) return;
    if (!input || input.disabled || input.readOnly) return;

    // `matches`, not `dataset.slot === …`: `data-slot` is a token list, and an equality test would
    // silently fall through to `stepDown()` on an increment button carrying a second token.
    if (button.matches("[data-slot~='number-field-increment']")) input.stepUp();
    else input.stepDown();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  reflect();
  root.addEventListener("click", onClick);

  // The app can disable the input at any time, and there is no event for it — only observation keeps
  // the steppers honest past the first paint. Resolved from the element's own realm, like every
  // other platform object this namespace reaches for: an iframe has its own constructor, and a
  // realm without one degrades to the paint already done above rather than throwing.
  const Observer = (ownerWindow(root) as { MutationObserver?: typeof MutationObserver }).MutationObserver;
  const observer = input && Observer ? new Observer(reflect) : null;
  observer?.observe(input as HTMLInputElement, { attributeFilter: ["disabled", "readonly"] });

  return () => {
    observer?.disconnect();
    root.removeEventListener("click", onClick);
  };
}
