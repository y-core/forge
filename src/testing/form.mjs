// Generated from src/testing/form.ts by `bun run gen:bundles` — do not edit.

// src/form/constants.ts
var CSRF_FIELD_DEFAULT = "_csrf";
var CSRF_HEADER_DEFAULT = "X-CSRF-Token";

// src/validation/validation.ts
import * as v from "valibot";

// src/crypto/keyring/secrets.ts
var KEY_RING_SECRET_PATTERN = /^(?:[0-9a-fA-F]{2}){32,}(?:\s*,\s*(?:[0-9a-fA-F]{2}){32,})*$/;
var KeyRingSecretSchema = v.pipe(
  v.string(),
  v.trim(),
  v.regex(KEY_RING_SECRET_PATTERN, "must be comma-separated secrets, each an even number of hex characters, at least 64 (32 bytes)")
);

// src/form/config.ts
var FORM_MAX_BYTES_DEFAULT = 100 * 1024;
var CsrfConfigSchema = v.object({ secret: KeyRingSecretSchema });
var TurnstileConfigSchema = v.object({ secretKey: v.string(), siteKey: v.string() });

// src/crypto/primitives/aead.ts
function importAeadKey(raw) {
  if (raw.byteLength !== 32) throw new Error("importAeadKey: AES-256-GCM requires a 32-byte key");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// src/crypto/primitives/base64.ts
function base64Encode(data) {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64urlEncode(data) {
  return base64Encode(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// src/crypto/primitives/bytes.ts
var TEXT_ENCODER = new TextEncoder();
var TEXT_DECODER = new TextDecoder();
function utf8Encode(s) {
  return TEXT_ENCODER.encode(s);
}
function bytesToHex(bytes) {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
function hexToBytes(hex) {
  const pairs = hex.match(/.{2}/g) ?? [];
  return new Uint8Array(pairs.map((h) => Number.parseInt(h, 16)));
}
function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}
function concatBytes(...parts) {
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

// src/crypto/primitives/digest.ts
async function sha256(data) {
  const bytes = typeof data === "string" ? utf8Encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

// src/crypto/primitives/hkdf.ts
var HASH_LENGTH = 32;
function importHkdfHmac(raw) {
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function hkdfExtract(ikm, salt) {
  const saltKey = await importHkdfHmac(salt.byteLength > 0 ? salt : new Uint8Array(HASH_LENGTH));
  return new Uint8Array(await crypto.subtle.sign("HMAC", saltKey, ikm));
}
async function hkdfExpand(prk, info, length) {
  if (length < 1 || length > HASH_LENGTH * 255) throw new Error(`hkdfExpand: length must be between 1 and ${HASH_LENGTH * 255}`);
  const prkKey = await importHkdfHmac(prk);
  const okm = new Uint8Array(length);
  let block = new Uint8Array(0);
  for (let counter = 1, written = 0; written < length; counter++) {
    const input = new Uint8Array(block.byteLength + info.byteLength + 1);
    input.set(block, 0);
    input.set(info, block.byteLength);
    input[input.length - 1] = counter;
    block = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, input));
    okm.set(block.subarray(0, Math.min(block.byteLength, length - written)), written);
    written += block.byteLength;
  }
  return okm;
}

// src/crypto/primitives/hmac.ts
function importHmacKey(raw) {
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function hmacSign(key, data) {
  const bytes = typeof data === "string" ? utf8Encode(data) : data;
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
}

// src/crypto/primitives/strength.ts
var SECRET_MIN_BYTES = 32;
var SECRET_MIN_DISTINCT_BYTES = 8;
function assertSecretStrength(operation, secret) {
  if (secret.byteLength < SECRET_MIN_BYTES) {
    throw new Error(`${operation}: each secret must be at least ${SECRET_MIN_BYTES} bytes (got ${secret.byteLength})`);
  }
  const distinct = new Set(secret).size;
  if (distinct === 1) {
    throw new Error(`${operation}: a secret whose bytes are all the same value is not a secret \u2014 generate one with a CSPRNG`);
  }
  if (distinct < SECRET_MIN_DISTINCT_BYTES) {
    throw new Error(
      `${operation}: a secret carrying only ${distinct} distinct byte values is not one a CSPRNG produced \u2014 at least ${SECRET_MIN_DISTINCT_BYTES} are required`
    );
  }
}

// src/crypto/keyring/ring.ts
var KEY_RING_KEY_ID_LENGTH = 8;
var KEY_RING_DOMAIN = { keyIdLabel: "y-core/forge/keyring/kid", subkeyLabel: "y-core/forge/keyring/v1" };
var HMAC_DOMAIN = { keyIdLabel: KEY_RING_DOMAIN.keyIdLabel, subkeyLabel: "y-core/forge/keyring/hmac/v1" };
function lookupKeyRingKey(ring, kid) {
  return Object.hasOwn(ring.keys, kid) ? ring.keys[kid] : void 0;
}
async function keyRingKeyId(domain, key) {
  return base64urlEncode(await sha256(concatBytes(utf8Encode(domain.keyIdLabel), key))).slice(0, KEY_RING_KEY_ID_LENGTH);
}
var appKeyRingVerdicts = /* @__PURE__ */ new WeakMap();
function isAppKeyRing(ring) {
  const held = appKeyRingVerdicts.get(ring);
  if (held) return held;
  const key = lookupKeyRingKey(ring, ring.activeKeyId);
  const verdict = key ? keyRingKeyId(KEY_RING_DOMAIN, key).then((kid) => kid === ring.activeKeyId) : Promise.resolve(false);
  appKeyRingVerdicts.set(ring, verdict);
  return verdict;
}
async function assertAppKeyRing(operation, ring) {
  if (await isAppKeyRing(ring)) return;
  throw new Error(
    `${operation}: active key id "${ring.activeKeyId}" is not one importKeyRing derives \u2014 use only a ring importKeyRing built, never the auth key ring`
  );
}
async function importKeyRingUnder(operation, domain, secrets) {
  const keys = {};
  let activeKeyId;
  for (const hex of secrets) {
    if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) throw new Error(`${operation}: each secret must be an even-length hex string`);
    const key = hexToBytes(hex);
    assertSecretStrength(operation, key);
    const kid = await keyRingKeyId(domain, key);
    keys[kid] = key;
    activeKeyId ??= kid;
  }
  if (!activeKeyId) throw new Error(`${operation}: at least one secret is required`);
  return { activeKeyId, keys };
}
function importKeyRing(secrets) {
  return importKeyRingUnder("importKeyRing", KEY_RING_DOMAIN, secrets);
}

// src/context/accessor.ts
import { createContextKey } from "@remix-run/fetch-router";
function contextVar(name) {
  const key = createContextKey();
  return {
    key,
    // oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for context-variable access
    get(c, message) {
      const value = c.get(key);
      if (value === void 0) {
        throw new Error(message ?? `Context variable "${name}" is not set`);
      }
      return value;
    },
    // oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for context-variable access
    set(c, value) {
      c.set(key, value);
    },
    // oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for context-variable access
    getOptional(c) {
      return c.get(key);
    }
  };
}

// src/crypto/keyring/subkey.ts
var SUBKEY_BYTES = 32;
var subkeyCache = /* @__PURE__ */ new WeakMap();
var importedCache = /* @__PURE__ */ new WeakMap();
var IMPORTERS = {
  aead: importAeadKey,
  hmac: importHmacKey
};
function deriveSubkey(root, subkeyLabel, purpose) {
  return hkdfExtract(root, utf8Encode(subkeyLabel)).then((prk) => hkdfExpand(prk, utf8Encode(`${subkeyLabel}/${purpose}`), SUBKEY_BYTES));
}
function cacheFor(cache, ring) {
  const held = cache.get(ring);
  if (held) return held;
  const fresh = /* @__PURE__ */ new Map();
  cache.set(ring, fresh);
  return fresh;
}
function cachePendingUntilRejected(cache, key, pending) {
  cache.set(key, pending);
  pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key);
  });
  return pending;
}
function resolveKeyRingSubkey(ring, request) {
  const root = lookupKeyRingKey(ring, request.kid);
  if (!root) return void 0;
  const perRing = cacheFor(subkeyCache, ring);
  const cacheKey = `${request.domain.subkeyLabel}\0${request.kid}\0${request.purpose}`;
  const hit = perRing.get(cacheKey);
  if (hit) return hit;
  return cachePendingUntilRejected(perRing, cacheKey, deriveSubkey(root, request.domain.subkeyLabel, request.purpose));
}
function resolveKeyRingKey(ring, request, use) {
  const subkey = resolveKeyRingSubkey(ring, request);
  if (!subkey) return void 0;
  const perRing = cacheFor(importedCache, ring);
  const cacheKey = `${use}\0${request.domain.subkeyLabel}\0${request.kid}\0${request.purpose}`;
  const hit = perRing.get(cacheKey);
  if (hit) return hit;
  return cachePendingUntilRejected(perRing, cacheKey, subkey.then(IMPORTERS[use]));
}

// src/crypto/keyring/sign.ts
async function hmacUnderKeyRing(operation, ring, domain, purpose, data) {
  await assertAppKeyRing(operation, ring);
  const kid = ring.activeKeyId;
  const key = resolveKeyRingKey(ring, { domain, kid, purpose }, "hmac");
  if (!key) throw new Error(`${operation}: the key ring has no key for its active key id "${kid}"`);
  return { kid, mac: await hmacSign(await key, data) };
}
function signWithKeyRing(operation, ring, purpose, data) {
  return hmacUnderKeyRing(operation, ring, HMAC_DOMAIN, purpose, data);
}

// src/form/csrf.ts
var CSRF_PURPOSE = "csrf";
var CSRF_MINTER_KEY = "csrf";
var CSRF_TOKEN_KEY = "csrfToken";
var csrfMinterCtx = contextVar(CSRF_MINTER_KEY);
var csrfTokenCtx = contextVar(CSRF_TOKEN_KEY);
async function createCsrfToken(ring, path, options = {}) {
  const kid = ring.activeKeyId;
  const subject = options.subject ?? "";
  if (subject.includes("|")) throw new Error("CSRF subject must not contain '|'");
  if (path.includes("|")) throw new Error("CSRF path must not contain '|'");
  const timestamp = Date.now().toString();
  const nonce = bytesToHex(randomBytes(16));
  const payload = `${kid}|${path}|${subject}|${timestamp}|${nonce}`;
  const payloadEncoded = base64urlEncode(utf8Encode(payload));
  const { mac } = await signWithKeyRing("createCsrfToken", ring, CSRF_PURPOSE, payload);
  const sigEncoded = base64urlEncode(mac);
  return `${payloadEncoded}.${sigEncoded}`;
}

// src/testing/csrf.ts
async function mintTestCsrfToken(hexSecret, path, options) {
  return createCsrfToken(await importKeyRing([hexSecret]), path, options ?? {});
}
export {
  CSRF_FIELD_DEFAULT,
  CSRF_HEADER_DEFAULT,
  FORM_MAX_BYTES_DEFAULT,
  mintTestCsrfToken
};
