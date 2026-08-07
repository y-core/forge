import { TURNSTILE, TURNSTILE_SCRIPT_SRC, TURNSTILE_SCRIPT_TIMEOUT_MS } from "../contracts/turnstile-contract";
import { ownerDocument, ownerWindow } from "./dom";

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

const ref = (name: string, doc: Document) => doc.querySelector<HTMLElement>(`[data-ref='${CSS.escape(name)}']`);

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
 *
 * The returned cleanup clears every timer the controller has outstanding and marks it disposed, so a
 * script `load` or poll hit that lands after an htmx swap neither renders into the detached
 * container nor reveals a fallback that is no longer on the page.
 * @public
 */
export function mountTurnstile(within?: Node): () => void {
  const doc = ownerDocument(within);
  const container = ref(TURNSTILE.widget, doc);
  if (!container) return () => {};
  const form = container.closest("form");
  if (!form) return () => {};

  const existing = mounted.get(container);
  if (existing) return existing;

  // Timers and the third-party API belong to the widget's own realm, not the top-level page.
  const win = ownerWindow(container);
  const sitekey = container.getAttribute("data-sitekey") ?? "";
  const size = container.getAttribute("data-size") ?? "normal";
  let widgetId: string | undefined;
  let loadStarted = false;
  let disposed = false;
  let pollId = 0;
  let pollTimeoutId = 0;
  let scriptTimeoutId = 0;

  /** Every timer this controller can have outstanding, cleared in one call. Clearing an id of 0 (or
   *  one already fired) is a no-op, so this is safe to call unconditionally. */
  const clearTimers = () => {
    win.clearInterval(pollId);
    win.clearTimeout(pollTimeoutId);
    win.clearTimeout(scriptTimeoutId);
    pollId = pollTimeoutId = scriptTimeoutId = 0;
  };

  const showFallback = () => {
    if (disposed) return;
    const fallback = ref(TURNSTILE.fallback, doc);
    if (fallback) fallback.hidden = false;
  };

  const resetWidget = () => {
    if (widgetId !== undefined) win.turnstile?.reset(widgetId);
  };

  const renderWidget = () => {
    // A late script `load` or poll hit must not render into a container the app has already swapped
    // out; the widget would be mounted on a detached node nothing can reach to remove it again.
    if (disposed) return;
    // A capability check against a third-party global, NOT a realm check — Cloudflare's script may
    // simply not have defined `render` yet. `ownerWindow` has no bearing on it; the only thing that
    // changes is which realm's global is asked.
    if (typeof win.turnstile?.render !== "function") {
      showFallback();
      return;
    }
    // Respect the app's resolved theme (manual toggle sets `.dark` on <html>) at render time.
    const theme = doc.documentElement.classList.contains("dark") ? "dark" : "light";
    try {
      widgetId = win.turnstile.render(container, {
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

    if (win.turnstile) {
      renderWidget();
      return;
    }

    if (doc.querySelector(`script[src="${CSS.escape(TURNSTILE_SCRIPT_SRC)}"]`)) {
      // Script already in flight from elsewhere — wait for the API, then render.
      pollId = win.setInterval(() => {
        if (win.turnstile) {
          // Both handles: the giving-up timeout has no work left once the poll has succeeded, and
          // leaving it pending holds this closure alive for the rest of the timeout budget.
          clearTimers();
          renderWidget();
        }
      }, 100);
      // Giving up on the poll is a load failure like any other, so it keeps the same "fails visible"
      // promise the injected-script paths do — otherwise a pre-existing script that hangs leaves the
      // user with neither a widget nor a message. `showFallback` no-ops once disposed, so a
      // cleaned-up controller still reveals nothing.
      pollTimeoutId = win.setTimeout(() => {
        win.clearInterval(pollId);
        showFallback();
      }, TURNSTILE_SCRIPT_TIMEOUT_MS);
      return;
    }

    const script = doc.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    scriptTimeoutId = win.setTimeout(showFallback, TURNSTILE_SCRIPT_TIMEOUT_MS);
    script.addEventListener("load", () => {
      win.clearTimeout(scriptTimeoutId);
      // The async script's load event means the API is already initialised — render directly.
      renderWidget();
    });
    script.addEventListener("error", () => {
      win.clearTimeout(scriptTimeoutId);
      showFallback();
    });
    doc.head.appendChild(script);
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
    disposed = true;
    clearTimers();
    form.removeEventListener("focusin", loadScript);
    form.removeEventListener("htmx:afterRequest", onAfterRequest);
    if (widgetId !== undefined) win.turnstile?.remove(widgetId);
    mounted.delete(container);
  };
  mounted.set(container, cleanup);
  return cleanup;
}
