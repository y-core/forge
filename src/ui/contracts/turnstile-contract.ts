/** `data-ref` values the controller queries on the SSR-rendered markup. @public */
export const TURNSTILE = {
  /** Container the controller explicitly renders the widget into. */
  widget: "turnstile",
  /** Inline message revealed when the challenge cannot load. */
  fallback: "turnstile-fallback",
} as const;

/** `data-scope` the widget stamps, so the controller resumes only on a page that rendered one. @public */
export const TURNSTILE_SCOPE = "turnstile";

/** Cloudflare Turnstile script, rendered explicitly by the controller. @public */
export const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/** If the script has not loaded within this budget, the controller reveals the fallback message. @public */
export const TURNSTILE_SCRIPT_TIMEOUT_MS = 10_000;
