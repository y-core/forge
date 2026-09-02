import {
  TURNSTILE,
  TURNSTILE_EXECUTE_TIMEOUT_MS,
  TURNSTILE_SCRIPT_SRC,
  TURNSTILE_SCRIPT_TIMEOUT_MS,
  TURNSTILE_SCRIPT_URL,
} from "../contracts/turnstile-contract";
import { activeElement, asElement, contains, eventTarget, ownerDocument, ownerWindow } from "./dom";

interface TurnstileAPI {
  render(el: HTMLElement, params: Record<string, unknown>): string;
  execute(el: HTMLElement | string, params?: Record<string, unknown>): void;
  reset(widgetId?: string): void;
  remove(widgetId: string): void;
}

/** What htmx hands `htmx:confirm`: the request is held until `issueRequest` is called. */
type ConfirmDetail = {
  elt?: EventTarget | null;
  triggeringEvent?: Event & { submitter?: EventTarget | null };
  issueRequest?: (skipConfirmation: boolean) => void;
};

const HTMX_SUBMISSION = "[hx-post],[hx-put],[hx-patch],[hx-delete],[data-hx-post],[data-hx-put],[data-hx-patch],[data-hx-delete]";

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

/** Whether the form submits through htmx, which is what `challenge="submit"` defers on. @internal */
export const hasHtmxSubmission = (form: Element): boolean => form.matches(HTMX_SUBMISSION) || form.querySelector(HTMX_SUBMISSION) !== null;

/** How long after the render a stolen focus is still put back. @internal */
export const TURNSTILE_FOCUS_GUARD_MS = 5_000;

/** Puts focus back on `previous` when the widget took or dropped it, reporting whether it acted. @internal */
export function restoreFocus(container: HTMLElement, previous: Element | null): boolean {
  const current = activeElement(container);
  if (current === previous) return false;
  // The widget dropping focus lands on `body` or on nothing; focus the user moved to a real element
  // elsewhere is theirs, and is left alone.
  const widgetHasFocus = contains(container, current) || current === null || current === ownerDocument(container).body;
  if (!widgetHasFocus) return false;
  const target = previous as HTMLElement | null;
  if (!target?.isConnected || typeof target.focus !== "function") return false;
  // Mounting the widget has already shifted the layout, and scrolling the field back into view would compound it.
  target.focus({ preventScroll: true });
  return true;
}

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
  const action = container.getAttribute("data-action");
  const appearance = container.getAttribute("data-appearance");
  const eager = container.getAttribute("data-load") !== "focus";
  let submitMode = container.getAttribute("data-challenge") === "submit";
  if (submitMode && !hasHtmxSubmission(form)) {
    console.warn('[turnstile] challenge="submit" needs an htmx submission on the form; falling back to challenge="render"');
    submitMode = false;
  }
  let widgetId: string | undefined;
  let loadStarted = false;
  let disposed = false;
  let pollId = 0;
  let pollTimeoutId = 0;
  let scriptTimeoutId = 0;
  let guardWindowId = 0;
  let guardSettleId = 0;
  let executeTimeoutId = 0;
  let pending: ((skipConfirmation: boolean) => void) | undefined;
  let submitter: HTMLElement | null = null;

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

  // htmx applies `hx-disabled-elt` and its indicators only once the request is issued, so between the
  // press and `issueRequest` the button would otherwise look dead.
  const markBusy = () => {
    if (!submitter) return;
    (submitter as HTMLButtonElement).disabled = true;
    submitter.setAttribute("aria-busy", "true");
  };

  const clearBusy = () => {
    if (!submitter) return;
    (submitter as HTMLButtonElement).disabled = false;
    submitter.removeAttribute("aria-busy");
    submitter = null;
  };

  const clearExecuteTimeout = () => {
    win.clearTimeout(executeTimeoutId);
    executeTimeoutId = 0;
  };

  const onToken = () => {
    clearExecuteTimeout();
    const issue = pending;
    pending = undefined;
    clearBusy();
    // `true`, so htmx does not then run the `window.confirm` this listener stepped in front of.
    issue?.(true);
  };

  // The held request is dropped rather than issued: a POST with no token answers with a 422 naming
  // the schema's first field, which reads as a form error the reader cannot act on. A second press
  // retries the challenge.
  const onExecuteFailure = () => {
    clearExecuteTimeout();
    pending = undefined;
    clearBusy();
    showFallback();
    resetWidget();
  };

  const onErrorCallback = () => {
    if (pending) onExecuteFailure();
    else showFallback();
  };

  const onGuardFocusout = (event: Event) => {
    const from = asElement(eventTarget(event));
    if (!from || contains(container, from)) return;
    // One settle tick, because the element focus actually moved to is only readable after the event.
    guardSettleId = win.setTimeout(() => {
      guardSettleId = 0;
      if (disposed || guardWindowId === 0) return;
      if (restoreFocus(container, from)) disarmGuard();
    }, 0);
  };

  // Not part of `clearTimers`: the poll-success path clears the timers immediately before rendering.
  const armGuard = () => {
    guardWindowId = win.setTimeout(disarmGuard, TURNSTILE_FOCUS_GUARD_MS);
    form.addEventListener("focusout", onGuardFocusout);
  };

  const disarmGuard = () => {
    win.clearTimeout(guardWindowId);
    win.clearTimeout(guardSettleId);
    guardWindowId = guardSettleId = 0;
    form.removeEventListener("focusout", onGuardFocusout);
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
    // Whatever the user's own focus is on when the widget mounts, which the grab `render` performs
    // before it returns would otherwise take. Under `load="eager"` that is typically the body — the
    // render answers page entry rather than anything the user did, so there is no focus of theirs
    // to protect and neither the restore nor the guard has a position to act on.
    const previous = activeElement(container);
    const held = previous !== null && previous !== doc.body ? previous : null;
    const params: Record<string, unknown> = {
      sitekey,
      size,
      theme,
      // The token is auto-written to the hidden `cf-turnstile-response` input inside the container.
      "error-callback": submitMode ? onErrorCallback : showFallback,
    };
    // Nothing to expire or time out before a challenge has run, and `refresh-expired` is Cloudflare's
    // to honour once one has.
    if (!submitMode) {
      params["expired-callback"] = resetWidget;
      params["timeout-callback"] = resetWidget;
    } else {
      params.execution = "execute";
      params.callback = onToken;
    }
    if (appearance !== null) params.appearance = appearance;
    // Minting the token against the form's own action is what lets the server's `verifyTurnstile`
    // refuse one minted at another endpoint on the same host.
    if (action !== null) params.action = action;
    try {
      widgetId = win.turnstile.render(container, params);
    } catch {
      showFallback();
      return;
    }
    if (!held) return;
    restoreFocus(container, held);
    armGuard();
  };

  const loadScript = () => {
    if (loadStarted) return;
    loadStarted = true;

    if (hasApi(win)) {
      renderWidget();
      return;
    }

    // Prefix, not equality: another widget's injection carries `?render=explicit` and an app's own
    // may carry parameters of its own, and a second copy of the script is what double-loads it.
    if (doc.querySelector(`script[src^="${TURNSTILE_SCRIPT_SRC}"]`)) {
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
    script.src = TURNSTILE_SCRIPT_URL;
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

  // `focusin`, not `focus`, so one delegated listener covers every field in the form. Retained
  // under `load="eager"`, where `loadStarted` has already made it a no-op.
  form.addEventListener("focusin", loadScript, { once: true });
  if (eager) loadScript();

  // By the answered URL and not the event's `elt`, which htmx also names the form in for a request
  // the form merely triggered: every one of those would otherwise burn the single-use token. A form
  // declaring no `hx-post` has no URL to test, and submits through a descendant or not at all.
  const submitPath = form.getAttribute("hx-post");
  const isOwnSubmission = (xhr: XMLHttpRequest | undefined) => {
    if (submitPath === null) return true;
    const answered = xhr?.responseURL;
    // An empty `responseURL` is a request that never got an answer, so the token is still unspent.
    if (typeof answered !== "string" || answered === "") return false;
    return new URL(answered, form.baseURI).pathname === new URL(submitPath, form.baseURI).pathname;
  };

  const onAfterRequest = (event: Event) => {
    const detail = (event as CustomEvent<{ successful?: boolean; xhr?: XMLHttpRequest }>).detail;
    if (!isOwnSubmission(detail?.xhr)) return;
    resetWidget();
    if (detail?.successful) form.reset();
  };
  form.addEventListener("htmx:afterRequest", onAfterRequest);

  const onConfirm = (event: Event) => {
    const detail = (event as CustomEvent<ConfirmDetail>).detail;
    if (typeof detail?.issueRequest !== "function") return;
    // htmx fires `htmx:confirm` before it validates the form, so an invalid form would otherwise
    // spend a challenge on a request htmx then halts.
    if (typeof form.checkValidity === "function" && !form.checkValidity()) return;
    // No API and no widget is a page where the challenge never loaded: let the request go and let
    // `verifyTurnstile` be the one that refuses it, as it already is for a blocked widget.
    if (!hasApi(win) || widgetId === undefined) return;
    event.preventDefault();
    // A second press while a challenge is in flight is swallowed rather than queued.
    if (pending) return;
    pending = detail.issueRequest;
    submitter = asElement(detail.triggeringEvent?.submitter) ?? asElement(detail.elt);
    markBusy();
    executeTimeoutId = win.setTimeout(onExecuteFailure, TURNSTILE_EXECUTE_TIMEOUT_MS);
    try {
      win.turnstile.execute(container);
    } catch {
      onExecuteFailure();
    }
  };
  if (submitMode) form.addEventListener("htmx:confirm", onConfirm);

  const cleanup = () => {
    disposed = true;
    clearTimers();
    clearExecuteTimeout();
    pending = undefined;
    clearBusy();
    disarmGuard();
    form.removeEventListener("focusin", loadScript);
    form.removeEventListener("htmx:afterRequest", onAfterRequest);
    form.removeEventListener("htmx:confirm", onConfirm);
    if (widgetId !== undefined) win.turnstile?.remove(widgetId);
    mounted.delete(container);
  };
  mounted.set(container, cleanup);
  return cleanup;
}
