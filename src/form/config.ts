import { v } from "../validation/mod";

/** Maximum allowed form body size in bytes. Default: 100 KB. */
export const FORM_MAX_BYTES_DEFAULT = 100 * 1024;

const KEY_RING_SECRET_PATTERN = /^(?:[0-9a-fA-F]{2}){32,}(?:\s*,\s*(?:[0-9a-fA-F]{2}){32,})*$/;

/** Valibot schema validating CSRF config: a `secret` key ring, newest first, of comma-separated hex secrets of at least 32 bytes each. @public */
export const CsrfConfigSchema = v.object({
  secret: v.pipe(
    v.string(),
    v.regex(KEY_RING_SECRET_PATTERN, "must be comma-separated secrets, each an even number of hex characters, at least 64 (32 bytes)"),
  ),
});

/** Valibot schema validating Turnstile config: `secretKey` and `siteKey` strings. @public */
export const TurnstileConfigSchema = v.object({ secretKey: v.string(), siteKey: v.string() });
