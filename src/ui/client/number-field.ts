import { closestAcross, eventTarget } from "./dom";

/** Mounts the stepper buttons for `<NumberField>` and returns a disposer. @public */
export function mountNumberField(root: HTMLElement): () => void {
  const onClick = (event: Event) => {
    const button = closestAcross(eventTarget(event) as Node | null, "[data-slot~='number-field-decrement'],[data-slot~='number-field-increment']");
    if (!button || !root.contains(button)) return;
    const input = root.querySelector<HTMLInputElement>("[data-slot~='number-field-input']");
    if (!input || input.disabled || input.readOnly) return;

    // `matches`, not `dataset.slot === …`: `data-slot` is a token list, and an equality test would
    // silently fall through to `stepDown()` on an increment button carrying a second token.
    if (button.matches("[data-slot~='number-field-increment']")) input.stepUp();
    else input.stepDown();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
