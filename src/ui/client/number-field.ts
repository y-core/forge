import { closestAcross, eventTarget, ownerWindow } from "./dom";

const STEPPER_SELECTOR = "[data-slot~='number-field-decrement'],[data-slot~='number-field-increment']";
const NUMBER_DEFAULT_STEP = 1;

function numberBound(raw: string | null): number | undefined {
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function stepWithoutGranularity(input: HTMLInputElement, direction: 1 | -1): void {
  const empty = input.value === "";
  const current = empty ? 0 : Number(input.value);
  const min = numberBound(input.getAttribute("min"));
  const max = numberBound(input.getAttribute("max"));
  let next = current + direction * NUMBER_DEFAULT_STEP;
  if (max !== undefined && next > max) next = max;
  if (min !== undefined && next < min) next = min;
  if (!empty && (direction > 0 ? next < current : next > current)) return;
  input.value = String(Number(next.toPrecision(15)));
}

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
    const direction = button.matches("[data-slot~='number-field-increment']") ? 1 : -1;
    if (input.getAttribute("step")?.toLowerCase() === "any") stepWithoutGranularity(input, direction);
    else if (direction > 0) input.stepUp();
    else input.stepDown();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    // APG's Spinbutton keeps focus on the field throughout: the value that changed is the field's, and
    // a reader left on the button hears nothing at all of it.
    input.focus();
  };

  reflect();
  root.addEventListener("click", onClick);

  // The app can disable the input at any time and there is no event for it, so only observation
  // keeps the steppers honest; resolved from the element's own realm, which an iframe has its own of.
  const Observer = (ownerWindow(root) as { MutationObserver?: typeof MutationObserver }).MutationObserver;
  const observer = input && Observer ? new Observer(reflect) : null;
  observer?.observe(input as HTMLInputElement, { attributeFilter: ["disabled", "readonly"] });

  return () => {
    observer?.disconnect();
    root.removeEventListener("click", onClick);
  };
}
