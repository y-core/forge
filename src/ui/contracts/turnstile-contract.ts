/** `data-ref` values the controller queries on the SSR-rendered markup. @public */
export const TURNSTILE = {
  /** Container the controller explicitly renders the widget into. */
  widget: "turnstile",
  /** Inline message revealed when the challenge cannot load. */
  fallback: "turnstile-fallback",
} as const;

/** `data-scope` the widget stamps, so the controller resumes only on a page that rendered one. @public */
export const TURNSTILE_SCOPE = "turnstile";

/** Cloudflare Turnstile script, matched as a prefix so a URL carrying parameters is still found. @public */
export const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/** The URL the controller injects: the controller renders every widget itself, so the implicit
 * document scan Cloudflare runs without `render=explicit` has nothing to find. @public */
export const TURNSTILE_SCRIPT_URL = `${TURNSTILE_SCRIPT_SRC}?render=explicit`;

/** If the script has not loaded within this budget, the controller reveals the fallback message. @public */
export const TURNSTILE_SCRIPT_TIMEOUT_MS = 10_000;

/** How long a submit held open for a deferred challenge waits before it is released as a failure. @public */
export const TURNSTILE_EXECUTE_TIMEOUT_MS = 15_000;
