import { hkdfExpand, hkdfExtract, importAeadKey, importHmacKey, utf8Encode } from "../crypto/mod";
import { lookupKeyRingKey } from "./ring";
import type { KeyRing, KeyRingKeyUse, KeyRingSubkeyRequest } from "./types";

const SUBKEY_BYTES = 32;

const subkeyCache = new WeakMap<KeyRing, Map<string, Promise<Uint8Array<ArrayBuffer>>>>();
const importedCache = new WeakMap<KeyRing, Map<string, Promise<CryptoKey>>>();

const IMPORTERS: Readonly<Record<KeyRingKeyUse, (bytes: Uint8Array<ArrayBuffer>) => Promise<CryptoKey>>> = {
  aead: importAeadKey,
  hmac: importHmacKey,
};

function deriveSubkey(root: Uint8Array<ArrayBuffer>, subkeyLabel: string, purpose: string): Promise<Uint8Array<ArrayBuffer>> {
  return hkdfExtract(root, utf8Encode(subkeyLabel)).then((prk) => hkdfExpand(prk, utf8Encode(`${subkeyLabel}/${purpose}`), SUBKEY_BYTES));
}

function cacheFor<T>(cache: WeakMap<KeyRing, Map<string, T>>, ring: KeyRing): Map<string, T> {
  const held = cache.get(ring);
  if (held) return held;
  const fresh = new Map<string, T>();
  cache.set(ring, fresh);
  return fresh;
}

/** Resolves one purpose's HKDF subkey under one key id and domain, or `undefined` where the ring holds no such key. @internal */
export function resolveKeyRingSubkey(ring: KeyRing, request: KeyRingSubkeyRequest): Promise<Uint8Array<ArrayBuffer>> | undefined {
  const root = lookupKeyRingKey(ring, request.kid);
  if (!root) return undefined;
  const perRing = cacheFor(subkeyCache, ring);
  const cacheKey = `${request.domain.subkeyLabel}\0${request.kid}\0${request.purpose}`;
  const hit = perRing.get(cacheKey);
  if (hit) return hit;
  const derived = deriveSubkey(root, request.domain.subkeyLabel, request.purpose);
  perRing.set(cacheKey, derived);
  return derived;
}

/** Resolves one purpose's subkey imported for `use`, caching the import as well as the derivation. @internal */
export function resolveKeyRingKey(ring: KeyRing, request: KeyRingSubkeyRequest, use: KeyRingKeyUse): Promise<CryptoKey> | undefined {
  const subkey = resolveKeyRingSubkey(ring, request);
  if (!subkey) return undefined;
  const perRing = cacheFor(importedCache, ring);
  // The algorithm is in the key because one subkey is imported under both: an AEAD key handed to
  // `hmacSign` is a different `CryptoKey` with different usages, not the same one under a new name.
  const cacheKey = `${use}\0${request.domain.subkeyLabel}\0${request.kid}\0${request.purpose}`;
  const hit = perRing.get(cacheKey);
  if (hit) return hit;
  const imported = subkey.then(IMPORTERS[use]);
  perRing.set(cacheKey, imported);
  return imported;
}
