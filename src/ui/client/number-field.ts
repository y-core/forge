import { closestAcross, eventTarget } from "./dom";

/**
 * Stepper buttons for `<NumberField>`.
 *
 * Everything here goes through the input's own `stepUp()` / `stepDown()`, which apply `step`, clamp
 * to `min` and `max`, and respect `disabled` and `readonly` without being told about any of them.
 * The synthetic `input` event afterwards is what makes a stepped value indistinguishable from a
 * typed one to every listener, `bindField` included.
 */
export function mountNumberField(root: HTMLElement): () => void {
  const onClick = (event: Event) => {
    const button = closestAcross(eventTarget(event) as Node | null, "[data-slot~='number-field-decrement'],[data-slot~='number-field-increment']");
    if (!button || !root.contains(button)) return;
    const input = root.querySelector<HTMLInputElement>("[data-slot~='number-field-input']");
    if (!input || input.disabled || input.readOnly) return;

    // `matches`, not `dataset.slot === …`: `data-slot` is a token list, so an equality test on the
    // whole attribute stops recognising a button the moment it carries a second token — and the
    // failure is silent and wrong-way, since the `else` then steps *down* on the increment button.
    if (button.matches("[data-slot~='number-field-increment']")) input.stepUp();
    else input.stepDown();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
