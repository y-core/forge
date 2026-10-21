import { announceToast } from "./announce";
import { programmaticStop, removeRehomingFocus } from "./dismiss";
import { asElement, contains, ownerWindow } from "./dom";

/** Where focus goes when the toast holding it leaves: a surviving toast's dismiss button, else the region; a fading toast is not surviving. */
function rehomeTarget(root: HTMLElement): HTMLElement | null {
  const container = root.closest<HTMLElement>("[data-slot~='toast-container']");
  if (!container) return null;
  for (const button of container.querySelectorAll<HTMLElement>("[data-slot~='toast-close']")) {
    if (!contains(root, button) && !button.closest("[inert]")) return button;
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

type PauseReason = "pointer" | "focus" | "hidden";

/** Dismisses `root` after `ms` of unpaused time, holding while it is hovered, keyboard-focused or its page is hidden, and returns a disposer. @internal */
export function scheduleToastDismissal(root: HTMLElement, ms: number): () => void {
  // The toast's own realm schedules its own dismissal — a bare `setTimeout` would fire on the
  // top-level window's clock, which an iframe can have torn down underneath it.
  const win = ownerWindow(root);
  const doc = win.document;
  const reasons = new Set<PauseReason>();
  let remaining = ms;
  let startedAt = 0;
  let timer = 0;

  const run = () => {
    startedAt = win.performance.now();
    timer = win.setTimeout(() => dismissToast(root), remaining);
  };
  const pause = (reason: PauseReason) => {
    if (reasons.size === 0) {
      win.clearTimeout(timer);
      remaining = Math.max(0, remaining - (win.performance.now() - startedAt));
    }
    reasons.add(reason);
  };
  const resume = (reason: PauseReason) => {
    if (reasons.delete(reason) && reasons.size === 0) run();
  };
  const onFocusIn = (event: Event) => {
    if ((event.target as Element).matches(":focus-visible")) pause("focus");
  };
  const onVisibilityChange = () => {
    if (doc.visibilityState === "hidden") pause("hidden");
    else resume("hidden");
  };
  const onFocusOut = (event: Event) => {
    const next = (event as FocusEvent).relatedTarget as Node | null;
    if (!next || !contains(root, next)) resume("focus");
  };

  const lifetime = new AbortController();
  const { signal } = lifetime;
  root.addEventListener("pointerenter", () => pause("pointer"), { signal });
  root.addEventListener("pointerleave", () => resume("pointer"), { signal });
  root.addEventListener("focusin", onFocusIn, { signal });
  root.addEventListener("focusout", onFocusOut, { signal });
  doc.addEventListener("visibilitychange", onVisibilityChange, { signal });
  if (doc.visibilityState === "hidden") reasons.add("hidden");
  else run();

  return () => {
    lifetime.abort();
    win.clearTimeout(timer);
  };
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
