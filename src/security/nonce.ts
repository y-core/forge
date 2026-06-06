/**
 * Placeholder used in `scriptSrc` (and similar CSP directives) to request a per-request
 * nonce injection. `makeSecurityHeaders` replaces it with `'nonce-xxx'` at response time.
 *
 * @example
 * ```ts
 * makeSecurityHeaders({ scriptSrc: ["'self'", NONCE, TURNSTILE_CSP] })
 * ```
 * @public
 */
export const NONCE: unique symbol = Symbol("@y-core/forge/csp-nonce");
