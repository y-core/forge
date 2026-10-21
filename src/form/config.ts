import { KeyRingSecretSchema } from "../crypto/keyring/secrets";
import { v } from "../validation/mod";

/** Maximum allowed form body size in bytes. Default: 100 KB. */
export const FORM_MAX_BYTES_DEFAULT = 100 * 1024;

/** Valibot schema validating CSRF config: a `secret` key ring checked by `KeyRingSecretSchema`. @public */
export const CsrfConfigSchema = v.object({ secret: KeyRingSecretSchema });

/** Valibot schema validating Turnstile config: `secretKey` and `siteKey` strings. @public */
export const TurnstileConfigSchema = v.object({ secretKey: v.string(), siteKey: v.string() });
