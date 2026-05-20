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

export function initTurnstile(options?: TurnstileOptions): void {
  const {
    widgetSelector = "[data-ref='turnstile']",
    submitSelector = "[data-ref='contact-submit']",
    formSelector = "[data-ref='contact-form']",
    resultSelector = "[data-ref='contact-result']",
  } = options ?? {};

  function syncTheme(): void {
    const el = document.querySelector<HTMLElement>(widgetSelector);
    if (!el) return;
    el.setAttribute(
      "data-theme",
      document.documentElement.classList.contains("dark") ? "dark" : "light",
    );
    if (typeof window.turnstile?.reset === "function") {
      window.turnstile.reset(el);
    }
  }

  syncTheme();
  new MutationObserver(syncTheme).observe(document.documentElement, {
    attributeFilter: ["class"],
  });

  const submitBtn = document.querySelector<HTMLButtonElement>(submitSelector);
  const turnstileEl = document.querySelector<HTMLElement>(widgetSelector);

  if (submitBtn && turnstileEl) {
    submitBtn.disabled = true;

    (globalThis as unknown as Record<string, unknown>)[`${NS}_verified`] = () => {
      submitBtn.disabled = false;
    };
    (globalThis as unknown as Record<string, unknown>)[`${NS}_expired`] = () => {
      submitBtn.disabled = true;
    };

    turnstileEl.setAttribute("data-callback", `${NS}_verified`);
    turnstileEl.setAttribute("data-expired-callback", `${NS}_expired`);
  }

  document.addEventListener("htmx:afterSwap", (e) => {
    const evt = e as CustomEvent<{ target: Element }>;
    if (
      evt.detail.target?.matches(resultSelector) &&
      evt.detail.target.querySelector("[data-success]")
    ) {
      document.querySelector<HTMLFormElement>(formSelector)?.reset();
      if (submitBtn) submitBtn.disabled = true;
      const tEl = document.querySelector<HTMLElement>(widgetSelector);
      if (tEl && typeof window.turnstile?.reset === "function") {
        window.turnstile.reset(tEl);
      }
    }
  });
}
