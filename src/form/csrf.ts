import type { Middleware, RequestContext } from "@remix-run/fetch-router";
import { contextVar } from "../context/accessor";
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
import type { CsrfKeyRing, CsrfResult, CsrfSecretResolver, CsrfTokenOptions, CsrfVerifyOptions } from "./types";

const CLOCK_SKEW_MS = 30_000;
const DEFAULT_KEY_ID = "0";

const CSRF_MINTER_KEY = "csrf";
const CSRF_TOKEN_KEY = "csrfToken";

/** Typed accessor for the per-request CSRF minter function set by `csrfProtection`. @public */
export const csrfMinterCtx = contextVar<(path: string) => Promise<string>>(CSRF_MINTER_KEY);
/**
 * Typed accessor for the pre-minted CSRF token set by `csrfProtection` on GET/HEAD requests.
 *
 * The token is bound to the **current request's pathname**. Use it only when the form POSTs back
 * to the same path. When the form submits to a different action path, mint a token for that path
 * with `mintCsrf(ctx, actionPath)` instead — otherwise verification fails with `path-mismatch`. @public
 */
export const csrfTokenCtx = contextVar<string>(CSRF_TOKEN_KEY);

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
 * The **first** secret becomes the active signing key; all secrets are valid for verification. @public
 */
export async function importCsrfKeyRing(secrets: [string, ...string[]]): Promise<CsrfKeyRing> {
  const entries = await Promise.all(
    secrets.map(async (hex) => {
      const kid = await keyFingerprint(hex);
      const key = await importCsrfKey(hex);
      return [kid, key] as const;
    }),
  );
  const first = entries[0];
  if (!first) throw new Error("CSRF key ring requires at least one secret");
  const activeKeyId = first[0];
  const keys: Record<string, CryptoKey> = {};
  for (const [kid, key] of entries) {
    keys[kid] = key;
  }
  return { activeKeyId, keys };
}

/** Creates a signed CSRF token embedding kid, path, optional subject, timestamp, and 16 random bytes. @public */
export async function createCsrfToken(key: CryptoKey, path: string, options: CsrfTokenOptions = {}): Promise<string> {
  const effectiveKid = options.kid ?? DEFAULT_KEY_ID;
  if (effectiveKid.includes("|")) throw new Error("CSRF key id must not contain '|'");
  const subject = options.subject ?? "";
  if (subject.includes("|")) throw new Error("CSRF subject must not contain '|'");
  if (path.includes("|")) throw new Error("CSRF path must not contain '|'");
  const timestamp = Date.now().toString();
  const nonce = bytesToHex(randomBytes(16));
  const payload = `${effectiveKid}|${path}|${subject}|${timestamp}|${nonce}`;
  const payloadEncoded = base64urlEncode(utf8Encode(payload));
  const sigEncoded = base64urlEncode(await hmacSign(key, payload));
  return `${payloadEncoded}.${sigEncoded}`;
}

/** Verifies a CSRF token. @public */
export async function verifyCsrfToken(
  keyOrRing: CryptoKey | CsrfKeyRing,
  token: string,
  path: string,
  maxAgeMsOrOptions: number | CsrfVerifyOptions = 3_600_000,
): Promise<CsrfResult> {
  const opts: CsrfVerifyOptions = typeof maxAgeMsOrOptions === "number" ? { maxAgeMs: maxAgeMsOrOptions } : maxAgeMsOrOptions;
  const maxAgeMs = opts.maxAgeMs ?? 3_600_000;

  if (!token) return { ok: false, reason: "missing-token" };

  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0 || dotIdx === token.length - 1) return { ok: false, reason: "invalid-format" };

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
  if (parts.length !== 5) return { ok: false, reason: "invalid-format" };

  const [_kid, tokenPath, tokenSubject, timestampStr] = parts as [string, string, string, string, string];
  const timestamp = Number(timestampStr);
  if (!Number.isInteger(timestamp)) return { ok: false, reason: "expired" };
  if (timestamp > Date.now() + CLOCK_SKEW_MS) return { ok: false, reason: "future-timestamp" };
  if (Date.now() - timestamp > maxAgeMs) return { ok: false, reason: "expired" };

  if (tokenPath !== path) return { ok: false, reason: "path-mismatch" };

  if (opts.subject !== undefined && tokenSubject !== opts.subject) {
    return { ok: false, reason: "subject-mismatch" };
  }

  const ring = normalizeRing(keyOrRing);
  const key = ring.keys[_kid];
  if (!key) return { ok: false, reason: "unknown-key" };

  const valid = await hmacVerify(key, payloadStr, sigBytes);
  if (!valid) return { ok: false, reason: "invalid-signature" };

  return { ok: true };
}

/**
 * Mints a CSRF token bound to `path` using the minter set by `csrfProtection`.
 * `path` is required — a token must declare the action path it authorizes, or verification
 * would fail with `path-mismatch`. Throws when `path` is missing or empty. @public
 */
// biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for csrf minting
export async function mintCsrf(context: RequestContext<any, any>, path?: string): Promise<string> {
  if (!path) {
    throw new Error("mintCsrf: a non-empty action path is required to mint a CSRF token");
  }
  const mint = csrfMinterCtx.get(context, "mintCsrf: no CSRF minter on context — mount csrfProtection on this route");
  return mint(path);
}

/** CSRF secret resolver type. @public */
export type { CsrfSecretResolver };

/**
 * Middleware that sets a CSRF token on GET requests and verifies it on mutations.
 *
 * The `secret` resolver is invoked **once per distinct `context.env` object** and the
 * resulting key ring is cached against it via `WeakMap`. In Cloudflare Workers production
 * the same `env` binding lives for the isolate's lifetime, so the key is imported exactly
 * once. In tests each `app.request(..., env)` call with a different `env` object re-invokes
 * the resolver, ensuring per-environment isolation. Falls back to no-cache when `env` is
 * absent. @public
 */
export function csrfProtection<Bindings = Record<string, unknown>>(options: {
  // biome-ignore lint/suspicious/noExplicitAny: context shape varies
  secret: (context: RequestContext<any, any>) => CryptoKey | CsrfKeyRing | Promise<CryptoKey | CsrfKeyRing>;
  tokenField?: string;
  headerName?: string;
  // biome-ignore lint/suspicious/noExplicitAny: context shape varies
  subject?: (context: RequestContext<any, any>) => string | undefined;
}): Middleware {
  const { secret, tokenField = CSRF_FIELD_DEFAULT, headerName = "X-CSRF-Token" } = options;

  const ringCache = new WeakMap<object, CsrfKeyRing>();
  // biome-ignore lint/suspicious/noExplicitAny: context shape varies
  const resolveRing = async (context: RequestContext<any, any>): Promise<CsrfKeyRing> => {
    // biome-ignore lint/suspicious/noExplicitAny: env shape varies across apps and tests
    const envObj = (context as any).env;
    const cacheKey = envObj && typeof envObj === "object" ? (envObj as object) : null;
    if (cacheKey) {
      const hit = ringCache.get(cacheKey);
      if (hit) return hit;
    }
    const ring = normalizeRing(await Promise.resolve(secret(context)));
    if (cacheKey) ringCache.set(cacheKey, ring);
    return ring;
  };

  return async (context, next) => {
    const method = context.method.toUpperCase();
    const ring = await resolveRing(context);
    const activeKey = ring.keys[ring.activeKeyId];
    if (!activeKey) {
      throw new Error(`CSRF key ring has no key for active key id "${ring.activeKeyId}"`);
    }
    const subject = options.subject?.(context);
    const tokenOptions: CsrfTokenOptions = { kid: ring.activeKeyId, ...(subject !== undefined ? { subject } : {}) };

    csrfMinterCtx.set(context, (path: string) => createCsrfToken(activeKey, path, tokenOptions));

    if (method === "GET" || method === "HEAD") {
      csrfTokenCtx.set(context, await createCsrfToken(activeKey, context.url.pathname, tokenOptions));
      return next();
    }

    const headerToken = context.request.headers.get(headerName);
    let token: string | undefined = headerToken ?? undefined;

    if (!token) {
      try {
        const formData = await parseFormData(context);
        token = formData.get(tokenField)?.toString() ?? undefined;
      } catch {
        // body cannot be parsed as form data — token stays undefined
      }
    }

    const result = await verifyCsrfToken(ring, token ?? "", context.url.pathname, { ...(subject !== undefined ? { subject } : {}) });
    if (!result.ok) {
      return new Response("Forbidden", { status: 403 });
    }

    return next();
  };
}
