import type { RequestContext } from "@remix-run/fetch-router";

import { EnvKey } from "../../context/types";
import { base64urlEncode, concatBytes, hexToBytes, sha256, utf8Encode } from "../../crypto/mod";
import { AUTH_KEY_ID_LENGTH, AUTH_SUPPORTED_ALGORITHMS } from "../config";
import type { AuthAlgorithm, AuthKeyRing, AuthOptions, AuthServices } from "../types";

/** Shortest root secret a key ring will accept — the HKDF input keying material for every subkey. */
const MINIMUM_KEY_BYTES = 32;

const KEY_ID_DOMAIN = utf8Encode("y-core/forge/auth/kid");

const servicesCache = new WeakMap<object, AuthServices>();

// `Object.hasOwn` and not `ring.keys[kid]`: an attacker-supplied kid of `constructor` resolves to a
// function through a bare property read, which turns a key lookup into a type confusion.
/** Reads one key out of a ring by id, resolving only ids the ring actually declares. @internal */
export function lookupAuthKey(ring: AuthKeyRing, kid: string): Uint8Array<ArrayBuffer> | undefined {
  return Object.hasOwn(ring.keys, kid) ? ring.keys[kid] : undefined;
}

/** Derives the id a key is known by — a fingerprint, so a consumer never types one. @public */
export async function authKeyId(key: Uint8Array<ArrayBuffer>): Promise<string> {
  return base64urlEncode(await sha256(concatBytes(KEY_ID_DOMAIN, key))).slice(0, AUTH_KEY_ID_LENGTH);
}

/** Builds a key ring from hex-encoded root secrets, the first becoming the active key. @public */
export async function importAuthKeyRing(secrets: [string, ...string[]]): Promise<AuthKeyRing> {
  const keys: Record<string, Uint8Array<ArrayBuffer>> = {};
  let activeKeyId: string | undefined;
  for (const hex of secrets) {
    if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) throw new Error("importAuthKeyRing: each secret must be an even-length hex string");
    const key = hexToBytes(hex);
    if (key.byteLength < MINIMUM_KEY_BYTES) {
      throw new Error(`importAuthKeyRing: each secret must be at least ${MINIMUM_KEY_BYTES} bytes (${MINIMUM_KEY_BYTES * 2} hex characters)`);
    }
    const kid = await authKeyId(key);
    keys[kid] = key;
    activeKeyId ??= kid;
  }
  if (!activeKeyId) throw new Error("importAuthKeyRing: at least one secret is required");
  return { activeKeyId, keys };
}

async function assertAlgorithmsAvailable(algorithms: readonly AuthAlgorithm[]): Promise<void> {
  if (!algorithms.includes(-8)) return;
  try {
    await crypto.subtle.importKey("raw", new Uint8Array(32), { name: "Ed25519" }, false, ["verify"]);
  } catch (cause) {
    throw new Error(
      "resolveAuthServices: COSE -8 (Ed25519) is configured but this runtime cannot import an Ed25519 key — raise the Worker's compatibility date, or drop -8 from `algorithms`",
      { cause },
    );
  }
}

function assertRingUsable(ring: AuthKeyRing): void {
  if (!lookupAuthKey(ring, ring.activeKeyId)) {
    throw new Error(`resolveAuthServices: the key ring has no key for its active key id "${ring.activeKeyId}"`);
  }
  for (const [kid, key] of Object.entries(ring.keys)) {
    if (key.byteLength < MINIMUM_KEY_BYTES) {
      throw new Error(`resolveAuthServices: key "${kid}" is ${key.byteLength} bytes — auth root keys must be at least ${MINIMUM_KEY_BYTES}`);
    }
  }
}

/** Resolves the auth capabilities for this request, caching them per `env` and failing closed on an unusable configuration. @public */
export async function resolveAuthServices(
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant to key resolution
  context: RequestContext<any, any>,
  options: AuthOptions,
): Promise<AuthServices> {
  const envObj = context.get(EnvKey);
  const cacheKey = envObj && typeof envObj === "object" ? envObj : null;
  if (cacheKey) {
    const hit = servicesCache.get(cacheKey);
    if (hit) return hit;
  }

  const algorithms = options.algorithms ?? AUTH_SUPPORTED_ALGORITHMS;
  // Resolving a binding throws, where a resolved store answers with a `Result`
  // ([`ERROR_HANDLING.md`](../../docs/ERROR_HANDLING.md) §5e) — so a bad ring fails here, not at sign-in.
  await assertAlgorithmsAvailable(algorithms);
  const keys = await Promise.resolve(options.secret(context));
  assertRingUsable(keys);

  const services: AuthServices = { algorithms, keys };
  if (cacheKey) servicesCache.set(cacheKey, services);
  return services;
}
