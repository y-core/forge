/** Default form field name for the CSRF token hidden input. */
export const CSRF_FIELD_DEFAULT = "_csrf";

/** Default request header the CSRF token is read from, and the name `Form` writes into `hx-headers`. */
export const CSRF_HEADER_DEFAULT = "X-CSRF-Token";

/** Default form field name for the Turnstile token, as written by the Cloudflare widget. */
export const TURNSTILE_FIELD_DEFAULT = "cf-turnstile-response";
