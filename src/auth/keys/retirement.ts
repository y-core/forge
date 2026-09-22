import { err, ok } from "../../result/result";
import type { AuthFactorKind, AuthKeyRing, AuthStoreResult, FactorStore } from "../types";

// A predicate and not a threshold, because forge can retire nothing: the ring is whatever the
// consumer passed `importAuthKeyRing`, and deleting a Worker secret is the operator's own action.
/** Whether every stored `kind` secret is sealed under the ring's active key, so every other key on it may be dropped. @public */
export async function authKeysRetirable(factors: FactorStore, kind: AuthFactorKind, keys: AuthKeyRing): Promise<AuthStoreResult<boolean>> {
  const held = await factors.countSecretsNotUnder(kind, keys.activeKeyId);
  return held.ok ? ok(held.data === 0) : err(held.error);
}
