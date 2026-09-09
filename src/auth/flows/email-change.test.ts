import { beforeAll, describe, expect, it } from "bun:test";

import { uuidv7 } from "../../crypto/mod";
import { err, ok } from "../../result/result";
import { AuthStoreError } from "../errors";
import { importAuthKeyRing } from "../keys/ring";
import { encodeAuthToken } from "../keys/token";
import type { AuthKeyRing, AuthMessage, AuthUser, NonceStore, UserStore } from "../types";
import type { AuthIssueOutcome } from "./decoy";
import { type AuthEmailChangeOptions, createEmailChangeFlow } from "./email-change";

const USER_ID = uuidv7();
const OTHER_ID = uuidv7();
const AT = 1_700_000_000_000;
const TTL_MS = 3_600_000;

let ring: AuthKeyRing;
let otherRing: AuthKeyRing;

beforeAll(async () => {
  ring = await importAuthKeyRing(["12".repeat(32)]);
  otherRing = await importAuthKeyRing(["34".repeat(32)]);
});

function userRow(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: USER_ID,
    email: "person@example.com",
    emailKey: "person@example.com",
    emailVerifiedAt: 1_600_000_000_000,
    webauthnId: null,
    isAdmin: false,
    deactivatedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

interface EmailWrite {
  id: string;
  email: string;
  emailKey: string;
}

function fakeUsers(seed: readonly AuthUser[], options: { conflict?: boolean; unavailable?: boolean } = {}) {
  const rows = [...seed];
  const writes: EmailWrite[] = [];
  const verified: string[] = [];
  const store: UserStore = {
    findById: (id) => Promise.resolve(ok(rows.find((row) => row.id === id) ?? null)),
    findByEmailKey: (emailKey) => Promise.resolve(ok(rows.find((row) => row.emailKey === emailKey) ?? null)),
    findByWebAuthnId: () => Promise.resolve(ok(null)),
    create: () => Promise.reject(new Error("not used")),
    setWebAuthnIdIfAbsent: () => Promise.resolve(ok(null)),
    markEmailVerified: (id) => {
      verified.push(id);
      return Promise.resolve(ok(true));
    },
    changeEmail: (id, email, emailKey, at) => {
      if (options.conflict) {
        return Promise.resolve(err(new AuthStoreError("conflict", "users.changeEmail", { constraint: "auth_users.email_key" })));
      }
      if (options.unavailable) return Promise.resolve(err(new AuthStoreError("unavailable", "users.changeEmail")));
      writes.push({ id, email, emailKey });
      const index = rows.findIndex((row) => row.id === id);
      const row = rows[index];
      if (index < 0 || !row) return Promise.resolve(ok(false));
      rows[index] = { ...row, email, emailKey, emailVerifiedAt: at, updatedAt: at };
      return Promise.resolve(ok(true));
    },
  };
  return { store, rows, writes, verified };
}

function fakeNonces() {
  const seen = new Set<string>();
  const store: NonceStore = {
    markConsumed: (key) => {
      if (seen.has(key)) return Promise.resolve(ok(false));
      seen.add(key);
      return Promise.resolve(ok(true));
    },
  };
  return { store, seen };
}

/** Delivery hangs until `release`, which is how a test can prove `request` did not wait for it. */
function fakeNotifier() {
  const sent: AuthMessage[] = [];
  let release: () => void = () => {};
  const delivered = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    notifier: {
      send: async (message: AuthMessage) => {
        sent.push(message);
        await delivered;
        return ok();
      },
    },
    sent,
    release,
  };
}

function scene(
  seed: readonly AuthUser[] = [userRow()],
  options: { conflict?: boolean; unavailable?: boolean } = {},
  overrides: Partial<AuthEmailChangeOptions> = {},
) {
  const users = fakeUsers(seed, options);
  const nonces = fakeNonces();
  const mail = fakeNotifier();
  const scheduled: Promise<AuthIssueOutcome>[] = [];
  const flow = createEmailChangeFlow({
    keys: ring,
    users: users.store,
    nonces: nonces.store,
    notifier: mail.notifier,
    defer: (work) => void scheduled.push(work),
    confirmUrl: (token) => `https://example.com/account/email/confirm?token=${token}`,
    ...overrides,
  });
  return { flow, users, nonces, mail, scheduled };
}

/** Lets the held delivery finish, then drains the deferred work the flow handed over. */
async function settle(built: ReturnType<typeof scene>): Promise<readonly AuthIssueOutcome[]> {
  built.mail.release();
  return Promise.all(built.scheduled);
}

function tokenOf(sent: readonly AuthMessage[]): string {
  const url = sent[0]?.url;
  if (!url) throw new Error("no confirmation mail was sent");
  return new URL(url).searchParams.get("token") ?? "";
}

describe("createEmailChangeFlow — requesting", () => {
  // The move is authorised by whoever owns the address the account already holds, not by whoever
  // holds the session: without this a stolen cookie moves the account to the thief's own inbox and
  // locks the owner out of the primary factor for good.
  it("mails the confirmation link to the address the account already holds, off the caller's clock", async () => {
    const built = scene();
    // Delivery is still hanging here, and `request` has already answered: the send is deferred work
    // and not part of what the caller waits for.
    const requested = await built.flow.request(USER_ID, "  New@Example.com  ", AT);
    expect(requested).toEqual({ ok: true, data: { expiresAt: AT + TTL_MS } });
    expect(built.scheduled).toHaveLength(1);
    expect(await settle(built)).toEqual(["challenged"]);
    expect(built.mail.sent).toHaveLength(1);
    expect(built.mail.sent[0]?.to).toBe("person@example.com");
    expect(built.mail.sent[0]?.kind).toBe("email-change");
  });

  // An unverified address has proved nothing, so asking it to authorise the move would be asking
  // nobody. The new address is the only one there is to ask.
  it("falls back to the new address when the account's own is unverified", async () => {
    const built = scene([userRow({ emailVerifiedAt: null })]);
    await built.flow.request(USER_ID, "  New@Example.com  ", AT);
    await settle(built);
    expect(built.mail.sent[0]?.to).toBe("New@Example.com");
  });

  // The link binds the account and the new address in its own payload, so where it is delivered
  // changes who authorises the move and nothing about what the move is.
  it("carries the same change whichever address it is delivered to", async () => {
    const verified = scene();
    await verified.flow.request(USER_ID, "new@example.com", AT);
    await settle(verified);
    const unverified = scene([userRow({ emailVerifiedAt: null })]);
    await unverified.flow.request(USER_ID, "new@example.com", AT);
    await settle(unverified);

    expect((await verified.flow.confirm(tokenOf(verified.mail.sent), AT + 1)).ok).toBe(true);
    expect((await unverified.flow.confirm(tokenOf(unverified.mail.sent), AT + 1)).ok).toBe(true);
  });

  // Telling a signed-in visitor that the address they typed is registered is the same enumeration
  // answer the sign-in flow refuses to give; the unique index refuses the write at confirmation.
  it("never looks the new address up, so it cannot report one as taken", async () => {
    const built = scene([userRow(), userRow({ id: OTHER_ID, email: "taken@example.com", emailKey: "taken@example.com" })]);
    const requested = await built.flow.request(USER_ID, "taken@example.com", AT);
    expect(requested).toEqual({ ok: true, data: { expiresAt: AT + TTL_MS } });
  });

  it("refuses the address the account already holds, in any spelling", async () => {
    const built = scene();
    expect(await built.flow.request(USER_ID, "PERSON@example.com", AT)).toEqual({ ok: false, error: "unchanged" });
    expect(built.scheduled).toHaveLength(0);
  });

  it("refuses an unknown account and a deactivated one", async () => {
    expect(await scene([]).flow.request(USER_ID, "new@example.com", AT)).toEqual({ ok: false, error: "unrecognised" });
    expect(await scene([userRow({ deactivatedAt: 1_650_000_000_000 })]).flow.request(USER_ID, "new@example.com", AT)).toEqual({
      ok: false,
      error: "deactivated",
    });
  });
});

describe("createEmailChangeFlow — confirming", () => {
  async function requested(built: ReturnType<typeof scene>, address = "new@example.com"): Promise<string> {
    await built.flow.request(USER_ID, address, AT);
    await settle(built);
    return tokenOf(built.mail.sent);
  }

  // One statement moves and verifies, so there is no second write between the two that could fail
  // and leave the account holding an address no passkey sign-in will accept.
  it("moves the row to the address the token names, verified, in one write", async () => {
    const built = scene();
    const token = await requested(built, "New@Example.com");
    const confirmed = await built.flow.confirm(token, AT + 1_000);
    expect(confirmed.ok).toBe(true);
    expect(built.users.writes).toEqual([{ id: USER_ID, email: "New@Example.com", emailKey: "new@example.com" }]);
    expect(built.users.verified).toEqual([]);
    expect(confirmed.ok && confirmed.data.emailVerifiedAt).toBe(AT + 1_000);
    expect(built.users.rows[0]?.emailVerifiedAt).toBe(AT + 1_000);
  });

  // The address is inside the sealed payload, so there is no argument a caller could point at
  // another mailbox: a token issued for one address can only ever land that address.
  it("lands the token's own address, never another the caller might prefer", async () => {
    for (const address of ["one@example.com", "two@example.com"]) {
      const built = scene();
      const token = await requested(built, address);
      await built.flow.confirm(token, AT + 1_000);
      expect(`${address}: ${built.users.writes[0]?.email}`).toBe(`${address}: ${address}`);
    }
  });

  it("refuses a token whose payload was altered, and one sealed under another ring or purpose", async () => {
    const built = scene();
    const token = await requested(built);
    const flipped = `${token.slice(0, -2)}${token.slice(-2) === "AA" ? "AB" : "AA"}`;
    expect(await built.flow.confirm(flipped, AT + 1_000)).toEqual({ ok: false, error: "unrecognised" });

    const foreign = await encodeAuthToken(otherRing, "identity", `${USER_ID} evil@example.com`, TTL_MS, { now: AT });
    expect(await built.flow.confirm(foreign, AT + 1_000)).toEqual({ ok: false, error: "unrecognised" });

    const wrongPurpose = await encodeAuthToken(ring, "verify", `${USER_ID} evil@example.com`, TTL_MS, { now: AT });
    expect(await built.flow.confirm(wrongPurpose, AT + 1_000)).toEqual({ ok: false, error: "unrecognised" });
    expect(built.users.writes).toEqual([]);
  });

  it("refuses the same token a second time, so an intercepted link is spent once", async () => {
    const built = scene();
    const token = await requested(built);
    expect((await built.flow.confirm(token, AT + 1_000)).ok).toBe(true);
    expect(await built.flow.confirm(token, AT + 2_000)).toEqual({ ok: false, error: "consumed" });
    expect(built.users.writes).toHaveLength(1);
  });

  it("refuses a token past its window", async () => {
    const built = scene();
    const token = await requested(built);
    expect(await built.flow.confirm(token, AT + TTL_MS)).toEqual({ ok: false, error: "expired" });
  });

  it("names the user out of the token, so a link only ever moves the account it was issued for", async () => {
    const built = scene([userRow({ id: OTHER_ID, email: "other@example.com", emailKey: "other@example.com" })]);
    const token = await encodeAuthToken(ring, "identity", `${OTHER_ID} moved@example.com`, TTL_MS, { now: AT });
    const confirmed = await built.flow.confirm(token, AT + 1_000);
    expect(confirmed.ok && confirmed.data.id).toBe(OTHER_ID);
    expect(built.users.writes).toEqual([{ id: OTHER_ID, email: "moved@example.com", emailKey: "moved@example.com" }]);
  });

  // `request` deliberately never looks the address up, so reporting the index that caught it would
  // hand back at confirmation exactly the enumeration answer the request withheld.
  it("reports a collision with a registered address as the same refusal an unknown account gets", async () => {
    const built = scene([userRow()], { conflict: true });
    const token = await requested(built, "taken@example.com");
    expect(await built.flow.confirm(token, AT + 1_000)).toEqual({ ok: false, error: "unrecognised" });
  });

  it("still surfaces a store outage as the store's own error, so a transient failure is not a refusal", async () => {
    const built = scene([userRow()], { unavailable: true });
    const token = await requested(built, "new@example.com");
    const confirmed = await built.flow.confirm(token, AT + 1_000);
    if (confirmed.ok) throw new Error("the outage was accepted");
    expect(confirmed.error).toBeInstanceOf(AuthStoreError);
    expect((confirmed.error as AuthStoreError).code).toBe("unavailable");
  });

  it("refuses a deactivated account, after spending the token rather than leaving it live", async () => {
    const built = scene([userRow({ deactivatedAt: null })]);
    const token = await requested(built);
    built.users.rows[0] = userRow({ deactivatedAt: 1_650_000_000_000 });
    expect(await built.flow.confirm(token, AT + 1_000)).toEqual({ ok: false, error: "deactivated" });
    expect(built.nonces.seen.size).toBe(1);
    expect(built.users.writes).toEqual([]);
  });

  it("refuses a payload with no address in it", async () => {
    const built = scene();
    const malformed = await encodeAuthToken(ring, "identity", USER_ID, TTL_MS, { now: AT });
    expect(await built.flow.confirm(malformed, AT + 1_000)).toEqual({ ok: false, error: "unrecognised" });
  });
});

describe("createEmailChangeFlow — the link lifetime it holds at construction", () => {
  const FLOOR =
    "createEmailChangeFlow: ttlMs is 1000, below the 60000-millisecond floor — the shortest expiration the nonce store accepts, below which the link outlives its own replay guard.";
  const CEILING =
    "createEmailChangeFlow: ttlMs is 172800000, above the 86400000-millisecond ceiling — a change-of-address link that outlives a day is a standing takeover primitive.";

  it("refuses a lifetime below the nonce store's own floor", () => {
    expect(() => scene([userRow()], {}, { ttlMs: 1_000 })).toThrow(FLOOR);
  });

  it("refuses a link that would stay live for longer than a day", () => {
    expect(() => scene([userRow()], {}, { ttlMs: 172_800_000 })).toThrow(CEILING);
  });

  it("refuses a fraction", () => {
    expect(() => scene([userRow()], {}, { ttlMs: 60_000.5 })).toThrow("createEmailChangeFlow: ttlMs is 60000.5, which is not a whole number.");
  });

  it("accepts both bounds themselves, and the knob omitted", () => {
    expect(() => scene([userRow()], {}, { ttlMs: 60_000 })).not.toThrow();
    expect(() => scene([userRow()], {}, { ttlMs: 86_400_000 })).not.toThrow();
    expect(() => scene()).not.toThrow();
  });
});
