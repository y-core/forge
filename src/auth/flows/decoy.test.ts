import { beforeAll, describe, expect, it } from "bun:test";

import { ok } from "../../result/result";
import { createEmailOtpFactor } from "../factors/email-otp";
import { importAuthKeyRing } from "../keys/ring";
import { encodeAuthToken } from "../keys/token";
import type { AuthKeyRing, AuthNotifier, NonceStore, OtpState, OtpStateStore, UserStore } from "../types";
import { issueAuthDecoy, verifyAuthDecoy } from "./decoy";
import type { AuthDecoyStores } from "./types";

const AT = 1_700_000_000_000;
const DECOY_USER_ID = "00000000-0000-7000-8000-000000000000";

/** A real account's id, so the refusal the decoy is measured against runs against a live row. */
const REAL_USER_ID = "0192f0c0-0000-7000-8000-000000000001";

const NOTIFIER: AuthNotifier = { send: () => Promise.resolve(ok(undefined)) } as unknown as AuthNotifier;

let ring: AuthKeyRing;
let liveState: OtpState;

beforeAll(async () => {
  ring = await importAuthKeyRing(["bdeb9ba22af8fa73e59fe7c4d3c48ae1165617dd76c720773cdf6cbc33a91dd7"]);
  const token = await encodeAuthToken(ring, "verify", `${REAL_USER_ID} 123456`, 600_000, { now: AT });
  liveState = { token, attempts: 1, issuedAt: AT, expiresAt: AT + 600_000 };
});

// Thunks, because `liveState` is sealed in `beforeAll` and this table is built while the file loads.
/** What one refusal is answered against: the row `countAttempt` admitted, and the row `read` classified it by. */
interface Shape {
  readonly label: string;
  readonly counted: () => OtpState | null;
  readonly read: () => OtpState | null;
}

/** Every refusal shape the emailed-code factor collapses, which the decoy has to cost the same as. */
const SHAPES: readonly Shape[] = [
  { label: "a live row and the wrong code", counted: () => liveState, read: () => null },
  { label: "an absent or expired row", counted: () => null, read: () => null },
  { label: "a row whose attempts are exhausted", counted: () => null, read: () => liveState },
];

const LIVE = SHAPES[0] as Shape;

/** Every store the decoy may touch, each call recorded in the order it was made. */
function recording(shape: Shape, keys: AuthKeyRing = ring): { stores: AuthDecoyStores; calls: string[] } {
  const calls: string[] = [];
  const users = {
    findById: (id: string) => {
      calls.push(`users.findById:${id}`);
      return Promise.resolve(ok(null));
    },
    findByEmailKey: () => Promise.resolve(ok(null)),
    findByWebAuthnId: () => Promise.resolve(ok(null)),
    create: () => Promise.reject(new Error("not used")),
    setWebAuthnIdIfAbsent: () => Promise.resolve(ok(null)),
    markEmailVerified: () => Promise.resolve(ok(true)),
    changeEmail: () => Promise.resolve(ok(true)),
    revokeSessions: () => Promise.resolve(ok(true)),
  } as UserStore;

  const state: OtpStateStore = {
    issue: (userId) => {
      calls.push(`state.issue:${userId}`);
      return Promise.resolve(ok(true));
    },
    countAttempt: (userId) => {
      calls.push(`state.countAttempt:${userId}`);
      return Promise.resolve(ok(shape.counted()));
    },
    // Recorded, unlike the fixture this replaced: a read the decoy skipped was invisible while the
    // count was the only statement anything looked at.
    read: (userId) => {
      calls.push(`state.read:${userId}`);
      return Promise.resolve(ok(shape.read()));
    },
    discard: () => Promise.resolve(ok()),
    clear: (userId) => {
      calls.push(`state.clear:${userId}`);
      return Promise.resolve(ok());
    },
  };

  const nonces: NonceStore = {
    markConsumed: () => {
      calls.push("nonces.markConsumed");
      return Promise.resolve(ok(true));
    },
  };

  return { stores: { keys, users, state, nonces }, calls };
}

const noKeys: AuthKeyRing = { activeKeyId: "aaaaaaaa", keys: {} };

/** The AEAD seals and opens one awaited operation spends, counted off `crypto.subtle` itself. */
async function aeadOps(work: () => Promise<unknown>): Promise<{ seals: number; opens: number }> {
  const subtle = crypto.subtle;
  const { encrypt, decrypt } = subtle;
  let seals = 0;
  let opens = 0;
  subtle.encrypt = ((...args: Parameters<SubtleCrypto["encrypt"]>) => {
    seals += 1;
    return encrypt.apply(subtle, args);
  }) as SubtleCrypto["encrypt"];
  subtle.decrypt = ((...args: Parameters<SubtleCrypto["decrypt"]>) => {
    opens += 1;
    return decrypt.apply(subtle, args);
  }) as SubtleCrypto["decrypt"];
  try {
    await work();
  } finally {
    subtle.encrypt = encrypt;
    subtle.decrypt = decrypt;
  }
  return { seals, opens };
}

describe("issueAuthDecoy", () => {
  it("reports the branch it was, so a caller's deferred work says which path ran", async () => {
    expect(await issueAuthDecoy(recording(LIVE).stores, AT)).toBe("decoyed");
  });

  // The real branch claims the cooldown with one upsert before it mails anything. A decoy that
  // skipped the write returns a whole statement earlier, which is the latency oracle back again.
  it("spends the store write a real challenge spends, against the decoy id", async () => {
    const world = recording(LIVE);
    await issueAuthDecoy(world.stores, AT);
    expect(world.calls).toEqual([`state.issue:${DECOY_USER_ID}`]);
  });

  it("does the sealing a real challenge does, rather than resolving immediately", async () => {
    // A decoy that skipped the seal would resolve here instead of failing on the missing key, which
    // is the cheapest proof that it is not a `Promise.resolve` wearing a name.
    await expect(issueAuthDecoy(recording(LIVE, noKeys).stores, AT)).rejects.toThrow("the key ring has no key for its active key id");
  });
});

describe("verifyAuthDecoy", () => {
  /** The refusal the decoy stands in for, driven through the factor itself against one shape. */
  async function refusal(shape: Shape): Promise<{ calls: string[]; run: () => Promise<unknown> }> {
    const world = recording(shape);
    const factor = createEmailOtpFactor({
      keys: ring,
      state: world.stores.state,
      nonces: world.stores.nonces,
      notifier: NOTIFIER,
      address: () => "ada@example.com",
    });
    const run = (): Promise<unknown> => factor.verifyChallenge(REAL_USER_ID, "000000", AT);
    await run();
    return { calls: world.calls.map((call) => call.replace(REAL_USER_ID, "<user>")), run };
  }

  for (const shape of SHAPES) {
    it(`spends exactly the store calls a refusal against ${shape.label} spends, in the same order`, async () => {
      const world = recording(shape);
      await verifyAuthDecoy(world.stores, AT);

      expect(world.calls.map((call) => call.replace(DECOY_USER_ID, "<user>"))).toEqual((await refusal(shape)).calls);
    });
  }

  // Counted rather than eyeballed: the seal the decoy used to spend on a token of its own was two
  // AEAD operations against the refusal's one, and no test that compared store calls could see it.
  it("spends the same AEAD seals and opens every refusal spends, whatever row it was refused against", async () => {
    // Warmed first: the stand-in frame is sealed once per key ring, and that one-off is not what
    // either path costs on the request after it.
    await verifyAuthDecoy(recording(LIVE).stores, AT);

    const decoyed = await aeadOps(() => verifyAuthDecoy(recording(LIVE).stores, AT));
    expect(decoyed).toEqual({ seals: 0, opens: 1 });

    for (const shape of SHAPES) {
      expect(await aeadOps((await refusal(shape)).run)).toEqual(decoyed);
    }
  });

  it("opens a sealed token rather than resolving immediately", async () => {
    await expect(verifyAuthDecoy(recording(LIVE, noKeys).stores, AT)).rejects.toThrow("the key ring has no key for its active key id");
  });

  it("does not spend the nonce write and the clear a success spends, which is what made it slower", async () => {
    const world = recording(LIVE);
    await verifyAuthDecoy(world.stores, AT);

    expect(world.calls).not.toContain("nonces.markConsumed");
    expect(world.calls).not.toContain(`state.clear:${DECOY_USER_ID}`);
  });
});
