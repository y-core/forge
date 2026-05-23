import { type ReadonlySignal, createSignal, effect } from "./signal";

export interface TurnstileOptions {
  widgetSelector?: string;
  submitSelector?: string;
  formSelector?: string;
  resultSelector?: string;
}

interface TurnstileAPI {
  reset(el: HTMLElement): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileAPI;
  }
}

const NS = "_fts";

export function initTurnstile(isDark: ReadonlySignal<boolean>, options?: TurnstileOptions): void {
  const {
    widgetSelector = "[data-ref='turnstile']",
    submitSelector = "[data-ref='contact-submit']",
    formSelector = "[data-ref='contact-form']",
    resultSelector = "[data-ref='contact-result']",
  } = options ?? {};

  // Reacts only to actual dark-mode transitions; MutationObserver fired on any class mutation
  effect(() => {
    const el = document.querySelector<HTMLElement>(widgetSelector);
    if (!el) return;
    el.setAttribute("data-theme", isDark.value ? "dark" : "light");
    if (typeof window.turnstile?.reset === "function") {
      window.turnstile.reset(el);
    }
  });

  const submitBtn = document.querySelector<HTMLButtonElement>(submitSelector);
  const turnstileEl = document.querySelector<HTMLElement>(widgetSelector);

  if (submitBtn && turnstileEl) {
    const verified = createSignal(false);

    effect(() => { submitBtn.disabled = !verified.value; });

    (globalThis as unknown as Record<string, unknown>)[`${NS}_verified`] = () => {
      verified.value = true;
    };
    (globalThis as unknown as Record<string, unknown>)[`${NS}_expired`] = () => {
      verified.value = false;
    };

    turnstileEl.setAttribute("data-callback", `${NS}_verified`);
    turnstileEl.setAttribute("data-expired-callback", `${NS}_expired`);

    document.addEventListener("htmx:afterSwap", (e) => {
      const evt = e as CustomEvent<{ target: Element }>;
      if (
        evt.detail.target?.matches(resultSelector) &&
        evt.detail.target.querySelector("[data-success]")
      ) {
        document.querySelector<HTMLFormElement>(formSelector)?.reset();
        verified.value = false;
        if (typeof window.turnstile?.reset === "function") {
          window.turnstile.reset(turnstileEl);
        }
      }
    });
  }
}
