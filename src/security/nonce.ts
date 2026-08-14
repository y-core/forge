/** CSP source placeholder that `createSecurityHeaders` replaces with the per-request `'nonce-xxx'`. @public */
export const NONCE: unique symbol = Symbol("@y-core/forge/csp-nonce");

/** Cloudflare Turnstile CDN origin, for use as a CSP source. @public */
export const TURNSTILE_CSP = "https://challenges.cloudflare.com" as const;
