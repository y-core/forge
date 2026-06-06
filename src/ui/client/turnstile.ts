import type { ReadonlySignal } from "./signal";
import { createSignal, effect } from "./signal";

declare global {
  interface Window {
    turnstile?: TurnstileAPI;
  }
}

export interface TurnstileOptions {
  widgetSelector?: string;
  submitSelector?: string;
  formSelector?: string;
  resultSelector?: string;
  /** "reset" (default) starts a new challenge immediately. "remove" tears down the widget. */
  onSuccess?: "reset" | "remove";
}

interface TurnstileAPI {
  render(container: string | HTMLElement, params?: Record<string, unknown>): string;
  reset(el: string | HTMLElement): void;
  remove(widgetIdOrContainer: string | HTMLElement): void;
  getResponse(el?: string | HTMLElement): string | undefined;
}

const mountedTurnstiles = new WeakMap<HTMLElement, () => void>();
let callbackCount = 0;

/** Mounts a Turnstile widget controller and returns a cleanup function. Safe to call more than once per widget. @public */
export function mountTurnstile(isDark: ReadonlySignal<boolean>, options?: TurnstileOptions): () => void {
  const {
    formSelector = "[data-ref='contact-form']",
    onSuccess = "reset",
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
  let removed = false;

  const sitekey = widget.getAttribute("data-sitekey") ?? "";

  const resetWidget = () => {
    if (typeof window.turnstile?.reset === "function") {
      window.turnstile.reset(widget);
    }
  };

  const removeWidget = () => {
    if (typeof window.turnstile?.remove === "function") {
      window.turnstile.remove(widget);
    }
    removed = true;
  };

  const renderWidget = () => {
    if (typeof window.turnstile?.render !== "function") {
      return;
    }
    window.turnstile.render(widget, {
      sitekey,
      callback: verifiedName,
      "expired-callback": expiredName,
      theme: isDark.value ? "dark" : "light",
      size: widget.getAttribute("data-size") ?? "normal",
    });
    removed = false;
  };

  const disposeTheme = effect(() => {
    widget.setAttribute("data-theme", isDark.value ? "dark" : "light");
    if (!removed) {
      resetWidget();
    }
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

    if (onSuccess === "remove") {
      removeWidget();
    } else {
      resetWidget();
    }
  };

  const onFormFocusin = () => {
    if (!removed) {
      return;
    }
    renderWidget();
  };

  document.addEventListener("htmx:afterSwap", onAfterSwap);

  if (onSuccess === "remove" && form) {
    form.addEventListener("focusin", onFormFocusin);
  }

  const cleanup = () => {
    disposeTheme();
    disposeSubmit();
    document.removeEventListener("htmx:afterSwap", onAfterSwap);
    if (onSuccess === "remove" && form) {
      form.removeEventListener("focusin", onFormFocusin);
    }
    delete globals[verifiedName];
    delete globals[expiredName];
    mountedTurnstiles.delete(widget);
  };

  mountedTurnstiles.set(widget, cleanup);
  return cleanup;
}
