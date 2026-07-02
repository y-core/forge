/**
 * Placeholder used in `scriptSrc` (and similar CSP directives) to request a per-request
 * nonce injection. `createSecurityHeaders` replaces it with `'nonce-xxx'` at response time.
 *
 * @example
 * ```ts
 * createSecurityHeaders({ scriptSrc: ["'self'", NONCE, TURNSTILE_CSP] })
 * ```
 * @public
 */
export const NONCE: unique symbol = Symbol("@y-core/forge/csp-nonce");

/**
 * Cloudflare Turnstile CDN origin — add to `scriptSrc`, `connectSrc`, and `frameSrc`
 * when Turnstile is active. Exported as a typed constant so consumers avoid hardcoding
 * the string and can swap the import if the origin ever changes.
 *
 * @example
 * ```ts
 * createSecurityHeaders({ scriptSrc: ["'self'", NONCE, TURNSTILE_CSP] })
 * ```
 * @public
 */
export const TURNSTILE_CSP = "https://challenges.cloudflare.com" as const;
