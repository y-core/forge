import { TURNSTILE, TURNSTILE_SCRIPT_SRC, TURNSTILE_SCRIPT_TIMEOUT_MS } from "../turnstile-contract";

interface TurnstileAPI {
  render(el: HTMLElement, params: Record<string, unknown>): string;
  reset(widgetId?: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileAPI;
  }
}

const mounted = new WeakMap<HTMLElement, () => void>();

const ref = (name: string) => document.querySelector<HTMLElement>(`[data-ref='${CSS.escape(name)}']`);

/**
 * Mounts a resilient Cloudflare Turnstile controller for the `<Turnstile>` widget (`ui/core`) and
 * returns a cleanup function. Idempotent: a second call for the same widget returns the existing
 * cleanup. No-ops (returns a no-op cleanup) when no `[data-ref='turnstile']` widget, or its
 * enclosing `<form>`, is present.
 *
 * Behaviour:
 * - **Engagement-gated:** loads Cloudflare's script once on the first `focusin` within the form —
 *   real intent to submit, not merely scrolling past — then explicitly renders the widget with
 *   function-ref callbacks (no global callback names, no implicit auto-render). The API is ready
 *   once the async script's `load` event fires, so it renders directly; it never calls
 *   `turnstile.ready()`, which throws when the script was loaded async/defer.
 * - **Self-healing token:** resets the single-use token after EVERY completed submission (success
 *   OR error, via `htmx:afterRequest`) and on expiry/timeout, so a retry always carries a fresh
 *   token. Clears the form only when the submission succeeded.
 * - **Fails visible:** on load/render failure it reveals the widget's hidden fallback message
 *   instead of leaving a dead widget. The submit button is intentionally NOT gated on Turnstile —
 *   the server (`verifyTurnstile`) is the single fail-closed enforcement point, so a slow or
 *   blocked challenge can never brick the form's submit affordance.
 *
 * The widget theme follows the app's resolved theme (`.dark` on `<html>`) at render time.
 * @public
 */
export function mountTurnstile(): () => void {
  const container = ref(TURNSTILE.widget);
  if (!container) return () => {};
  const form = container.closest("form");
  if (!form) return () => {};

  const existing = mounted.get(container);
  if (existing) return existing;

  const sitekey = container.getAttribute("data-sitekey") ?? "";
  const size = container.getAttribute("data-size") ?? "normal";
  let widgetId: string | undefined;
  let loadStarted = false;

  const showFallback = () => {
    const fallback = ref(TURNSTILE.fallback);
    if (fallback) fallback.hidden = false;
  };

  const resetWidget = () => {
    if (widgetId !== undefined) window.turnstile?.reset(widgetId);
  };

  const renderWidget = () => {
    if (typeof window.turnstile?.render !== "function") {
      showFallback();
      return;
    }
    // Respect the app's resolved theme (manual toggle sets `.dark` on <html>) at render time.
    const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    try {
      widgetId = window.turnstile.render(container, {
        sitekey,
        size,
        theme,
        // Token is auto-written to the hidden `cf-turnstile-response` input inside the container.
        "expired-callback": resetWidget,
        "timeout-callback": resetWidget,
        "error-callback": showFallback,
      });
    } catch {
      showFallback();
    }
  };

  const loadScript = () => {
    if (loadStarted) return;
    loadStarted = true;

    if (window.turnstile) {
      renderWidget();
      return;
    }

    if (document.querySelector(`script[src="${CSS.escape(TURNSTILE_SCRIPT_SRC)}"]`)) {
      // Script already in flight from elsewhere — wait for the API, then render.
      const poll = window.setInterval(() => {
        if (window.turnstile) {
          window.clearInterval(poll);
          renderWidget();
        }
      }, 100);
      window.setTimeout(() => window.clearInterval(poll), TURNSTILE_SCRIPT_TIMEOUT_MS);
      return;
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    const timeout = window.setTimeout(showFallback, TURNSTILE_SCRIPT_TIMEOUT_MS);
    script.addEventListener("load", () => {
      window.clearTimeout(timeout);
      // The async script's load event means the API is already initialised — render directly.
      renderWidget();
    });
    script.addEventListener("error", () => {
      window.clearTimeout(timeout);
      showFallback();
    });
    document.head.appendChild(script);
  };

  // Gate the third-party cost on genuine engagement: load Turnstile the first time any field in the
  // form is focused. `focusin` (not `focus`) bubbles, so one delegated listener covers every field.
  form.addEventListener("focusin", loadScript, { once: true });

  // Reset the single-use token after every completed submission so the next attempt is fresh;
  // clear the fields only when the submission actually succeeded.
  const onAfterRequest = (event: Event) => {
    const detail = (event as CustomEvent<{ successful?: boolean }>).detail;
    resetWidget();
    if (detail?.successful) form.reset();
  };
  form.addEventListener("htmx:afterRequest", onAfterRequest);

  const cleanup = () => {
    form.removeEventListener("focusin", loadScript);
    form.removeEventListener("htmx:afterRequest", onAfterRequest);
    if (widgetId !== undefined) window.turnstile?.remove(widgetId);
    mounted.delete(container);
  };
  mounted.set(container, cleanup);
  return cleanup;
}
