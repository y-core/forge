import { beforeAll, describe, expect, it } from "bun:test";

import { ok } from "../../result/result";
import { importAuthKeyRing } from "../keys/ring";
import type { AuthKeyRing, UserStore } from "../types";
import { issueAuthDecoy, verifyAuthDecoy } from "./decoy";

let ring: AuthKeyRing;

beforeAll(async () => {
  ring = await importAuthKeyRing(["cd".repeat(32)]);
});

describe("issueAuthDecoy", () => {
  it("reports the branch it was, so a caller's deferred work says which path ran", async () => {
    expect(await issueAuthDecoy(ring, 1_700_000_000_000)).toBe("decoyed");
  });

  it("does the sealing a real challenge does, rather than resolving immediately", async () => {
    const failing: AuthKeyRing = { activeKeyId: ring.activeKeyId, keys: {} };
    // A decoy that skipped the seal would resolve here instead of failing on the missing key, which
    // is the cheapest proof that it is not a `Promise.resolve` wearing a name.
    await expect(issueAuthDecoy(failing, 1_700_000_000_000)).rejects.toThrow("the key ring has no key for its active key id");
  });
});

function countingUsers(): { store: UserStore; reads: string[] } {
  const reads: string[] = [];
  const store = {
    findById: (id: string) => {
      reads.push(id);
      return Promise.resolve(ok(null));
    },
    findByEmailKey: () => Promise.resolve(ok(null)),
    findByWebAuthnId: () => Promise.resolve(ok(null)),
    create: () => Promise.reject(new Error("not used")),
    setWebAuthnIdIfAbsent: () => Promise.resolve(ok(null)),
    markEmailVerified: () => Promise.resolve(ok(true)),
    changeEmail: () => Promise.resolve(ok(true)),
  } as UserStore;
  return { store, reads };
}

describe("verifyAuthDecoy", () => {
  it("reads one row, which is the lookup a real verification makes before it opens anything", async () => {
    const users = countingUsers();
    await verifyAuthDecoy(ring, users.store, 1_700_000_000_000);
    expect(users.reads).toEqual(["00000000-0000-7000-8000-000000000000"]);
  });

  it("opens a sealed token rather than resolving immediately", async () => {
    const failing: AuthKeyRing = { activeKeyId: ring.activeKeyId, keys: {} };
    await expect(verifyAuthDecoy(failing, countingUsers().store, 1_700_000_000_000)).rejects.toThrow(
      "the key ring has no key for its active key id",
    );
  });
});
