import { announceToast } from "./announce";
import { programmaticStop, removeRehomingFocus } from "./dismiss";
import { asElement, contains, ownerWindow } from "./dom";

/** Where focus goes when the toast holding it leaves: a surviving toast's dismiss button, else the region. */
function rehomeTarget(root: HTMLElement): HTMLElement | null {
  const container = root.closest<HTMLElement>("[data-slot~='toast-container']");
  if (!container) return null;
  for (const button of container.querySelectorAll<HTMLElement>("[data-slot~='toast-close']")) {
    if (!contains(root, button)) return button;
  }
  // The region is not otherwise focusable, so focus has to be let in deliberately: `<body>` announces
  // nothing.
  return programmaticStop(container);
}

/** Removes a toast, rehoming focus first when the toast holds it. */
// A dismiss on a timer is the case that matters: the user did not ask for it, so silently dropping
// their focus to `<body>` loses their place in the page with no way to tell what happened.
export function dismissToast(root: HTMLElement): void {
  removeRehomingFocus(root, rehomeTarget);
}

const TOAST_SELECTOR = "[data-slot~='toast']";

/** A toast's title and description as one utterance, read apart rather than run together. */
function toastText(toast: Element): string {
  const body = toast.querySelector("[data-slot~='toast-body']") ?? toast;
  const parts = Array.from(body.children, (part) => part.textContent?.trim() ?? "").filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : (body.textContent?.trim() ?? "");
}

function toastsAt(node: Node): Element[] {
  const el = asElement(node);
  if (!el) return [];
  return el.matches(TOAST_SELECTOR) ? [el] : Array.from(el.querySelectorAll(TOAST_SELECTOR));
}

/** Announces the toasts `container` holds now and every toast inserted into it later, returning a disconnect. */
export function mountToastAnnouncements(container: HTMLElement): () => void {
  const speak = (toasts: Element[]) => {
    const text = toasts.map(toastText).filter(Boolean).join(" ");
    if (text) announceToast(text, container);
  };
  speak(Array.from(container.querySelectorAll(TOAST_SELECTOR)));
  const Observer = (ownerWindow(container) as { MutationObserver?: typeof MutationObserver }).MutationObserver;
  if (typeof Observer !== "function") return () => {};
  const observer = new Observer((records) => speak(records.flatMap((record) => Array.from(record.addedNodes, toastsAt).flat())));
  observer.observe(container, { childList: true, subtree: true });
  return () => observer.disconnect();
}
