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

// Not `ParentNode`, for the reason `dom.ts`'s `queryAcross` is not either.
const ref = (name: string, scope: Element | Document | DocumentFragment) => scope.querySelector<HTMLElement>(`[data-ref='${name}']`);

/** The widget at or below `root`. The scope root *is* the widget, and `querySelector` reports
 * descendants only, so the root has to be tested separately — as `resume.ts` does for `data-scope`. @internal */
export function findWidget(root: HTMLElement): HTMLElement | null {
  if (root.getAttribute("data-ref") === TURNSTILE.widget) return root;
  return ref(TURNSTILE.widget, root);
}

/** Whether Cloudflare's API is present, asked as a capability rather than as truthiness: the DOM
 * exposes any element with `id="turnstile"` as `window.turnstile`, which would answer truthy. @internal */
export const hasApi = (win: Window): win is Window & { turnstile: TurnstileAPI } => typeof win.turnstile?.render === "function";

/** Mounts a resilient Cloudflare Turnstile controller for a `<Turnstile>` widget and returns a cleanup function. */
export function mountTurnstile(root: HTMLElement): () => void {
  const doc = ownerDocument(root);
  // Both misses report rather than throw: the caller pointed at this tree expecting a widget in it,
  // so a miss is an authoring error, not a page that simply has no CAPTCHA.
  const container = findWidget(root);
  if (!container) {
    console.warn(`[turnstile] no [data-ref="${TURNSTILE.widget}"] under the mount root; the widget will not mount`);
    return () => {};
  }
  const form = container.closest("form");
  if (!form) {
    console.warn("[turnstile] the widget is not inside a <form>; the token would have nowhere to submit");
    return () => {};
  }

  const existing = mounted.get(container);
  if (existing) return existing;

  const win = ownerWindow(container);
  const sitekey = container.getAttribute("data-sitekey") ?? "";
  const size = container.getAttribute("data-size") ?? "normal";
  let widgetId: string | undefined;
  let loadStarted = false;
  let disposed = false;
  let pollId = 0;
  let pollTimeoutId = 0;
  let scriptTimeoutId = 0;

  const clearTimers = () => {
    win.clearInterval(pollId);
    win.clearTimeout(pollTimeoutId);
    win.clearTimeout(scriptTimeoutId);
    pollId = pollTimeoutId = scriptTimeoutId = 0;
  };

  const showFallback = () => {
    if (disposed) return;
    const fallback = ref(TURNSTILE.fallback, container);
    if (fallback) fallback.hidden = false;
  };

  const resetWidget = () => {
    if (widgetId !== undefined) win.turnstile?.reset(widgetId);
  };

  const renderWidget = () => {
    // A late script `load` or poll hit must not render into a container the app has already swapped
    // out; the widget would mount on a detached node nothing can reach to remove it again.
    if (disposed) return;
    if (!hasApi(win)) {
      showFallback();
      return;
    }
    const theme = doc.documentElement.classList.contains("dark") ? "dark" : "light";
    try {
      widgetId = win.turnstile.render(container, {
        sitekey,
        size,
        theme,
        // The token is auto-written to the hidden `cf-turnstile-response` input inside the container.
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

    if (hasApi(win)) {
      renderWidget();
      return;
    }

    if (doc.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`)) {
      pollId = win.setInterval(() => {
        if (hasApi(win)) {
          clearTimers();
          renderWidget();
        }
      }, 100);
      // Giving up on the poll is a load failure like any other, so a pre-existing script that hangs
      // still leaves the user with a message rather than a dead widget.
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
      // The async script's load event means the API is initialised, so this renders directly rather
      // than through `turnstile.ready()`, which throws for a script loaded async or defer.
      renderWidget();
    });
    script.addEventListener("error", () => {
      win.clearTimeout(scriptTimeoutId);
      showFallback();
    });
    doc.head.appendChild(script);
  };

  // `focusin`, not `focus`, so one delegated listener covers every field in the form.
  form.addEventListener("focusin", loadScript, { once: true });

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
