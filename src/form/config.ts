import { v } from "../validation/mod";

/** Maximum allowed form body size in bytes. Default: 100 KB. */
export const FORM_MAX_BYTES_DEFAULT = 100 * 1024;

/** Valibot schema validating CSRF config: a `secret` of at least 64 hex characters, the 32 bytes `importCsrfKey` requires. @public */
export const CsrfConfigSchema = v.object({
  secret: v.pipe(v.string(), v.regex(/^(?:[0-9a-fA-F]{2}){32,}$/, "must be an even number of hex characters, at least 64 (32 bytes)")),
});

/** Valibot schema validating Turnstile config: `secretKey` and `siteKey` strings. @public */
export const TurnstileConfigSchema = v.object({ secretKey: v.string(), siteKey: v.string() });
