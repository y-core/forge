import { createSignal, effect, type ReadonlySignal } from "./signal";

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

const mountedTurnstiles = new WeakMap<HTMLElement, () => void>();
let callbackCount = 0;

/** Mounts a Turnstile widget controller and returns a cleanup function. Safe to call more than once per widget. @public */
export function mountTurnstile(isDark: ReadonlySignal<boolean>, options?: TurnstileOptions): () => void {
  const {
    formSelector = "[data-ref='contact-form']",
    resultSelector = "[data-ref='contact-result']",
    submitSelector = "[data-ref='contact-submit']",
    widgetSelector = "[data-ref='turnstile']",
  } = options ?? {};

  const widget = document.querySelector<HTMLElement>(widgetSelector);
  if (!widget) {
    return () => {};
  }

  const existing = mountedTurnstiles.get(widget);
  if (existing) {
    return existing;
  }

  const submitButton = document.querySelector<HTMLButtonElement>(submitSelector);
  const form = document.querySelector<HTMLFormElement>(formSelector);
  const verified = createSignal(false);
  const callbackBase = `__forgeTurnstile_${++callbackCount}`;
  const verifiedName = `${callbackBase}_verified`;
  const expiredName = `${callbackBase}_expired`;
  const globals = globalThis as Record<string, unknown>;

  const resetWidget = () => {
    if (typeof window.turnstile?.reset === "function") {
      window.turnstile.reset(widget);
    }
  };

  const disposeTheme = effect(() => {
    widget.setAttribute("data-theme", isDark.value ? "dark" : "light");
    resetWidget();
  });

  const disposeSubmit = submitButton
    ? effect(() => {
        submitButton.disabled = !verified.value;
      })
    : () => {};

  globals[verifiedName] = () => {
    verified.value = true;
  };
  globals[expiredName] = () => {
    verified.value = false;
  };

  widget.setAttribute("data-callback", verifiedName);
  widget.setAttribute("data-expired-callback", expiredName);

  const onAfterSwap = (event: Event) => {
    const customEvent = event as CustomEvent<{ target?: Element }>;
    const target = customEvent.detail?.target;
    if (!target?.matches(resultSelector) || !target.querySelector("[data-success]")) {
      return;
    }

    form?.reset();
    verified.value = false;
    resetWidget();
  };

  document.addEventListener("htmx:afterSwap", onAfterSwap);

  const cleanup = () => {
    disposeTheme();
    disposeSubmit();
    document.removeEventListener("htmx:afterSwap", onAfterSwap);
    delete globals[verifiedName];
    delete globals[expiredName];
    mountedTurnstiles.delete(widget);
  };

  mountedTurnstiles.set(widget, cleanup);
  return cleanup;
}
