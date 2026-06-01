import type { Context, Env, MiddlewareHandler } from "hono";
import {
  base64urlDecode,
  base64urlEncode,
  bytesToHex,
  hmacSign,
  hmacVerify,
  importHmacKeyFromHex,
  randomBytes,
  sha256,
  utf8Decode,
  utf8Encode,
} from "../crypto/mod";
import { CSRF_FIELD_DEFAULT } from "./constants";
import { parseFormData } from "./parse-form-data";
import type { CsrfContext, CsrfKeyRing, CsrfResult, CsrfSecretResolver } from "./types";

const CLOCK_SKEW_MS = 30_000;
const DEFAULT_KEY_ID = "0";

async function keyFingerprint(hexSecret: string): Promise<string> {
  return base64urlEncode(await sha256(hexSecret.toLowerCase())).slice(0, 12);
}

function normalizeRing(keyOrRing: CryptoKey | CsrfKeyRing): CsrfKeyRing {
  if ("activeKeyId" in keyOrRing) {
    return keyOrRing;
  }
  return { activeKeyId: DEFAULT_KEY_ID, keys: { [DEFAULT_KEY_ID]: keyOrRing } };
}

/** Imports a hex-encoded secret as a Web Crypto HMAC-SHA256 key for CSRF operations. @public */
export function importCsrfKey(hexSecret: string): Promise<CryptoKey> {
  return importHmacKeyFromHex(hexSecret, "CSRF secret");
}

/**
 * Imports one or more hex-encoded secrets into a CSRF key ring for rotation support.
 *
 * The **first** secret becomes the active signing key; all secrets are valid for
 * verification. Each secret gets a stable, fingerprint-derived key id (kid) so
 * tokens remain verifiable across the active→previous transition.
 *
 * **Rotation runbook:**
 * 1. Generate a new 256-bit hex secret.
 * 2. Deploy with both secrets: `importCsrfKeyRing([newSecret, oldSecret])`.
 * 3. Wait > token `maxAgeMs` (default 1h) for all old tokens to expire.
 * 4. Drop the old secret: `importCsrfKeyRing([newSecret])`.
 *
 * @public
 */
export async function importCsrfKeyRing(
  secrets: [string, ...string[]],
): Promise<CsrfKeyRing> {
  const entries = await Promise.all(
    secrets.map(async (hex) => {
      const kid = await keyFingerprint(hex);
      const key = await importCsrfKey(hex);
      return [kid, key] as const;
    }),
  );
  const activeKeyId = entries[0][0];
  const keys: Record<string, CryptoKey> = {};
  for (const [kid, key] of entries) {
    keys[kid] = key;
  }
  return { activeKeyId, keys };
}

export interface CsrfTokenOptions {
  kid?: string;
  /** Session or user identifier to bind to the token. When provided at verify time it must match. */
  subject?: string;
}

/** Creates a signed CSRF token embedding kid, path, optional subject, timestamp, and 16 random bytes. @public */
export async function createCsrfToken(
  key: CryptoKey,
  path: string,
  options: CsrfTokenOptions | string = {},
): Promise<string> {
  const opts: CsrfTokenOptions = typeof options === "string" ? { kid: options } : options;
  const effectiveKid = opts.kid ?? DEFAULT_KEY_ID;
  if (effectiveKid.includes("|")) {
    throw new Error("CSRF key id must not contain '|'");
  }
  const subject = opts.subject ?? "";
  if (subject.includes("|")) {
    throw new Error("CSRF subject must not contain '|'");
  }
  const timestamp = Date.now().toString();
  const nonce = bytesToHex(randomBytes(16));
  const payload = `${effectiveKid}|${path}|${subject}|${timestamp}|${nonce}`;
  const payloadEncoded = base64urlEncode(utf8Encode(payload));
  const sigEncoded = base64urlEncode(await hmacSign(key, payload));
  return `${payloadEncoded}.${sigEncoded}`;
}

export interface CsrfVerifyOptions {
  maxAgeMs?: number;
  /** When provided, the token's embedded subject must match this value. */
  subject?: string;
}

/**
 * Verifies a CSRF token; checks expiry, path, and optional subject before the HMAC
 * signature to avoid timing oracles.
 *
 * Accepts a single `CryptoKey` (default kid) or a `CsrfKeyRing` for rotation. When a ring
 * is provided, the token's embedded kid selects the verification key via O(1) map lookup.
 *
 * @public
 */
export async function verifyCsrfToken(
  keyOrRing: CryptoKey | CsrfKeyRing,
  token: string,
  path: string,
  maxAgeMsOrOptions: number | CsrfVerifyOptions = 3_600_000,
): Promise<CsrfResult> {
  const opts: CsrfVerifyOptions =
    typeof maxAgeMsOrOptions === "number"
      ? { maxAgeMs: maxAgeMsOrOptions }
      : maxAgeMsOrOptions;
  const maxAgeMs = opts.maxAgeMs ?? 3_600_000;

  if (!token) {
    return { ok: false, reason: "missing-token" };
  }

  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0 || dotIdx === token.length - 1) {
    return { ok: false, reason: "invalid-format" };
  }

  const payloadEncoded = token.slice(0, dotIdx);
  const sigEncoded = token.slice(dotIdx + 1);

  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = base64urlDecode(sigEncoded);
  } catch {
    return { ok: false, reason: "invalid-format" };
  }

  let payloadStr: string;
  try {
    payloadStr = utf8Decode(base64urlDecode(payloadEncoded));
  } catch {
    return { ok: false, reason: "invalid-format" };
  }

  const parts = payloadStr.split("|");
  if (parts.length !== 5) {
    return { ok: false, reason: "invalid-format" };
  }

  const [_kid, tokenPath, tokenSubject, timestampStr] = parts;
  const timestamp = Number(timestampStr);
  if (!Number.isInteger(timestamp)) {
    return { ok: false, reason: "expired" };
  }
  if (timestamp > Date.now() + CLOCK_SKEW_MS) {
    return { ok: false, reason: "future-timestamp" };
  }
  if (Date.now() - timestamp > maxAgeMs) {
    return { ok: false, reason: "expired" };
  }

  if (tokenPath !== path) {
    return { ok: false, reason: "path-mismatch" };
  }

  if (opts.subject !== undefined && tokenSubject !== opts.subject) {
    return { ok: false, reason: "subject-mismatch" };
  }

  const ring = normalizeRing(keyOrRing);
  const key = ring.keys[_kid];
  if (!key) {
    return { ok: false, reason: "unknown-key" };
  }

  const valid = await hmacVerify(key, payloadStr, sigBytes);
  if (!valid) {
    return { ok: false, reason: "invalid-signature" };
  }

  return { ok: true };
}

/**
 * Middleware that sets a CSRF token on GET requests and verifies it on mutations.
 *
 * The `secret` resolver is invoked **once** per middleware instance; the resulting
 * key (or key ring) is cached for the middleware's lifetime.
 *
 * The resolver may return:
 * - A single `CryptoKey` — no rotation; uses a default key id.
 * - A `CsrfKeyRing` — rotation enabled; new tokens are signed with the active key,
 *   all keys in the ring are valid for verification.
 *
 * **Rotation runbook:**
 * 1. Add the new secret as first element:
 *    `secret: () => importCsrfKeyRing([newSecret, oldSecret])`
 *    — the new secret signs all new tokens; both secrets verify.
 * 2. Deploy.
 * 3. Once every token minted under `oldSecret` has expired (wait > `maxAgeMs`,
 *    default 1h), drop it: `importCsrfKeyRing([newSecret])`.
 *
 * Key ids are derived from each secret (stable fingerprints), so a secret verifies
 * its own tokens across the active→previous transition. Performance is unchanged:
 * one cached import per key, one Map lookup + one HMAC verify per request.
 *
 * @public
 */
export function csrfProtection<E extends Env = Env>(options: {
  secret: CsrfSecretResolver<E>;
  tokenField?: string;
  headerName?: string;
  /** Optionally derive a subject (e.g. session id) from context to bind tokens to a session. */
  subject?: (c: Context<E>) => string | undefined;
}): MiddlewareHandler<E> {
  const { secret, tokenField = CSRF_FIELD_DEFAULT, headerName = "X-CSRF-Token" } = options;

  let resolvedRing: CsrfKeyRing | undefined;
  const resolveRing = async (c: Context<E>): Promise<CsrfKeyRing> => {
    if (!resolvedRing) {
      const result = await secret(c);
      resolvedRing = normalizeRing(result);
    }
    return resolvedRing;
  };

  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    const ring = await resolveRing(c);
    const activeKey = ring.keys[ring.activeKeyId];
    const subject = options.subject?.(c);

    const csrfContext = c as unknown as Context<{ Variables: CsrfContext }>;
    csrfContext.set(
      "mintCsrf",
      (path: string) => createCsrfToken(activeKey, path, { kid: ring.activeKeyId, subject }),
    );

    if (method === "GET" || method === "HEAD") {
      csrfContext.set(
        "csrfToken",
        await createCsrfToken(activeKey, c.req.path, { kid: ring.activeKeyId, subject }),
      );
      return next();
    }

    const headerToken = c.req.header(headerName);
    let token: string | undefined = headerToken ?? undefined;

    if (!token) {
      try {
        const formData = await parseFormData(c);
        token = formData.get(tokenField)?.toString() ?? undefined;
      } catch {
        // body cannot be parsed as form data — token stays undefined
      }
    }

    const result = await verifyCsrfToken(ring, token ?? "", c.req.path, { subject });
    if (!result.ok) {
      return c.text("Forbidden", 403);
    }

    return next();
  };
}
