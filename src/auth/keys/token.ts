import {
  AEAD_NONCE_BYTES,
  aeadNonce,
  aeadOpen,
  aeadSeal,
  base64urlDecode,
  base64urlEncode,
  concatBytes,
  hmacSign,
  randomBytes,
  utf8Decode,
  utf8Encode,
} from "../../crypto/mod";
import { KEYRING_KID_BYTES } from "../../keyring/ring";
import { resolveKeyRingKey } from "../../keyring/subkey";
import { err, ok } from "../../result/result";
import type { Result } from "../../result/types";
import { AUTH_KEY_ID_LENGTH } from "../config";
import type { AuthKeyRing } from "../types";
import { AUTH_KEY_DOMAIN } from "./ring";
import type { AuthTokenClaims, AuthTokenOptions, AuthTokenPurpose, AuthTokenReason } from "./types";

/** The only frame version this codec writes or accepts. @public */
export const AUTH_TOKEN_VERSION = 1;

const TIMESTAMP_BYTES = 8;
const HEADER_BYTES = 1 + KEYRING_KID_BYTES + AEAD_NONCE_BYTES + TIMESTAMP_BYTES * 2;

function resolveAeadKey(ring: AuthKeyRing, kid: string, purpose: AuthTokenPurpose): Promise<CryptoKey> | undefined {
  return resolveKeyRingKey(ring, { domain: AUTH_KEY_DOMAIN, kid, purpose }, "aead");
}

function resolveHmacKey(ring: AuthKeyRing, kid: string, purpose: AuthTokenPurpose): Promise<CryptoKey> | undefined {
  return resolveKeyRingKey(ring, { domain: AUTH_KEY_DOMAIN, kid, purpose }, "hmac");
}

function writeTimestamp(view: DataView, offset: number, value: number): void {
  view.setBigUint64(offset, BigInt(Math.trunc(value)), false);
}

/** Refuses a key id that is not the shape `importAuthKeyRing` derives, naming the caller that was handed it. @internal */
export function assertAuthKeyId(operation: string, kid: string): void {
  if (kid.length !== AUTH_KEY_ID_LENGTH || !/^[A-Za-z0-9_-]+$/.test(kid)) {
    throw new Error(`${operation}: key id "${kid}" must be ${AUTH_KEY_ID_LENGTH} base64url characters — use importAuthKeyRing to derive one`);
  }
}

/** Seals a payload into a versioned, authenticated, base64url token bound to one purpose. @public */
export async function encodeAuthToken(
  ring: AuthKeyRing,
  purpose: AuthTokenPurpose,
  payload: string,
  ttlMs: number,
  options: AuthTokenOptions = {},
): Promise<string> {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("encodeAuthToken: ttlMs must be a positive number of milliseconds");
  const kid = ring.activeKeyId;
  assertAuthKeyId("encodeAuthToken", kid);
  const key = resolveAeadKey(ring, kid, purpose);
  if (!key) throw new Error(`encodeAuthToken: the key ring has no key for its active key id "${kid}"`);

  const issuedAt = options.now ?? Date.now();
  const frame = new Uint8Array(HEADER_BYTES);
  const view = new DataView(frame.buffer);
  frame[0] = AUTH_TOKEN_VERSION;
  frame.set(base64urlDecode(kid), 1);
  frame.set(aeadNonce(), 1 + KEYRING_KID_BYTES);
  writeTimestamp(view, 1 + KEYRING_KID_BYTES + AEAD_NONCE_BYTES, issuedAt);
  writeTimestamp(view, 1 + KEYRING_KID_BYTES + AEAD_NONCE_BYTES + TIMESTAMP_BYTES, issuedAt + ttlMs);

  // The whole header is the associated data, so a flipped byte in any field fails the tag rather
  // than silently moving the expiry or the key id.
  const sealed = await aeadSeal(
    await key,
    frame.slice(1 + KEYRING_KID_BYTES, 1 + KEYRING_KID_BYTES + AEAD_NONCE_BYTES),
    utf8Encode(payload),
    utf8Encode(`${purpose}\0${base64urlEncode(frame)}`),
  );

  return base64urlEncode(concatBytes(frame, sealed));
}

const STAND_IN_PAYLOAD_BYTES = 24;
const STAND_IN_TTL_MS = 86_400_000;

const standInCache = new WeakMap<AuthKeyRing, Map<AuthTokenPurpose, Promise<string>>>();

// Memoised per ring and purpose, so the seal is an isolate's one-off rather than a per-request cost
// the branch this stands in for does not pay. What it decodes to is never read.
/** A frame to open where a cost-constant path found no stored token to open. @internal */
export function authStandInToken(ring: AuthKeyRing, purpose: AuthTokenPurpose): Promise<string> {
  let perRing = standInCache.get(ring);
  if (!perRing) {
    perRing = new Map();
    standInCache.set(ring, perRing);
  }
  const hit = perRing.get(purpose);
  if (hit) return hit;
  const sealed = encodeAuthToken(ring, purpose, base64urlEncode(randomBytes(STAND_IN_PAYLOAD_BYTES)), STAND_IN_TTL_MS);
  perRing.set(purpose, sealed);
  return sealed;
}

function frameOf(token: string): Uint8Array<ArrayBuffer> | undefined {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64urlDecode(token);
  } catch {
    return undefined;
  }
  // Canonical form only: padding, `+`/`/` and non-zero trailing bits all decode to the same frame,
  // and every alias would otherwise pass the tag and derive a fresh nonce key for a spent token.
  if (base64urlEncode(bytes) !== token) return undefined;
  return bytes.byteLength > HEADER_BYTES ? bytes : undefined;
}

/** Reads the key id a token names, without trusting anything else about it. @internal */
export function tokenKeyId(token: string): string | undefined {
  const bytes = frameOf(token);
  if (!bytes || bytes[0] !== AUTH_TOKEN_VERSION) return undefined;
  return base64urlEncode(bytes.subarray(1, 1 + KEYRING_KID_BYTES));
}

/** Opens a token under one purpose, authenticating it before it is judged expired. @public */
export async function decodeAuthToken(
  ring: AuthKeyRing,
  purpose: AuthTokenPurpose,
  token: string,
  options: AuthTokenOptions = {},
): Promise<Result<AuthTokenClaims, AuthTokenReason>> {
  const bytes = frameOf(token);
  if (!bytes) return err("malformed");
  if (bytes[0] !== AUTH_TOKEN_VERSION) return err("unsupported-version");

  const kid = base64urlEncode(bytes.subarray(1, 1 + KEYRING_KID_BYTES));
  const key = resolveAeadKey(ring, kid, purpose);
  if (!key) return err("unknown-key");

  const frame = bytes.slice(0, HEADER_BYTES);
  const opened = await aeadOpen(
    await key,
    frame.slice(1 + KEYRING_KID_BYTES, 1 + KEYRING_KID_BYTES + AEAD_NONCE_BYTES),
    bytes.slice(HEADER_BYTES),
    utf8Encode(`${purpose}\0${base64urlEncode(frame)}`),
  );
  if (!opened) return err("not-authentic");

  const view = new DataView(frame.buffer);
  const issuedAt = Number(view.getBigUint64(1 + KEYRING_KID_BYTES + AEAD_NONCE_BYTES, false));
  const expiresAt = Number(view.getBigUint64(1 + KEYRING_KID_BYTES + AEAD_NONCE_BYTES + TIMESTAMP_BYTES, false));
  // Authenticity first: an expiry read off an unauthenticated frame is an attacker's number.
  if ((options.now ?? Date.now()) >= expiresAt) return err("expired");

  return ok({ payload: utf8Decode(opened), issuedAt, expiresAt });
}

// No floor: the nonce store is a SQL table whose rows a purge reclaims, so a short lifetime shortens
// only how long a consumed key is worth keeping — it never lets one be spent twice.
/** The nonce-store lifetime covering a token of `ttlMs`, in whole seconds. @internal */
export function authNonceTtlSeconds(ttlMs: number): number {
  return Math.max(0, Math.ceil(ttlMs / 1000));
}

/** Derives the store key a token is marked consumed under, keyed on the token's own key id. @public */
export async function authNonceKey(ring: AuthKeyRing, token: string): Promise<Result<string, AuthTokenReason>> {
  const bytes = frameOf(token);
  if (!bytes || bytes[0] !== AUTH_TOKEN_VERSION) return err("malformed");
  const key = resolveHmacKey(ring, base64urlEncode(bytes.subarray(1, 1 + KEYRING_KID_BYTES)), "nonce");
  if (!key) return err("unknown-key");
  // HMAC under a secret subkey, not a bare hash: a bare hash is computable by anyone holding the
  // token, handing a reader of the nonce store a consumed-or-not oracle for one seen in a log.
  return ok(base64urlEncode(await hmacSign(await key, bytes)));
}
