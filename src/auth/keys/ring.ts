import type { RequestContext } from "@remix-run/fetch-router";

import { EnvKey } from "../../context/types";
import { importKeyRingUnder, keyRingKeyId, lookupKeyRingKey } from "../../crypto/keyring/ring";
import { cachePendingUntilRejected } from "../../crypto/keyring/subkey";
import type { KeyRing, KeyRingDomain } from "../../crypto/keyring/types";
import { assertSecretStrength } from "../../crypto/primitives/strength";
import { AUTH_SUPPORTED_ALGORITHMS } from "../config";
import type { AuthAlgorithm, AuthOptions, AuthServices } from "../types";

/** The labels every auth key id and subkey is derived under. @internal */
export const AUTH_KEY_DOMAIN: KeyRingDomain = { keyIdLabel: "y-core/forge/auth/kid", subkeyLabel: "y-core/forge/auth/v1" };

// Nested on the env *and* the options: keyed on the env alone, two mounts with different
// `AuthOptions` share one key ring — a token minted under one secret and read under another's.
const servicesCache = new WeakMap<object, WeakMap<AuthOptions, Promise<AuthServices>>>();

/** Derives the id a key is known by — a fingerprint, so a consumer never types one. @public */
export function authKeyId(key: Uint8Array<ArrayBuffer>): Promise<string> {
  return keyRingKeyId(AUTH_KEY_DOMAIN, key);
}

/** Builds a key ring from hex-encoded root secrets, the first becoming the active key. @public */
export function importAuthKeyRing(secrets: [string, ...string[]]): Promise<KeyRing> {
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

function assertRingUsable(ring: KeyRing): void {
  if (!lookupKeyRingKey(ring, ring.activeKeyId)) {
    throw new Error(`resolveAuthServices: the key ring has no key for its active key id "${ring.activeKeyId}"`);
  }
  for (const [kid, key] of Object.entries(ring.keys)) {
    assertSecretStrength(`resolveAuthServices: key "${kid}"`, key);
  }
}

// oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant to key resolution
async function buildAuthServices(context: RequestContext<any, any>, options: AuthOptions): Promise<AuthServices> {
  const algorithms = options.algorithms ?? AUTH_SUPPORTED_ALGORITHMS;
  await assertAlgorithmsAvailable(algorithms);
  const keys = await Promise.resolve(options.ring(context));
  assertRingUsable(keys);
  return { algorithms, keys };
}

/** Resolves the auth capabilities for this request, caching them per `env` and failing closed on an unusable configuration. @public */
export async function resolveAuthServices(
  // oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant to key resolution
  context: RequestContext<any, any>,
  options: AuthOptions,
): Promise<AuthServices> {
  const envObj = context.get(EnvKey);
  const cacheKey = envObj && typeof envObj === "object" ? envObj : null;
  if (!cacheKey) return buildAuthServices(context, options);
  let perEnv = servicesCache.get(cacheKey);
  if (!perEnv) {
    perEnv = new WeakMap<AuthOptions, Promise<AuthServices>>();
    servicesCache.set(cacheKey, perEnv);
  }
  return perEnv.get(options) ?? cachePendingUntilRejected(perEnv, options, buildAuthServices(context, options));
}
