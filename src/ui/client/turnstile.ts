import { ANNOUNCE_TURNSTILE_CHANNEL } from "../contracts/announcer-contract";
import {
  TURNSTILE,
  TURNSTILE_ABANDONED_EVENT,
  TURNSTILE_ACTION_PATTERN,
  TURNSTILE_CDATA_PATTERN,
  TURNSTILE_EXECUTE_TIMEOUT_MS,
  TURNSTILE_INTERACTIVE_TIMEOUT_MS,
  TURNSTILE_SCRIPT_SRC,
  TURNSTILE_SCRIPT_TIMEOUT_MS,
  TURNSTILE_SCRIPT_URL,
  TURNSTILE_TRUSTED_TYPES_POLICY,
} from "../contracts/turnstile-contract";
import type { TurnstileAbandonReason, TurnstileAbandonedDetail } from "../contracts/types";
import { announce } from "./announce";
import { activeElement, asElement, contains, eventTarget, ownerDocument, ownerWindow } from "./dom";

interface TurnstileAPI {
  render(el: HTMLElement, params: Record<string, unknown>): string;
  execute(el: HTMLElement | string, params?: Record<string, unknown>): void;
  reset(widgetId?: string): void;
  remove(widgetId: string): void;
}

type HtmxRequestDetail = {
  ctx?: { sourceElement?: EventTarget | null; request?: { submitter?: EventTarget | null }; response?: { status?: number } };
};

type Hold = { release: () => void; submitter: HTMLElement | null };

const HTMX_SUBMISSION = "[hx-post],[hx-put],[hx-patch],[hx-delete],[data-hx-post],[data-hx-put],[data-hx-patch],[data-hx-delete]";

declare global {
  interface Window {
    turnstile?: TurnstileAPI;
  }
}

type TurnstileScriptUrlPolicy = { createScriptURL(input: string): object };

type TurnstileTrustedTypesWindow = Window & {
  trustedTypes?: { createPolicy(name: string, rules: { createScriptURL(input: string): string }): TurnstileScriptUrlPolicy };
};

const mounted = new WeakMap<HTMLElement, () => void>();

// Per window, because `createPolicy` refuses a name already created there; a refusal is kept too.
const scriptUrlPolicies = new WeakMap<Window, TurnstileScriptUrlPolicy | null>();

const TRUSTED_TYPES_FIX = `list "${TURNSTILE_TRUSTED_TYPES_POLICY}" in the CSP's trusted-types directive`;

function admitTurnstileScriptUrl(input: string): string {
  if (input !== TURNSTILE_SCRIPT_URL)
    throw new TypeError(`[turnstile] the "${TURNSTILE_TRUSTED_TYPES_POLICY}" policy admits only Cloudflare's script URL`);
  return input;
}

function turnstileScriptUrlPolicy(win: TurnstileTrustedTypesWindow): TurnstileScriptUrlPolicy | null {
  const cached = scriptUrlPolicies.get(win);
  if (cached !== undefined) return cached;
  let policy: TurnstileScriptUrlPolicy | null = null;
  try {
    policy = win.trustedTypes?.createPolicy(TURNSTILE_TRUSTED_TYPES_POLICY, { createScriptURL: admitTurnstileScriptUrl }) ?? null;
  } catch (error) {
    console.error(
      `[turnstile] could not create the "${TURNSTILE_TRUSTED_TYPES_POLICY}" Trusted Types policy — ${TRUSTED_TYPES_FIX}; the widget will not load`,
      error,
    );
  }
  scriptUrlPolicies.set(win, policy);
  return policy;
}

/** Sets `script.src` to Cloudflare's URL, through the Trusted Types policy where the window has the API, reporting whether the write held. @internal */
export function assignTurnstileScriptSrc(script: HTMLScriptElement, win: Window): boolean {
  const trusted = win as TurnstileTrustedTypesWindow;
  if (!trusted.trustedTypes) {
    script.src = TURNSTILE_SCRIPT_URL;
    return true;
  }
  const policy = turnstileScriptUrlPolicy(trusted);
  if (policy === null) return false;
  try {
    script.src = policy.createScriptURL(TURNSTILE_SCRIPT_URL) as unknown as string;
    return true;
  } catch (error) {
    console.error(
      `[turnstile] the browser refused the script URL through "${TURNSTILE_TRUSTED_TYPES_POLICY}" — ${TRUSTED_TYPES_FIX}; the widget will not load`,
      error,
    );
    return false;
  }
}

const ref = (name: string, scope: Element | Document | DocumentFragment) => scope.querySelector<HTMLElement>(`[data-ref='${name}']`);

/** The widget at or below `root`, testing the root itself as well as its descendants. @internal */
export function findWidget(root: HTMLElement): HTMLElement | null {
  if (root.getAttribute("data-ref") === TURNSTILE.widget) return root;
  return ref(TURNSTILE.widget, root);
}

/** Whether Cloudflare's Turnstile API is present on `win`. @internal */
// Asked as a capability, not as truthiness: the DOM exposes any element with `id="turnstile"` as
// `window.turnstile`, which would answer truthy.
export const hasTurnstileApi = (win: Window): win is Window & { turnstile: TurnstileAPI } => typeof win.turnstile?.render === "function";

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

// A synthetic `submit` never submits natively, and htmx cancels the native submission a `click` would start.
function replaySubmission(elt: HTMLElement, pressed: HTMLElement): void {
  if (elt.tagName !== "FORM") {
    elt.click();
    return;
  }
  const { SubmitEvent } = ownerWindow(elt) as Window & typeof globalThis;
  elt.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: pressed === elt ? null : pressed }));
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
  const cdata = container.getAttribute("data-cdata");
  const responseFieldName = container.getAttribute("data-response-field-name");
  const appearance = container.getAttribute("data-appearance");
  const language = container.getAttribute("data-language");
  const tabindex = container.getAttribute("data-tabindex");
  const eager = container.getAttribute("data-load") !== "focus";
  let submitMode = container.getAttribute("data-challenge") === "submit";
  if (submitMode && !hasHtmxSubmission(form)) {
    console.warn('[turnstile] challenge="submit" needs an htmx submission on the form; falling back to challenge="render"');
    submitMode = false;
  }
  if (action !== null && !TURNSTILE_ACTION_PATTERN.test(action)) {
    console.warn(
      `[turnstile] action "${action}" is outside Cloudflare's ${TURNSTILE_ACTION_PATTERN.source}; it is forwarded anyway and may be refused`,
    );
  }
  if (cdata !== null && !TURNSTILE_CDATA_PATTERN.test(cdata)) {
    console.warn(
      `[turnstile] cData "${cdata}" is outside Cloudflare's ${TURNSTILE_CDATA_PATTERN.source}; it is forwarded anyway and may be refused`,
    );
  }
  let widgetId: string | undefined;
  // Whether a press can be held: a widget that never rendered, or whose challenge errored, has no
  // token to wait for, and holding one would only spend the execute timeout before failing.
  let state: "unmounted" | "ready" | "dead" = "unmounted";
  let loadStarted = false;
  let disposed = false;
  let pollId = 0;
  let pollTimeoutId = 0;
  let scriptTimeoutId = 0;
  let guardWindowId = 0;
  let guardSettleId = 0;
  let executeTimeoutId = 0;
  // One record, so the request and the control it was pressed on can never answer for each other.
  let held: Hold | null = null;
  let interactive = false;
  let tokenIssued = false;
  let renderedTheme: "dark" | "light" | undefined;
  let themeObserver: MutationObserver | undefined;

  const clearTimers = () => {
    win.clearInterval(pollId);
    win.clearTimeout(pollTimeoutId);
    win.clearTimeout(scriptTimeoutId);
    pollId = pollTimeoutId = scriptTimeoutId = 0;
  };

  const reveal = (name: string, shown: boolean) => {
    if (disposed) return;
    const message = ref(name, container);
    if (!message) return;
    const revealed = shown && message.hidden;
    message.hidden = !shown;
    if (revealed) announce(message.textContent ?? "", { channel: ANNOUNCE_TURNSTILE_CHANNEL, politeness: "assertive", within: container });
  };

  const showFallback = () => reveal(TURNSTILE.fallback, true);
  const hideFallback = () => reveal(TURNSTILE.fallback, false);

  const resetWidget = () => {
    if (widgetId !== undefined) win.turnstile?.reset(widgetId);
  };

  // Guarded, so a `remove` that throws on an id whose container an htmx swap already took cannot
  // skip the rest of a teardown and leave a stale `mounted` entry a later mount would be handed.
  const removeWidget = () => {
    if (widgetId === undefined) return;
    try {
      win.turnstile?.remove(widgetId);
    } catch (error) {
      console.warn("[turnstile] turnstile.remove() threw", error);
    }
    widgetId = undefined;
    state = "unmounted";
  };

  const currentTheme = () => (doc.documentElement.classList.contains("dark") ? "dark" : "light");

  // htmx applies `hx-disable` and its indicators only once the request is issued, so while the press
  // is held the button would otherwise look dead.
  const setBusy = (el: HTMLElement | null, busy: boolean) => {
    if (!el) return;
    (el as HTMLButtonElement).disabled = busy;
    if (busy) el.setAttribute("aria-busy", "true");
    else el.removeAttribute("aria-busy");
  };

  const clearExecuteTimeout = () => {
    win.clearTimeout(executeTimeoutId);
    executeTimeoutId = 0;
  };

  const releaseHeld = () => {
    clearExecuteTimeout();
    setBusy(held?.submitter ?? null, false);
    held = null;
  };

  const abandonHeld = (reason: TurnstileAbandonReason) => {
    const lost = held;
    releaseHeld();
    // Un-busied by `releaseHeld` first, so a handler that focuses the control finds a live target.
    if (disposed || lost === null) return;
    const detail: TurnstileAbandonedDetail = { reason, submitter: lost.submitter };
    form.dispatchEvent(new CustomEvent(TURNSTILE_ABANDONED_EVENT, { bubbles: true, detail }));
  };

  const onExecuteFailure = (reason: TurnstileAbandonReason) => {
    interactive = false;
    abandonHeld(reason);
    showFallback();
    resetWidget();
  };

  // Busy state and budget together, both read off `interactive`, so a press arriving mid-interaction
  // inherits the human-scale ceiling rather than the 15s one.
  const armHold = () => {
    setBusy(held?.submitter ?? null, !interactive);
    clearExecuteTimeout();
    executeTimeoutId = win.setTimeout(
      () => onExecuteFailure(interactive ? "interactive-timeout" : "timeout"),
      interactive ? TURNSTILE_INTERACTIVE_TIMEOUT_MS : TURNSTILE_EXECUTE_TIMEOUT_MS,
    );
  };

  const takeHold = (next: Hold) => {
    const running = held !== null;
    if (held) abandonHeld("superseded");
    held = next;
    armHold();
    // One press is one challenge: a displacement rides the challenge already in flight.
    if (running) return;
    try {
      win.turnstile?.execute(container);
    } catch {
      onExecuteFailure("error");
    }
  };

  const onToken = () => {
    state = "ready";
    tokenIssued = true;
    // Cloudflare retries on its own, so an error the widget then recovered from must take its
    // message back down rather than leave every visitor reading it.
    hideFallback();
    const hold = held;
    interactive = false;
    releaseHeld();
    hold?.release();
  };

  const onErrorCallback = (code?: unknown) => {
    console.warn(`[turnstile] challenge error ${String(code ?? "unknown")}`);
    state = "dead";
    abandonHeld("error");
    showFallback();
    // Non-falsy, or Cloudflare logs a warning of its own on top of this one — and under the default
    // `retry: auto` it would log it once per retry for a single underlying fault.
    return true;
  };

  const onUnsupported = () => {
    state = "dead";
    abandonHeld("unsupported");
    reveal(TURNSTILE.unsupported, true);
  };

  const onBeforeInteractive = () => {
    interactive = true;
    if (held) armHold();
  };

  const onAfterInteractive = () => {
    interactive = false;
    if (held) armHold();
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
    win.clearTimeout(guardWindowId);
    guardWindowId = win.setTimeout(disarmGuard, TURNSTILE_FOCUS_GUARD_MS);
    form.addEventListener("focusout", onGuardFocusout);
  };

  const disarmGuard = () => {
    win.clearTimeout(guardWindowId);
    win.clearTimeout(guardSettleId);
    guardWindowId = guardSettleId = 0;
    form.removeEventListener("focusout", onGuardFocusout);
  };

  const observeTheme = () => {
    const Observer = (win as { MutationObserver?: typeof MutationObserver }).MutationObserver;
    if (themeObserver || typeof Observer !== "function") return;
    const observer = new Observer(() => {
      // A solved token is never discarded to re-theme the widget: the visitor would pay for a
      // second challenge to look at a colour, and in submit mode lose the one they just passed.
      if (disposed || tokenIssued || state !== "ready" || renderedTheme === currentTheme()) return;
      removeWidget();
      renderWidget();
    });
    observer.observe(doc.documentElement, { attributeFilter: ["class"] });
    themeObserver = observer;
  };

  const renderWidget = () => {
    // A late script `load` or poll hit must not render into a container the app has already swapped
    // out; the widget would mount on a detached node nothing can reach to remove it again.
    if (disposed) return;
    if (!hasTurnstileApi(win)) {
      showFallback();
      return;
    }
    const theme = currentTheme();
    // `render` grabs focus before it returns, so the user's own position is held first; an eager
    // render answers page entry, where the body holds it and there is nothing of theirs to protect.
    const previous = activeElement(container);
    const heldFocus = previous !== null && previous !== doc.body ? previous : null;
    const params: Record<string, unknown> = {
      sitekey,
      size,
      theme,
      // The token is auto-written to the hidden `cf-turnstile-response` input inside the container.
      callback: onToken,
      "error-callback": onErrorCallback,
      "unsupported-callback": onUnsupported,
      "before-interactive-callback": onBeforeInteractive,
      "after-interactive-callback": onAfterInteractive,
    };
    // No `expired-callback` or `timeout-callback`: `refresh-expired` and `refresh-timeout` default
    // to `auto`, so Cloudflare refreshes the token itself and a `reset()` here would spend another.
    if (submitMode) {
      params.execution = "execute";
    }
    if (appearance !== null) params.appearance = appearance;
    if (language !== null) params.language = language;
    if (tabindex !== null) params.tabindex = Number(tabindex);
    // Minting the token against the form's own action is what lets the server's `verifyTurnstile`
    // refuse one minted at another endpoint on the same host.
    if (action !== null) params.action = action;
    // Cloudflare's own spellings: `cData` is camelCase and `response-field-name` is hyphenated.
    if (cdata !== null) params.cData = cdata;
    if (responseFieldName !== null) params["response-field-name"] = responseFieldName;
    try {
      widgetId = win.turnstile.render(container, params);
      state = "ready";
      renderedTheme = theme;
      observeTheme();
    } catch (error) {
      state = "dead";
      console.warn("[turnstile] turnstile.render() threw; the widget will not mount", error);
      showFallback();
      return;
    }
    if (heldFocus) restoreFocus(container, heldFocus);
    armGuard();
  };

  const loadScript = () => {
    if (loadStarted) return;
    loadStarted = true;

    if (hasTurnstileApi(win)) {
      renderWidget();
      return;
    }

    // Prefix, not equality: another widget's injection carries `?render=explicit` and an app's own
    // may carry parameters of its own, and a second copy of the script is what double-loads it.
    if (doc.querySelector(`script[src^="${TURNSTILE_SCRIPT_SRC}"]`)) {
      pollId = win.setInterval(() => {
        if (hasTurnstileApi(win)) {
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
    if (!assignTurnstileScriptSrc(script, win)) {
      showFallback();
      return;
    }
    script.async = true;
    // Read off the property, because the browser empties the `nonce` content attribute to stop
    // CSS-selector exfiltration; written back with `setAttribute`, which some engines need.
    const nonce = doc.querySelector<HTMLScriptElement>("script[nonce]")?.nonce ?? "";
    if (nonce) script.setAttribute("nonce", nonce);
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

  // By the issuing element, not the answered URL: a descendant field's own htmx request bubbles to
  // the form and would otherwise burn the single-use token.
  const formDeclaresSubmission = form.matches(HTMX_SUBMISSION);
  const isSubmitControl = (el: Element): boolean => el.matches("button:not([type]),button[type='submit'],input[type='submit'],input[type='image']");
  const isOwnSubmission = (elt: Element | null): boolean => {
    if (elt === null) return false;
    if (formDeclaresSubmission) return elt === form;
    return form.contains(elt) && elt.closest(HTMX_SUBMISSION) === elt && isSubmitControl(elt);
  };

  const onFinallyRequest = (event: Event) => {
    const ctx = (event as CustomEvent<HtmxRequestDetail>).detail?.ctx;
    if (!isOwnSubmission(asElement(ctx?.sourceElement))) return;
    resetWidget();
    const status = ctx?.response?.status ?? 0;
    if (status >= 200 && status < 300) form.reset();
  };
  form.addEventListener("htmx:finally:request", onFinallyRequest);

  // Whatever `responseFieldName` renames it to, the response input Cloudflare writes is the only named one in the container.
  const hasToken = (): boolean => (container.querySelector<HTMLInputElement>("input[name]")?.value ?? "") !== "";

  const onConfigRequest = (event: Event) => {
    const ctx = (event as CustomEvent<HtmxRequestDetail>).detail?.ctx;
    const elt = asElement(ctx?.sourceElement);
    if (elt === null || !isOwnSubmission(elt)) return;
    if (hasToken()) return;
    // No API and no widget is a page where the challenge never loaded: let the request go and let
    // `verifyTurnstile` be the one that refuses it, as it already is for a blocked widget.
    if (!hasTurnstileApi(win) || state !== "ready") return;
    event.preventDefault();
    const pressed = asElement(ctx?.request?.submitter) ?? elt;
    takeHold({ release: () => replaySubmission(elt, pressed), submitter: pressed });
  };
  if (submitMode) form.addEventListener("htmx:config:request", onConfigRequest);

  const cleanup = () => {
    disposed = true;
    clearTimers();
    // Silently: teardown normally runs mid-swap, and an abandonment dispatched from a form htmx is
    // removing would reach a listener whose page is already gone.
    interactive = false;
    releaseHeld();
    disarmGuard();
    form.removeEventListener("focusin", loadScript);
    form.removeEventListener("htmx:finally:request", onFinallyRequest);
    form.removeEventListener("htmx:config:request", onConfigRequest);
    themeObserver?.disconnect();
    themeObserver = undefined;
    removeWidget();
    mounted.delete(container);
  };
  mounted.set(container, cleanup);
  return cleanup;
}
