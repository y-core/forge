import type { Context, Env, MiddlewareHandler } from "hono";
import { CSRF_FIELD_DEFAULT } from "./constants";
import { parseFormData } from "./parse-form-data";
import type { CsrfKeyRing, CsrfResult, CsrfSecretResolver, CsrfVariables } from "./types";

// Module-level singletons — TextEncoder/TextDecoder are stateless, so reusing them
// across every sign/verify avoids a fresh allocation per CSRF operation.
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const CLOCK_SKEW_MS = 30_000;
const DEFAULT_KEY_ID = "0";

function base64urlEncode(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  const padded2 = remainder ? padded + "=".repeat(4 - remainder) : padded;
  const binary = atob(padded2);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function keyFingerprint(hexSecret: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    TEXT_ENCODER.encode(hexSecret.toLowerCase()),
  );
  return base64urlEncode(new Uint8Array(hash)).slice(0, 12);
}

function normalizeRing(keyOrRing: CryptoKey | CsrfKeyRing): CsrfKeyRing {
  if ("activeKeyId" in keyOrRing) {
    return keyOrRing;
  }
  return { activeKeyId: DEFAULT_KEY_ID, keys: { [DEFAULT_KEY_ID]: keyOrRing } };
}

/** Imports a hex-encoded secret as a Web Crypto HMAC-SHA256 key for CSRF operations. @public */
export async function importCsrfKey(hexSecret: string): Promise<CryptoKey> {
  if (hexSecret.length % 2 !== 0)
    throw new Error("CSRF secret must have an even number of hex characters");
  if (!/^[0-9a-fA-F]+$/.test(hexSecret))
    throw new Error("CSRF secret must contain only hexadecimal characters (0-9, a-f, A-F)");
  const pairs = hexSecret.match(/.{2}/g);
  if (!pairs || pairs.length < 16)
    throw new Error("CSRF secret must be at least 32 hex characters (16 bytes)");
  const bytes = new Uint8Array(pairs.map((h) => Number.parseInt(h, 16)));
  return crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
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

/** Creates a signed CSRF token embedding kid, path, timestamp, and 16 random bytes. @public */
export async function createCsrfToken(
  key: CryptoKey,
  path: string,
  kid?: string,
): Promise<string> {
  const effectiveKid = kid ?? DEFAULT_KEY_ID;
  if (effectiveKid.includes("|")) {
    throw new Error("CSRF key id must not contain '|'");
  }
  const timestamp = Date.now().toString();
  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  const randomHex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const payload = `${effectiveKid}|${path}|${timestamp}|${randomHex}`;
  const payloadEncoded = base64urlEncode(TEXT_ENCODER.encode(payload));
  const sigBuffer = await crypto.subtle.sign("HMAC", key, TEXT_ENCODER.encode(payload));
  const sigEncoded = base64urlEncode(new Uint8Array(sigBuffer));
  return `${payloadEncoded}.${sigEncoded}`;
}

/**
 * Verifies a CSRF token; checks expiry and path before the HMAC signature to avoid timing oracles.
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
  maxAgeMs = 3_600_000,
): Promise<CsrfResult> {
  if (!token) {
    return { ok: false, reason: "missing-token" };
  }

  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0 || dotIdx === token.length - 1) {
    return { ok: false, reason: "invalid-format" };
  }

  const payloadEncoded = token.slice(0, dotIdx);
  const sigEncoded = token.slice(dotIdx + 1);

  let sigBytes: Uint8Array;
  try {
    sigBytes = base64urlDecode(sigEncoded);
  } catch {
    return { ok: false, reason: "invalid-format" };
  }

  let payloadStr: string;
  try {
    payloadStr = TEXT_DECODER.decode(base64urlDecode(payloadEncoded));
  } catch {
    return { ok: false, reason: "invalid-format" };
  }

  const parts = payloadStr.split("|");
  if (parts.length !== 4) {
    return { ok: false, reason: "invalid-format" };
  }

  const [_kid, tokenPath, timestampStr] = parts;
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

  const ring = normalizeRing(keyOrRing);
  const key = ring.keys[_kid];
  if (!key) {
    return { ok: false, reason: "unknown-key" };
  }

  const sigBuffer = sigBytes.buffer.slice(
    sigBytes.byteOffset,
    sigBytes.byteOffset + sigBytes.byteLength,
  ) as ArrayBuffer;
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBuffer,
    TEXT_ENCODER.encode(payloadStr),
  );
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

    const csrfContext = c as unknown as Context<CsrfVariables>;
    csrfContext.set(
      "mintCsrfToken",
      (path: string) => createCsrfToken(activeKey, path, ring.activeKeyId),
    );

    if (method === "GET" || method === "HEAD") {
      csrfContext.set(
        "csrfToken",
        await createCsrfToken(activeKey, c.req.path, ring.activeKeyId),
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

    const result = await verifyCsrfToken(ring, token ?? "", c.req.path);
    if (!result.ok) {
      return c.text("Forbidden", 403);
    }

    return next();
  };
}
