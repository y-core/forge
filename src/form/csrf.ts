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
import { err, ok } from "../result/result";
import { CSRF_FIELD_DEFAULT } from "./constants";
import { csrfFieldCtx } from "./field-context";
import { parseFormData } from "./parse-form-data";
import type {
  CsrfKeyRing,
  CsrfProtectionOptions,
  CsrfResult,
  CsrfSecretResolver,
  CsrfTokenOptions,
  CsrfVerifyOptions,
  ParseFormDataOptions,
} from "./types";

const CLOCK_SKEW_MS = 30_000;
const DEFAULT_KEY_ID = "0";

const CSRF_MINTER_KEY = "csrf";
const CSRF_TOKEN_KEY = "csrfToken";

/** Typed accessor for the per-request CSRF minter function set by `csrfProtection`. @public */
export const csrfMinterCtx = contextVar<(path: string) => Promise<string>>(CSRF_MINTER_KEY);
/** Typed accessor for the pre-minted CSRF token, bound to the current request's pathname, set by `csrfProtection` on GET/HEAD. @public */
export const csrfTokenCtx = contextVar<string>(CSRF_TOKEN_KEY);

async function keyFingerprint(hexSecret: string): Promise<string> {
  return base64urlEncode(await sha256(hexSecret.toLowerCase())).slice(0, 12);
}

// `Object.hasOwn` and not `ring.keys[kid]`: an attacker-supplied kid of `constructor` must not resolve.
function lookupKey(ring: CsrfKeyRing, kid: string): CryptoKey | undefined {
  return Object.hasOwn(ring.keys, kid) ? ring.keys[kid] : undefined;
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

/** Imports hex-encoded secrets into a CSRF key ring, the first becoming the active signing key. @public */
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
  options: CsrfVerifyOptions = {},
): Promise<CsrfResult> {
  const maxAgeMs = options.maxAgeMs ?? 3_600_000;

  if (!token) return err("missing-token");

  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0 || dotIdx === token.length - 1) return err("invalid-format");

  const payloadEncoded = token.slice(0, dotIdx);
  const sigEncoded = token.slice(dotIdx + 1);

  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = base64urlDecode(sigEncoded);
  } catch {
    return err("invalid-format");
  }

  let payloadStr: string;
  try {
    payloadStr = utf8Decode(base64urlDecode(payloadEncoded));
  } catch {
    return err("invalid-format");
  }

  const parts = payloadStr.split("|");
  if (parts.length !== 5) return err("invalid-format");

  const [_kid, tokenPath, tokenSubject, timestampStr] = parts as [string, string, string, string, string];
  const timestamp = Number(timestampStr);
  if (!Number.isInteger(timestamp)) return err("expired");
  if (timestamp > Date.now() + CLOCK_SKEW_MS) return err("future-timestamp");
  if (Date.now() - timestamp > maxAgeMs) return err("expired");

  if (tokenPath !== path) return err("path-mismatch");

  if (options.subject !== undefined && tokenSubject !== options.subject) {
    return err("subject-mismatch");
  }

  const ring = normalizeRing(keyOrRing);
  const key = lookupKey(ring, _kid);
  if (!key) return err("unknown-key");

  const valid = await hmacVerify(key, payloadStr, sigBytes);
  if (!valid) return err("invalid-signature");

  return ok();
}

/** Mints a CSRF token bound to `path` using the minter set by `csrfProtection`. @public */
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

/** Middleware that sets a CSRF token on GET requests and verifies it on mutations. @public */
export function csrfProtection(options: CsrfProtectionOptions): Middleware {
  const { secret, tokenField = CSRF_FIELD_DEFAULT, headerName = "X-CSRF-Token" } = options;
  const parseOptions: ParseFormDataOptions = options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {};

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
    const activeKey = lookupKey(ring, ring.activeKeyId);
    if (!activeKey) {
      throw new Error(`CSRF key ring has no key for active key id "${ring.activeKeyId}"`);
    }
    const subject = options.subject === false ? undefined : options.subject(context);
    const tokenOptions: CsrfTokenOptions = { kid: ring.activeKeyId, ...(subject !== undefined ? { subject } : {}) };

    csrfMinterCtx.set(context, (path: string) => createCsrfToken(activeKey, path, tokenOptions));
    // Published above every early return: a mutation is exactly the request whose downstream builder must know which field was consumed.
    csrfFieldCtx.set(context, tokenField);

    if (method === "GET" || method === "HEAD") {
      csrfTokenCtx.set(context, await createCsrfToken(activeKey, context.url.pathname, tokenOptions));
      return next();
    }

    const headerToken = context.request.headers.get(headerName);
    let token: string | undefined = headerToken ?? undefined;

    if (!token) {
      try {
        const formData = await parseFormData(context, parseOptions);
        token = formData.get(tokenField)?.toString() ?? undefined;
      } catch (err) {
        // A size failure is not a CSRF failure; reporting 403 would send the client after the wrong problem.
        if ((err as { status?: number }).status === 413) {
          return new Response("Payload Too Large", { status: 413 });
        }
      }
    }

    const result = await verifyCsrfToken(ring, token ?? "", context.url.pathname, { ...(subject !== undefined ? { subject } : {}) });
    if (!result.ok) {
      return new Response("Forbidden", { status: 403 });
    }

    return next();
  };
}
