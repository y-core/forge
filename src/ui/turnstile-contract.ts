/**
 * Shared Turnstile wiring — imported by BOTH the SSR `<Turnstile>` component (`ui/core`) and the
 * `mountTurnstile` controller (`ui/client`). Pure data, side-effect-free: safe to import into
 * either bundle. Internal: not part of the package's public export surface (like `scope-events.ts`).
 */

/** `data-ref` values the controller queries on the SSR-rendered markup. */
export const TURNSTILE = {
  /** Container the controller explicitly renders the widget into. */
  widget: "turnstile",
  /** Inline message revealed when the challenge cannot load. */
  fallback: "turnstile-fallback",
} as const;

/** Cloudflare Turnstile script. Rendered explicitly by the controller (no implicit auto-render). */
export const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/** If the script has not loaded within this budget, the controller reveals the fallback message. */
export const TURNSTILE_SCRIPT_TIMEOUT_MS = 10_000;
