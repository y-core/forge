import { closestAcross, eventTarget } from "./dom";

const RESET_SELECTOR = "[data-slot~='filter-reset']";
const INPUT_SELECTOR = "[data-slot~='filter-input']";

/** Turns the Filter's reset into a clear of its chips and returns a disposer. */
export function mountFilter(root: HTMLElement): () => void {
  const onClick = (event: Event) => {
    const reset = closestAcross(eventTarget(event) as Node | null, RESET_SELECTOR);
    if (!reset || !root.contains(reset)) return;
    event.preventDefault();

    const inputs = [...root.querySelectorAll<HTMLInputElement>(INPUT_SELECTOR)];
    for (const input of inputs.filter((candidate) => candidate.checked)) {
      input.checked = false;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    inputs.find((input) => !input.disabled)?.focus();
  };

  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
