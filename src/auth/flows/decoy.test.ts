import { beforeAll, describe, expect, it } from "bun:test";

import { ok } from "../../result/result";
import { importAuthKeyRing } from "../keys/ring";
import type { AuthKeyRing, NonceStore, OtpStateStore, UserStore } from "../types";
import { issueAuthDecoy, verifyAuthDecoy } from "./decoy";
import type { AuthDecoyStores } from "./types";

const AT = 1_700_000_000_000;
const DECOY_USER_ID = "00000000-0000-7000-8000-000000000000";

let ring: AuthKeyRing;

beforeAll(async () => {
  ring = await importAuthKeyRing(["bdeb9ba22af8fa73e59fe7c4d3c48ae1165617dd76c720773cdf6cbc33a91dd7"]);
});

/** Every store the decoy may touch, each call recorded in the order it was made. */
function recording(keys: AuthKeyRing = ring): { stores: AuthDecoyStores; calls: string[] } {
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
      return Promise.resolve(ok(null));
    },
    read: () => Promise.resolve(ok(null)),
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

describe("issueAuthDecoy", () => {
  it("reports the branch it was, so a caller's deferred work says which path ran", async () => {
    expect(await issueAuthDecoy(recording().stores, AT)).toBe("decoyed");
  });

  // The real branch claims the cooldown with one upsert before it mails anything. A decoy that
  // skipped the write returns a whole statement earlier, which is the latency oracle back again.
  it("spends the store write a real challenge spends, against the decoy id", async () => {
    const world = recording();
    await issueAuthDecoy(world.stores, AT);
    expect(world.calls).toEqual([`state.issue:${DECOY_USER_ID}`]);
  });

  it("does the sealing a real challenge does, rather than resolving immediately", async () => {
    // A decoy that skipped the seal would resolve here instead of failing on the missing key, which
    // is the cheapest proof that it is not a `Promise.resolve` wearing a name.
    await expect(issueAuthDecoy(recording(noKeys).stores, AT)).rejects.toThrow("the key ring has no key for its active key id");
  });
});

describe("verifyAuthDecoy", () => {
  // The real branch reads the row, spends a guess, opens the sealed token, consumes the nonce and
  // clears the state. Every one of those is a statement, and a branch short of one is measurable.
  it("issues the same store calls, in the same order, as a real verification", async () => {
    const world = recording();
    await verifyAuthDecoy(world.stores, AT);
    expect(world.calls).toEqual([
      `users.findById:${DECOY_USER_ID}`,
      `state.countAttempt:${DECOY_USER_ID}`,
      "nonces.markConsumed",
      `state.clear:${DECOY_USER_ID}`,
    ]);
  });

  it("opens a sealed token rather than resolving immediately", async () => {
    await expect(verifyAuthDecoy(recording(noKeys).stores, AT)).rejects.toThrow("the key ring has no key for its active key id");
  });
});
