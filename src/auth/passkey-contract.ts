/** `data-scope` a passkey ceremony stamps, so the controller resumes only on a page that rendered one. @public */
export const PASSKEY_SCOPE = "passkey";

/** `data-ref` values the controller queries on the SSR-rendered markup. @public */
export const PASSKEY = {
  /** Control the visitor presses to start the ceremony. */
  trigger: "passkey-trigger",
  /** Live region the controller writes progress and refusals into. */
  status: "passkey-status",
  /** Inline message revealed when the browser has no `PublicKeyCredential` at all. */
  unsupported: "passkey-unsupported",
  /** Field carrying the nickname a newly registered credential is stored under. */
  nickname: "passkey-nickname",
} as const;

/** Which ceremony the scope root runs: enrolling a new credential, or signing in with one. @public */
export type PasskeyMode = "registration" | "authentication";

/** Which ceremony the scope root runs. @public */
export const PASSKEY_MODE_ATTR = "data-passkey-mode";

/** Endpoint the controller asks for the ceremony options, supplied by `authPaths`. @public */
export const PASSKEY_OPTIONS_PATH_ATTR = "data-passkey-options-path";

/** Endpoint the controller posts the finished ceremony to, supplied by `authPaths`. @public */
export const PASSKEY_VERIFY_PATH_ATTR = "data-passkey-verify-path";

/** CSRF token minted for `PASSKEY_OPTIONS_PATH_ATTR`, and valid at no other path. @public */
export const PASSKEY_OPTIONS_TOKEN_ATTR = "data-passkey-options-token";

/** CSRF token minted for `PASSKEY_VERIFY_PATH_ATTR`, and valid at no other path. @public */
export const PASSKEY_VERIFY_TOKEN_ATTR = "data-passkey-verify-token";

/** Header both tokens are sent on, when the app's `csrfProtection` does not use the default. @public */
export const PASSKEY_CSRF_HEADER_ATTR = "data-passkey-csrf-header";

/** `csrfProtection`'s own default header name, used when the attribute is absent. @public */
export const PASSKEY_CSRF_HEADER_DEFAULT = "X-CSRF-Token";

/** Where the controller navigates once verification succeeds. @public */
export const PASSKEY_REDIRECT_ATTR = "data-passkey-redirect";

/** Where a redirect target that is not a same-origin path is sent instead. @public */
export const PASSKEY_REDIRECT_FALLBACK = "/";

/** Why a ceremony ended without a signed-in visitor. @public */
export type PasskeyFailureReason = "unsupported" | "declined" | "already-enrolled" | "options-failed" | "ceremony-failed" | "verification-failed";

/** Event dispatched on the scope root when a ceremony ends, whichever way it ended. @public */
export const PASSKEY_OUTCOME_EVENT = "passkey:outcome";

/** `detail` of `PASSKEY_OUTCOME_EVENT`; `reason` is absent exactly when the ceremony succeeded. @public */
export type PasskeyOutcomeDetail = { mode: PasskeyMode; reason?: PasskeyFailureReason };
