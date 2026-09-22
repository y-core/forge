import { describe, expect, it } from "bun:test";

import { err, ok } from "../../result/result";
import { AuthStoreError } from "../errors";
import type { AuthFactorKind, AuthKeyRing, AuthStoreResult, FactorStore } from "../types";
import { authKeysRetirable } from "./retirement";

const ACTIVE = "AAAAAAAA";

/** The ring the predicate takes, so no caller can name a key the deployment is not sealing under. */
const RING: AuthKeyRing = { activeKeyId: ACTIVE, keys: {} };

function factorsHolding(held: AuthStoreResult<number>, asked: { kind?: AuthFactorKind; kid?: string } = {}): FactorStore {
  return {
    countSecretsNotUnder: (kind: AuthFactorKind, kid: string) => {
      asked.kind = kind;
      asked.kid = kid;
      return Promise.resolve(held);
    },
  } as unknown as FactorStore;
}

describe("authKeysRetirable", () => {
  it("is true exactly when nothing is left under any other key", async () => {
    expect(await authKeysRetirable(factorsHolding(ok(0)), "totp-app", RING)).toEqual({ ok: true, data: true });
    expect(await authKeysRetirable(factorsHolding(ok(1)), "totp-app", RING)).toEqual({ ok: true, data: false });
    expect(await authKeysRetirable(factorsHolding(ok(2_000)), "totp-app", RING)).toEqual({ ok: true, data: false });
  });

  it("asks about the kind and the active key it was given, and nothing else", async () => {
    const asked: { kind?: AuthFactorKind; kid?: string } = {};
    await authKeysRetirable(factorsHolding(ok(0), asked), "totp-app", RING);
    expect(asked).toEqual({ kind: "totp-app", kid: ACTIVE });
  });

  // A store outage is not an answer: reading it as "safe to drop" would retire a key on a failed read.
  it("carries a store failure rather than answering either way", async () => {
    const outage = new AuthStoreError("unavailable", "factors.countSecretsNotUnder");
    expect(await authKeysRetirable(factorsHolding(err(outage)), "totp-app", RING)).toEqual({ ok: false, error: outage });
  });
});
