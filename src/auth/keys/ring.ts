import type { RequestContext } from "@remix-run/fetch-router";

import { EnvKey } from "../../context/types";
import { importKeyRingUnder, KEYRING_MIN_KEY_BYTES, keyRingKeyId, lookupKeyRingKey } from "../../keyring/ring";
import type { KeyRingDomain } from "../../keyring/types";
import { AUTH_SUPPORTED_ALGORITHMS } from "../config";
import type { AuthAlgorithm, AuthKeyRing, AuthOptions, AuthServices } from "../types";

/** The labels every auth key id and subkey is derived under. @internal */
export const AUTH_KEY_DOMAIN: KeyRingDomain = { keyIdLabel: "y-core/forge/auth/kid", subkeyLabel: "y-core/forge/auth/v1" };

// Nested on the env *and* the options: keyed on the env alone, two mounts with different
// `AuthOptions` share one key ring — a token minted under one secret and read under another's.
const servicesCache = new WeakMap<object, WeakMap<AuthOptions, AuthServices>>();

/** Derives the id a key is known by — a fingerprint, so a consumer never types one. @public */
export function authKeyId(key: Uint8Array<ArrayBuffer>): Promise<string> {
  return keyRingKeyId(AUTH_KEY_DOMAIN, key);
}

/** Builds a key ring from hex-encoded root secrets, the first becoming the active key. @public */
export function importAuthKeyRing(secrets: [string, ...string[]]): Promise<AuthKeyRing> {
  return importKeyRingUnder("importAuthKeyRing", AUTH_KEY_DOMAIN, secrets);
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
  if (!lookupKeyRingKey(ring, ring.activeKeyId)) {
    throw new Error(`resolveAuthServices: the key ring has no key for its active key id "${ring.activeKeyId}"`);
  }
  for (const [kid, key] of Object.entries(ring.keys)) {
    if (key.byteLength < KEYRING_MIN_KEY_BYTES) {
      throw new Error(`resolveAuthServices: key "${kid}" is ${key.byteLength} bytes — auth root keys must be at least ${KEYRING_MIN_KEY_BYTES}`);
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
  const perEnv = cacheKey ? servicesCache.get(cacheKey) : undefined;
  const hit = perEnv?.get(options);
  if (hit) return hit;

  const algorithms = options.algorithms ?? AUTH_SUPPORTED_ALGORITHMS;
  // Resolving a binding throws, where a resolved store answers with a `Result`
  // ([`FORGE_ERRORS.md`](../../docs/FORGE_ERRORS.md) §5e) — so a bad ring fails here, not at sign-in.
  await assertAlgorithmsAvailable(algorithms);
  const keys = await Promise.resolve(options.secret(context));
  assertRingUsable(keys);

  const services: AuthServices = { algorithms, keys };
  if (cacheKey) {
    const held = perEnv ?? new WeakMap<AuthOptions, AuthServices>();
    held.set(options, services);
    servicesCache.set(cacheKey, held);
  }
  return services;
}
